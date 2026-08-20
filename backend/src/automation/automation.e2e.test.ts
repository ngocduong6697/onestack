import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_PROVIDERS_TOKEN } from '../ai/providers.factory'
import type { AiProvider } from '../ai/provider'
import { AppModule } from '../app.module'
import { SESSION_COOKIE } from '../auth/session-cookie'
import { up } from '../database/migrate'
import * as schema from '../database/schema'
import { aiRequests, jobs, workflows } from '../database/schema'
import { AutomationWorker } from './worker'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('automation over HTTP', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 2, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  const http = () => request(app.getHttpServer())

  const stub = {
    name: 'anthropic' as const,
    complete: vi.fn().mockResolvedValue({
      text: 'a generated answer',
      usage: { inputTokens: 100, outputTokens: 50 },
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
      workspaceId: spaces.body[0].id as string,
      base: `/orgs/${org.id}/workspaces/${spaces.body[0].id}/workflows`,
    }
  }

  type Ctx = Awaited<ReturnType<typeof signUp>>

  const aiStep = {
    action: 'ai.complete',
    model: 'claude-opus-5',
    prompt: 'Say hello',
    maxTokens: 50,
  }

  const create = (ctx: Ctx, body: Record<string, unknown>) =>
    http().post(ctx.base).set('Cookie', ctx.cookie).send(body)

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    process.env.THROTTLE_DISABLED = 'true'
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
      'truncate table sessions, run_steps, runs, jobs, workflows, ai_requests, subscriptions, product_prices, products, customer_notes, customers, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('definitions', () => {
    it('creates a manual workflow', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await create(ctx, { name: 'Daily digest', steps: [aiStep] })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({
        name: 'Daily digest',
        triggerType: 'manual',
        enabled: true,
        nextRunAt: null,
      })
    })

    it('schedules a scheduled workflow when it is created', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await create(ctx, {
        name: 'Weekly report',
        triggerType: 'schedule',
        cron: '0 9 * * 1',
        timezone: 'UTC',
        steps: [aiStep],
      })

      expect(response.body.nextRunAt).not.toBeNull()
    })

    it('refuses a scheduled workflow with no cron', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect(
        (await create(ctx, { name: 'Broken', triggerType: 'schedule', steps: [aiStep] })).status,
      ).toBe(422)
    })

    it.each([
      ['no steps', { name: 'Empty', steps: [] }],
      ['an unknown action', { name: 'Odd', steps: [{ action: 'launch.rocket' }] }],
      ['a blank name', { name: '  ', steps: [aiStep] }],
    ])('refuses %s with 422', async (_label, body) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect((await create(ctx, body)).status).toBe(422)
    })

    /** Caught at write time, not at three in the morning. */
    it('refuses a step referring to one that has not run yet', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await create(ctx, {
        name: 'Backwards',
        steps: [{ ...aiStep, prompt: 'about {{steps.1.text}}' }, aiStep],
      })

      expect(response.status).toBe(422)
      expect(response.body.error.message).toMatch(/does not run before it/)
    })

    it('clears the schedule when a workflow is disabled', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, {
        name: 'Weekly',
        triggerType: 'schedule',
        cron: '0 9 * * 1',
        steps: [aiStep],
      })

      const disabled = await http()
        .patch(`${ctx.base}/${created.body.id}`)
        .set('Cookie', ctx.cookie)
        .send({ enabled: false })

      expect(disabled.body.enabled).toBe(false)
      expect(disabled.body.nextRunAt).toBeNull()
    })

    it('deletes a workflow', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, { name: 'Temporary', steps: [aiStep] })

      expect(
        (await http().delete(`${ctx.base}/${created.body.id}`).set('Cookie', ctx.cookie)).status,
      ).toBe(204)
      expect(
        (await http().get(`${ctx.base}/${created.body.id}`).set('Cookie', ctx.cookie)).status,
      ).toBe(404)
    })
  })

  describe('running', () => {
    it('runs every step and records each one', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, { name: 'Two steps', steps: [aiStep, aiStep] })

      const run = await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)

      expect(run.status).toBe(201)
      expect(run.body.status).toBe('succeeded')
      expect(run.body.steps).toHaveLength(2)
      expect(run.body.steps.map((s: { index: number }) => s.index)).toEqual([0, 1])
      expect(run.body.steps[0].output.text).toBe('a generated answer')
    })

    /** Rule 8 has no exception for automation. */
    it('records an AI step in ai_requests, like any other call', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, { name: 'One step', steps: [aiStep] })

      await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)

      const recorded = await db.select().from(aiRequests)
      expect(recorded).toHaveLength(1)
      expect(recorded[0]).toMatchObject({
        model: 'claude-opus-5',
        status: 'succeeded',
        inputTokens: 100,
        outputTokens: 50,
      })
    })

    it('puts the step cost on the step', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, { name: 'One step', steps: [aiStep] })

      const run = await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)

      // 100 input at $5/MTok plus 50 output at $25/MTok.
      expect(run.body.steps[0].costMicroUsd).toBe(100 * 5 + 50 * 25)
    })

    it('passes an earlier step’s output into a later one', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, {
        name: 'Chained',
        steps: [aiStep, { ...aiStep, prompt: 'Rewrite: {{steps.0.text}}' }],
      })

      await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)

      const second = (
        stub.complete as unknown as { mock: { calls: [{ messages: [{ content: string }] }][] } }
      ).mock.calls.at(-1)![0]
      expect(second.messages[0].content).toBe('Rewrite: a generated answer')
    })

    /** A run that just stops leaves you guessing whether the rest ran. */
    it('marks the steps after a failure as skipped rather than omitting them', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, { name: 'Fails first', steps: [aiStep, aiStep, aiStep] })
      const failing = vi.spyOn(stub, 'complete').mockRejectedValueOnce(new Error('provider down'))

      const run = await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)

      expect(run.body.status).toBe('failed')
      expect(run.body.steps.map((s: { status: string }) => s.status)).toEqual([
        'failed',
        'skipped',
        'skipped',
      ])
      failing.mockRestore()
    })

    it('records a failed AI step in ai_requests too', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, { name: 'Fails', steps: [aiStep] })
      const failing = vi.spyOn(stub, 'complete').mockRejectedValueOnce(new Error('provider down'))

      await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)

      const recorded = await db.select().from(aiRequests)
      expect(recorded[0]?.status).toBe('failed')
      failing.mockRestore()
    })

    it('lists runs for the workflow', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, { name: 'Twice', steps: [aiStep] })
      await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)
      await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)

      const runs = await http().get(`${ctx.base}/${created.body.id}/runs`).set('Cookie', ctx.cookie)

      expect(runs.body.items).toHaveLength(2)
    })
  })

  describe('http steps and the addresses they may not reach', () => {
    it.each([
      ['http://127.0.0.1:5432/', 'loopback'],
      ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
      ['http://10.0.0.1/admin', 'a private network'],
      ['file:///etc/passwd', 'a local file'],
    ])('refuses %s (%s)', async (target) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, {
        name: 'Probe',
        steps: [{ action: 'http.request', method: 'GET', url: target }],
      })

      // A non-http scheme is refused when the workflow is written; a private
      // address is only knowable when the step runs. Either way it never
      // reaches the network.
      if (created.status === 422) return

      const run = await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)

      expect(run.body.status).toBe('failed')
      expect(run.body.steps[0].error).toMatch(/may not be requested|not valid|resolve/i)
    })
  })

  describe('the scheduler', () => {
    it('enqueues a workflow that has come due and advances it', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, {
        name: 'Due now',
        triggerType: 'schedule',
        cron: '*/5 * * * *',
        steps: [aiStep],
      })

      // Pretend its moment arrived.
      await db
        .update(workflows)
        .set({ nextRunAt: new Date(Date.now() - 1000) })
        .where(eq(workflows.id, created.body.id))

      const worker = app.get(AutomationWorker)
      expect(await worker.tick()).toBe(1)

      const queued = await db.select().from(jobs)
      expect(queued).toHaveLength(1)

      const [after] = await db.select().from(workflows).where(eq(workflows.id, created.body.id))
      expect(after?.nextRunAt?.getTime()).toBeGreaterThan(Date.now())
    })

    it('leaves a disabled workflow alone', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, {
        name: 'Off',
        triggerType: 'schedule',
        cron: '*/5 * * * *',
        steps: [aiStep],
      })
      await db
        .update(workflows)
        .set({ enabled: false, nextRunAt: new Date(Date.now() - 1000) })
        .where(eq(workflows.id, created.body.id))

      expect(await app.get(AutomationWorker).tick()).toBe(0)
    })

    it('works a queued job through to a run', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, { name: 'Queued', steps: [aiStep] })
      const worker = app.get(AutomationWorker)

      await db.insert(jobs).values({ workspaceId: ctx.workspaceId, workflowId: created.body.id })

      expect(await worker.workOnce()).toBe(true)

      const runs = await http().get(`${ctx.base}/${created.body.id}/runs`).set('Cookie', ctx.cookie)
      expect(runs.body.items[0]?.status).toBe('succeeded')
    })

    it('reports nothing to do on an empty queue', async () => {
      await signUp('founder@onestack.test', 'Founder')

      expect(await app.get(AutomationWorker).workOnce()).toBe(false)
    })
  })

  describe('isolation', () => {
    it('hides workflows from another tenant', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      expect((await http().get(owner.base).set('Cookie', outsider.cookie)).status).toBe(404)
    })

    it('refuses to run another tenant’s workflow', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const created = await create(owner, { name: 'Theirs', steps: [aiStep] })
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      const response = await http()
        .post(`${outsider.base}/${created.body.id}/run`)
        .set('Cookie', outsider.cookie)

      expect(response.status).toBe(404)
    })

    it('lets a member read but not write or run', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await create(ctx, { name: 'Readable', steps: [aiStep] })
      await sql.unsafe(`update memberships set role = 'member' where user_id = '${ctx.userId}'`)

      expect((await http().get(ctx.base).set('Cookie', ctx.cookie)).status).toBe(200)
      expect((await create(ctx, { name: 'Nope', steps: [aiStep] })).status).toBe(403)
      expect(
        (await http().post(`${ctx.base}/${created.body.id}/run`).set('Cookie', ctx.cookie)).status,
      ).toBe(403)
    })
  })
})
