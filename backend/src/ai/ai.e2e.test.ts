import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module'
import { SESSION_COOKIE } from '../auth/session-cookie'
import { up } from '../database/migrate'
import * as schema from '../database/schema'
import { aiRequests, memberships, users } from '../database/schema'
import { AI_PROVIDERS_TOKEN } from './providers.factory'
import type { AiProvider } from './provider'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('the AI endpoint over HTTP', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  const http = () => request(app.getHttpServer())

  /** A stub vendor: no key, no network, deterministic usage. */
  const stub = {
    name: 'anthropic' as const,
    complete: vi.fn().mockResolvedValue({
      text: 'The answer is four.',
      usage: { inputTokens: 1000, outputTokens: 500 },
      stopReason: 'end_turn',
    }),
    stream: vi.fn(),
  } as unknown as AiProvider

  const signUp = async (email: string, name: string) => {
    const response = await http()
      .post('/auth/register')
      .send({ email, password: 'a sufficiently long password', name })
    expect(response.status).toBe(201)

    const header = response.headers['set-cookie'] as unknown as string[]
    const cookie = header.find((entry) => entry.startsWith(SESSION_COOKIE))!
    const orgs = await http().get('/orgs').set('Cookie', cookie)
    expect(orgs.status).toBe(200)
    expect(orgs.body.length).toBeGreaterThan(0)

    const org = orgs.body[0]
    const spaces = await http().get(`/orgs/${org.id}/workspaces`).set('Cookie', cookie)
    expect(spaces.status).toBe(200)
    expect(spaces.body.length).toBeGreaterThan(0)

    return {
      cookie,
      userId: response.body.id as string,
      org,
      base: `/orgs/${org.id}/workspaces/${spaces.body[0].id}/ai`,
    }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    process.env.THROTTLE_DISABLED = 'true'
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Only anthropic is "configured", so the other two must report as absent.
      .overrideProvider(AI_PROVIDERS_TOKEN)
      .useValue(new Map([['anthropic', stub]]))
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    await app.listen(0)
  })

  afterAll(async () => {
    await app.close()
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await sql.unsafe(
      'truncate table sessions, ai_requests, subscriptions, product_prices, products, customer_notes, customers, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('GET /ai/models', () => {
    it('lists models for configured providers only', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http().get(`${ctx.base}/models`).set('Cookie', ctx.cookie)

      expect(response.status).toBe(200)
      expect(response.body.length).toBeGreaterThan(0)
      expect(response.body.every((m: { provider: string }) => m.provider === 'anthropic')).toBe(
        true,
      )
    })

    it('never returns anything resembling a key', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http().get(`${ctx.base}/models`).set('Cookie', ctx.cookie)

      expect(JSON.stringify(response.body)).not.toMatch(/apiKey|api_key|sk-/i)
    })

    it('requires a session', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect((await http().get(`${ctx.base}/models`)).status).toBe(401)
    })
  })

  describe('POST /ai/complete', () => {
    const body = {
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'What is two plus two?' }],
      maxTokens: 100,
    }

    it('answers with usage and cost attached', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http()
        .post(`${ctx.base}/complete`)
        .set('Cookie', ctx.cookie)
        .send(body)

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({
        model: 'claude-opus-5',
        provider: 'anthropic',
        text: 'The answer is four.',
        usage: { inputTokens: 1000, outputTokens: 500 },
        costMicroUsd: 1000 * 5 + 500 * 25,
        stopReason: 'end_turn',
      })
    })

    /** Rule 8: no AI request may come back without its cost. */
    it('always carries a cost', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http()
        .post(`${ctx.base}/complete`)
        .set('Cookie', ctx.cookie)
        .send(body)

      expect(response.body).toHaveProperty('costMicroUsd')
      expect(response.body).toHaveProperty('costCents')
    })

    it('refuses a model whose provider is not configured here', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http()
        .post(`${ctx.base}/complete`)
        .set('Cookie', ctx.cookie)
        .send({ ...body, model: 'gemini-3.7-flash' })

      expect(response.status).toBe(422)
      expect(response.body.error.message).toMatch(/not configured/i)
    })

    it('refuses an unknown model', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http()
        .post(`${ctx.base}/complete`)
        .set('Cookie', ctx.cookie)
        .send({ ...body, model: 'gpt-9-ultra' })

      expect(response.status).toBe(404)
    })

    it.each([
      ['no messages', { ...body, messages: [] }],
      ['an empty message', { ...body, messages: [{ role: 'user', content: '' }] }],
      ['an unknown role', { ...body, messages: [{ role: 'system', content: 'hi' }] }],
      ['a negative token budget', { ...body, maxTokens: -1 }],
    ])('rejects %s with 422', async (_label, payload) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http()
        .post(`${ctx.base}/complete`)
        .set('Cookie', ctx.cookie)
        .send(payload)

      expect(response.status).toBe(422)
    })

    it('is refused for a member, who may read but not spend', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await db.update(memberships).set({ role: 'member' }).where(eq(memberships.userId, ctx.userId))

      expect((await http().get(`${ctx.base}/models`).set('Cookie', ctx.cookie)).status).toBe(200)
      expect(
        (await http().post(`${ctx.base}/complete`).set('Cookie', ctx.cookie).send(body)).status,
      ).toBe(403)
    })

    it('is invisible to another tenant', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      expect(
        (await http().post(`${owner.base}/complete`).set('Cookie', outsider.cookie).send(body))
          .status,
      ).toBe(404)
    })
  })

  describe('the record every call leaves behind', () => {
    const body = {
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'a very secret prompt' }],
      maxTokens: 100,
    }

    it('writes one row carrying what the response reported', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http()
        .post(`${ctx.base}/complete`)
        .set('Cookie', ctx.cookie)
        .send(body)

      const rows = await db.select().from(aiRequests)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        provider: 'anthropic',
        model: 'claude-opus-5',
        status: 'succeeded',
        inputTokens: 1000,
        outputTokens: 500,
        costMicroUsd: response.body.costMicroUsd,
        userId: ctx.userId,
      })
    })

    /** The claim that this table holds no customer content, asserted. */
    it('stores neither the prompt nor the answer', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await http().post(`${ctx.base}/complete`).set('Cookie', ctx.cookie).send(body)

      const rows = await db.select().from(aiRequests)
      const stored = JSON.stringify(rows)

      expect(stored).not.toContain('a very secret prompt')
      expect(stored).not.toContain('The answer is four.')
    })

    it('records a failed call and still surfaces the failure', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const failing = vi
        .spyOn(stub, 'complete')
        .mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'service_unavailable' }))

      const response = await http()
        .post(`${ctx.base}/complete`)
        .set('Cookie', ctx.cookie)
        .send(body)

      expect(response.status).toBe(500)

      const rows = await db.select().from(aiRequests)
      expect(rows[0]).toMatchObject({ status: 'failed', errorCode: 'service_unavailable' })

      failing.mockRestore()
    })

    it('leaves the spend recorded when the person who spent it is deleted', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await http().post(`${ctx.base}/complete`).set('Cookie', ctx.cookie).send(body)

      await db.delete(users).where(eq(users.id, ctx.userId))

      const rows = await db.select().from(aiRequests)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.userId).toBeNull()
      expect(rows[0]?.costMicroUsd).toBeGreaterThan(0)
    })
  })

  describe('GET /ai/usage', () => {
    const ask = (ctx: { cookie: string; base: string }, model = 'claude-opus-5') =>
      http()
        .post(`${ctx.base}/complete`)
        .set('Cookie', ctx.cookie)
        .send({ model, messages: [{ role: 'user', content: 'Hi' }], maxTokens: 100 })

    it('returns zeroes for a workspace that has spent nothing', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http().get(`${ctx.base}/usage`).set('Cookie', ctx.cookie)

      expect(response.status).toBe(200)
      expect(response.body.totals).toEqual({
        requests: 0,
        failed: 0,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        costCents: 0,
      })
      expect(response.body.byModel).toEqual([])
    })

    it('totals exactly what the rows hold', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await ask(ctx)
      await ask(ctx)
      await ask(ctx, 'claude-haiku-4-5')

      const response = await http().get(`${ctx.base}/usage`).set('Cookie', ctx.cookie)

      expect(response.body.totals.requests).toBe(3)
      expect(response.body.totals.inputTokens).toBe(3000)
      // Two Opus calls at 17500 plus one Haiku call at 1000*1 + 500*5.
      expect(response.body.totals.costMicroUsd).toBe(17_500 * 2 + 3500)
      expect(response.body.byModel).toHaveLength(2)
    })

    it('counts failures separately from the rest', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await ask(ctx)
      const failing = vi.spyOn(stub, 'complete').mockRejectedValueOnce(new Error('nope'))
      await ask(ctx)
      failing.mockRestore()

      const response = await http().get(`${ctx.base}/usage`).set('Cookie', ctx.cookie)

      expect(response.body.totals.requests).toBe(2)
      expect(response.body.totals.failed).toBe(1)
    })

    it('honours a date range', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await ask(ctx)

      const future = new Date(Date.now() + 60_000).toISOString()
      const response = await http()
        .get(`${ctx.base}/usage?from=${encodeURIComponent(future)}`)
        .set('Cookie', ctx.cookie)

      expect(response.body.totals.requests).toBe(0)
    })

    it('shows one tenant nothing of another tenant’s spend', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      await ask(owner)
      const other = await signUp('other@onestack.test', 'Other')

      const response = await http().get(`${other.base}/usage`).set('Cookie', other.cookie)

      expect(response.body.totals.requests).toBe(0)
    })
  })

  describe('GET /ai/requests', () => {
    it('lists the rows for this workspace only', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await http()
        .post(`${ctx.base}/complete`)
        .set('Cookie', ctx.cookie)
        .send({
          model: 'claude-opus-5',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 100,
        })

      const response = await http().get(`${ctx.base}/requests`).set('Cookie', ctx.cookie)

      expect(response.status).toBe(200)
      expect(response.body.items).toHaveLength(1)
      expect(response.body.items[0]).toMatchObject({ model: 'claude-opus-5', status: 'succeeded' })
    })

    it('is refused to an outsider', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      expect(
        (await http().get(`${owner.base}/requests`).set('Cookie', outsider.cookie)).status,
      ).toBe(404)
    })
  })
})
