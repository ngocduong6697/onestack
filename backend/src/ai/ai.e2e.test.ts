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
import { memberships } from '../database/schema'
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
      'truncate table sessions, subscriptions, product_prices, products, customer_notes, customers, invitations, memberships, workspaces, organizations, users cascade',
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
})
