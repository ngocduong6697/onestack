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
import { ledgerEntries, metricSnapshots, users } from '../database/schema'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('analytics over HTTP', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 2, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  const http = () => request(app.getHttpServer())

  const stub = {
    name: 'anthropic' as const,
    complete: vi.fn().mockResolvedValue({
      text: 'answer',
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
      workspaceId: spaces.body[0].id as string,
      base: `/orgs/${org.id}/workspaces/${spaces.body[0].id}`,
    }
  }

  type Ctx = Awaited<ReturnType<typeof signUp>>

  /** A customer on a $49/month subscription. */
  const subscribe = async (ctx: Ctx, amountCents = 4900, interval = 'month') => {
    const customer = await http()
      .post(`${ctx.base}/customers`)
      .set('Cookie', ctx.cookie)
      .send({ name: 'Acme', email: `acme-${amountCents}-${interval}@test.test`, stage: 'active' })
    const product = await http()
      .post(`${ctx.base}/products`)
      .set('Cookie', ctx.cookie)
      .send({ name: `Plan ${amountCents} ${interval}` })
    const price = await http()
      .post(`${ctx.base}/products/${product.body.id}/prices`)
      .set('Cookie', ctx.cookie)
      .send({ amountCents, currency: 'USD', interval })

    const created = await http()
      .post(`${ctx.base}/subscriptions`)
      .set('Cookie', ctx.cookie)
      .send({ customerId: customer.body.id, priceId: price.body.id })
    expect(created.status).toBe(201)
  }

  const summary = (ctx: Ctx) =>
    http().get(`${ctx.base}/analytics/summary`).set('Cookie', ctx.cookie)

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
      'truncate table sessions, ledger_entries, metric_snapshots, run_steps, runs, jobs, workflows, ai_requests, subscriptions, product_prices, products, customer_notes, customers, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('the summary', () => {
    it('is all zeroes and no margin for an empty workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await summary(ctx)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        mrrMicroUsd: 0,
        customers: 0,
        grossProfitMicroUsd: 0,
        marginBasisPoints: null,
      })
    })

    it('reports MRR from the subscriptions', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await subscribe(ctx, 4900)

      // $49.00 is 49_000_000 micro-dollars.
      expect((await summary(ctx)).body.mrrMicroUsd).toBe(49_000_000)
    })

    /** The same rule, not a second implementation of it. */
    it('agrees with the subscriptions summary on the same data', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await subscribe(ctx, 4900)
      await subscribe(ctx, 120_000, 'year')

      const subs = await http().get(`${ctx.base}/subscriptions/summary`).set('Cookie', ctx.cookie)
      const analytics = await summary(ctx)

      const fromSubs = subs.body.mrr.reduce(
        (total: number, line: { amountCents: number }) => total + line.amountCents * 10_000,
        0,
      )
      expect(analytics.body.mrrMicroUsd).toBe(fromSubs)
    })

    it('counts customers and the active ones separately', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await http().post(`${ctx.base}/customers`).set('Cookie', ctx.cookie).send({ name: 'A Lead' })
      await http()
        .post(`${ctx.base}/customers`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'A Customer', stage: 'active' })

      const response = await summary(ctx)

      expect(response.body.customers).toBe(2)
      expect(response.body.activeCustomers).toBe(1)
    })

    it('includes AI spend in the cost', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await http()
        .post(`${ctx.base}/ai/complete`)
        .set('Cookie', ctx.cookie)
        .send({
          model: 'claude-opus-5',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 50,
        })

      const response = await summary(ctx)

      expect(response.body.aiCostMicroUsd).toBe(1000 * 5 + 500 * 25)
      expect(response.body.costMicroUsd).toBe(response.body.aiCostMicroUsd)
    })

    /** The arithmetic from the original dashboard sketch, end to end. */
    it('computes gross profit and margin from revenue and both costs', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await subscribe(ctx, 210_000) // $2,100 a month
      await http()
        .post(`${ctx.base}/ledger`)
        .set('Cookie', ctx.cookie)
        .send({
          entryDate: new Date().toISOString().slice(0, 10),
          kind: 'cost',
          category: 'infrastructure',
          amountMicroUsd: 90_000_000, // $90
        })

      const response = await summary(ctx)

      expect(response.body.revenueMicroUsd).toBe(2_100_000_000)
      expect(response.body.recordedCostMicroUsd).toBe(90_000_000)
      expect(response.body.grossProfitMicroUsd).toBe(2_100_000_000 - 90_000_000)
      expect(response.body.marginBasisPoints).toBe(9571)
    })

    it('adds recorded one-off revenue to the recurring kind', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await http()
        .post(`${ctx.base}/ledger`)
        .set('Cookie', ctx.cookie)
        .send({
          entryDate: new Date().toISOString().slice(0, 10),
          kind: 'revenue',
          category: 'one_off',
          amountMicroUsd: 500_000_000,
        })

      expect((await summary(ctx)).body.revenueMicroUsd).toBe(500_000_000)
    })
  })

  describe('the ledger', () => {
    const entry = {
      entryDate: '2026-08-01',
      kind: 'cost',
      category: 'infrastructure',
      amountMicroUsd: 90_000_000,
      note: 'Hosting',
    }

    it('records an entry', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http().post(`${ctx.base}/ledger`).set('Cookie', ctx.cookie).send(entry)

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ kind: 'cost', category: 'infrastructure' })
      expect(response.body.createdBy).toBe(ctx.userId)
    })

    /** The sign lives in `kind`, so a negative cost cannot become revenue. */
    it.each([
      ['a negative amount', { ...entry, amountMicroUsd: -1 }],
      ['a zero amount', { ...entry, amountMicroUsd: 0 }],
      ['a missing category', { ...entry, category: '  ' }],
      ['a malformed date', { ...entry, entryDate: '01/08/2026' }],
      ['an unknown kind', { ...entry, kind: 'refund' }],
    ])('refuses %s with 422', async (_label, body) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect(
        (await http().post(`${ctx.base}/ledger`).set('Cookie', ctx.cookie).send(body)).status,
      ).toBe(422)
    })

    it('lists and filters by kind', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await http().post(`${ctx.base}/ledger`).set('Cookie', ctx.cookie).send(entry)
      await http()
        .post(`${ctx.base}/ledger`)
        .set('Cookie', ctx.cookie)
        .send({ ...entry, kind: 'revenue', category: 'one_off' })

      const costs = await http().get(`${ctx.base}/ledger?kind=cost`).set('Cookie', ctx.cookie)

      expect(costs.body.items).toHaveLength(1)
      expect(costs.body.items[0].kind).toBe('cost')
    })

    it('deletes an entry', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await http().post(`${ctx.base}/ledger`).set('Cookie', ctx.cookie).send(entry)

      expect(
        (await http().delete(`${ctx.base}/ledger/${created.body.id}`).set('Cookie', ctx.cookie))
          .status,
      ).toBe(204)
      expect(await db.select().from(ledgerEntries)).toHaveLength(0)
    })

    it('keeps an entry when its author is deleted', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await http().post(`${ctx.base}/ledger`).set('Cookie', ctx.cookie).send(entry)

      await db.delete(users).where(eq(users.id, ctx.userId))

      const rows = await db.select().from(ledgerEntries)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.createdBy).toBeNull()
    })
  })

  describe('snapshots and the series', () => {
    it('captures today and is idempotent within the day', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await subscribe(ctx, 4900)

      const first = await http().post(`${ctx.base}/analytics/snapshot`).set('Cookie', ctx.cookie)
      const second = await http().post(`${ctx.base}/analytics/snapshot`).set('Cookie', ctx.cookie)

      expect(first.status).toBe(200)
      expect(second.body.capturedOn).toBe(first.body.capturedOn)
      expect(await db.select().from(metricSnapshots)).toHaveLength(1)
    })

    it('records the metrics as they were when captured', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await subscribe(ctx, 4900)
      await http().post(`${ctx.base}/analytics/snapshot`).set('Cookie', ctx.cookie)

      const [row] = await db.select().from(metricSnapshots)
      expect(row?.mrrMicroUsd).toBe(49_000_000)
      expect(row?.activeSubscriptions).toBe(1)
    })

    it('returns an empty series when nothing has been captured', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http()
        .get(`${ctx.base}/analytics/series?metric=mrr&days=30`)
        .set('Cookie', ctx.cookie)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ metric: 'mrr', points: [] })
    })

    it('returns a point for each captured day', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await subscribe(ctx, 4900)
      await http().post(`${ctx.base}/analytics/snapshot`).set('Cookie', ctx.cookie)

      // A second day, backdated.
      await db.insert(metricSnapshots).values({
        workspaceId: ctx.workspaceId,
        capturedOn: '2026-01-01',
        mrrMicroUsd: 10_000_000,
      })

      const response = await http()
        .get(`${ctx.base}/analytics/series?metric=mrr&days=365`)
        .set('Cookie', ctx.cookie)

      expect(response.body.points.length).toBeGreaterThanOrEqual(1)
      expect(response.body.points.at(-1)?.value).toBe(49_000_000)
    })

    it.each([
      ['an unknown metric', 'metric=profit&days=30'],
      ['too many days', 'metric=mrr&days=9999'],
      ['no metric', 'days=30'],
    ])('refuses %s with 422', async (_label, query) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect(
        (await http().get(`${ctx.base}/analytics/series?${query}`).set('Cookie', ctx.cookie))
          .status,
      ).toBe(422)
    })

    /** The reason this is an action rather than an http.request to itself. */
    it('can be captured by a scheduled workflow', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await subscribe(ctx, 4900)

      const workflow = await http()
        .post(`${ctx.base}/workflows`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Nightly snapshot', steps: [{ action: 'analytics.snapshot' }] })
      expect(workflow.status).toBe(201)

      const run = await http()
        .post(`${ctx.base}/workflows/${workflow.body.id}/run`)
        .set('Cookie', ctx.cookie)

      expect(run.body.status).toBe('succeeded')
      expect(await db.select().from(metricSnapshots)).toHaveLength(1)
    })
  })

  describe('isolation', () => {
    it('shows one tenant nothing of another’s numbers', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      await subscribe(owner, 4900)
      const other = await signUp('other@onestack.test', 'Other')

      expect((await summary(other)).body.mrrMicroUsd).toBe(0)
    })

    it('refuses an outsider entirely', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      expect(
        (await http().get(`${owner.base}/analytics/summary`).set('Cookie', outsider.cookie)).status,
      ).toBe(404)
    })

    it('lets a member read but not record', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await sql.unsafe(`update memberships set role = 'member' where user_id = '${ctx.userId}'`)

      expect((await summary(ctx)).status).toBe(200)
      expect(
        (
          await http().post(`${ctx.base}/ledger`).set('Cookie', ctx.cookie).send({
            entryDate: '2026-08-01',
            kind: 'cost',
            category: 'infrastructure',
            amountMicroUsd: 1000,
          })
        ).status,
      ).toBe(403)
    })
  })
})
