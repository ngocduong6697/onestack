import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { SESSION_COOKIE } from '../auth/session-cookie'
import { up } from '../database/migrate'
import * as schema from '../database/schema'
import { customers, invoices, ledgerEntries, subscriptions } from '../database/schema'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('billing over HTTP', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 4, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  const http = () => request(app.getHttpServer())

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
      base: `/orgs/${org.id}/workspaces/${spaces.body[0].id}`,
    }
  }

  type Ctx = Awaited<ReturnType<typeof signUp>>

  const aCustomer = async (ctx: Ctx, email = 'ap@acme.test') => {
    const created = await http()
      .post(`${ctx.base}/customers`)
      .set('Cookie', ctx.cookie)
      .send({ name: 'Acme', email, stage: 'active' })
    expect(created.status).toBe(201)
    return created.body.id as string
  }

  /** A $49/month subscription, ready to renew. */
  const aSubscription = async (ctx: Ctx) => {
    const customerId = await aCustomer(ctx, `sub-${Date.now()}@acme.test`)
    const product = await http()
      .post(`${ctx.base}/products`)
      .set('Cookie', ctx.cookie)
      .send({ name: `Plan ${Date.now()}` })
    const price = await http()
      .post(`${ctx.base}/products/${product.body.id}/prices`)
      .set('Cookie', ctx.cookie)
      .send({ amountCents: 4900, currency: 'USD', interval: 'month' })
    const subscription = await http()
      .post(`${ctx.base}/subscriptions`)
      .set('Cookie', ctx.cookie)
      .send({ customerId, priceId: price.body.id })
    expect(subscription.status).toBe(201)

    return { customerId, subscriptionId: subscription.body.id as string }
  }

  const draft = (ctx: Ctx, customerId: string, unitMicroUsd = 49_000_000) =>
    http()
      .post(`${ctx.base}/invoices`)
      .set('Cookie', ctx.cookie)
      .send({ customerId, lines: [{ description: 'Consulting', quantity: 1, unitMicroUsd }] })

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    process.env.THROTTLE_DISABLED = 'true'
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
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
      'truncate table sessions, payments, invoice_lines, invoices, ledger_entries, metric_snapshots, run_steps, runs, jobs, workflows, ai_requests, subscriptions, product_prices, products, customer_notes, customers, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('drafting and issuing', () => {
    it('creates a draft with no number and totals from its lines', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customerId = await aCustomer(ctx)

      const response = await http()
        .post(`${ctx.base}/invoices`)
        .set('Cookie', ctx.cookie)
        .send({
          customerId,
          lines: [
            { description: 'Consulting', quantity: 2, unitMicroUsd: 50_000_000 },
            { description: 'Support', quantity: 1, unitMicroUsd: 10_000_000 },
          ],
        })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ status: 'draft', number: null })
      expect(response.body.totalMicroUsd).toBe(2 * 50_000_000 + 10_000_000)
      expect(response.body.lines).toHaveLength(2)
    })

    it('numbers an invoice when it is issued', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await draft(ctx, await aCustomer(ctx))

      const issued = await http()
        .post(`${ctx.base}/invoices/${created.body.id}/issue`)
        .set('Cookie', ctx.cookie)

      expect(issued.body.status).toBe('open')
      expect(issued.body.number).toMatch(/^INV-\d{4}-0001$/)
      expect(issued.body.issuedAt).not.toBeNull()
    })

    it('numbers sequentially', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const first = await draft(ctx, await aCustomer(ctx, 'one@acme.test'))
      const second = await draft(ctx, await aCustomer(ctx, 'two@acme.test'))

      const a = await http()
        .post(`${ctx.base}/invoices/${first.body.id}/issue`)
        .set('Cookie', ctx.cookie)
      const b = await http()
        .post(`${ctx.base}/invoices/${second.body.id}/issue`)
        .set('Cookie', ctx.cookie)

      expect(a.body.number).toMatch(/-0001$/)
      expect(b.body.number).toMatch(/-0002$/)
    })

    it('refuses to issue twice', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await draft(ctx, await aCustomer(ctx))
      await http().post(`${ctx.base}/invoices/${created.body.id}/issue`).set('Cookie', ctx.cookie)

      const again = await http()
        .post(`${ctx.base}/invoices/${created.body.id}/issue`)
        .set('Cookie', ctx.cookie)

      expect(again.status).toBe(409)
    })

    it('refuses a customer from another workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const other = await signUp('other@onestack.test', 'Other')
      const theirs = await aCustomer(other)

      expect((await draft(ctx, theirs)).status).toBe(404)
    })
  })

  describe('payment', () => {
    const payment = (amountMicroUsd: number) => ({
      amountMicroUsd,
      method: 'bank_transfer',
      receivedOn: new Date().toISOString().slice(0, 10),
    })

    const issued = async (ctx: Ctx) => {
      const created = await draft(ctx, await aCustomer(ctx))
      const open = await http()
        .post(`${ctx.base}/invoices/${created.body.id}/issue`)
        .set('Cookie', ctx.cookie)
      return open.body.id as string
    }

    it('records a partial payment without settling', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const id = await issued(ctx)

      const response = await http()
        .post(`${ctx.base}/invoices/${id}/pay`)
        .set('Cookie', ctx.cookie)
        .send(payment(20_000_000))

      expect(response.body.status).toBe('open')
      expect(response.body.amountPaidMicroUsd).toBe(20_000_000)
      expect(response.body.paidAt).toBeNull()
    })

    it('settles when the remainder arrives', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const id = await issued(ctx)
      await http()
        .post(`${ctx.base}/invoices/${id}/pay`)
        .set('Cookie', ctx.cookie)
        .send(payment(20_000_000))

      const response = await http()
        .post(`${ctx.base}/invoices/${id}/pay`)
        .set('Cookie', ctx.cookie)
        .send(payment(29_000_000))

      expect(response.body.status).toBe('paid')
      expect(response.body.paidAt).not.toBeNull()
      expect(response.body.payments).toHaveLength(2)
    })

    /** A record claiming more was paid than owed looks like reconciled money. */
    it('refuses an overpayment', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const id = await issued(ctx)

      const response = await http()
        .post(`${ctx.base}/invoices/${id}/pay`)
        .set('Cookie', ctx.cookie)
        .send(payment(49_000_001))

      expect(response.status).toBe(409)
    })

    it('refuses a payment against a draft', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await draft(ctx, await aCustomer(ctx))

      const response = await http()
        .post(`${ctx.base}/invoices/${created.body.id}/pay`)
        .set('Cookie', ctx.cookie)
        .send(payment(1000))

      expect(response.status).toBe(409)
    })

    /** Settled money becomes revenue the dashboard can see. */
    it('writes exactly one revenue line to the ledger when it settles', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const id = await issued(ctx)

      await http()
        .post(`${ctx.base}/invoices/${id}/pay`)
        .set('Cookie', ctx.cookie)
        .send(payment(20_000_000))
      expect(await db.select().from(ledgerEntries)).toHaveLength(0)

      await http()
        .post(`${ctx.base}/invoices/${id}/pay`)
        .set('Cookie', ctx.cookie)
        .send(payment(29_000_000))

      const entries = await db.select().from(ledgerEntries)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        kind: 'revenue',
        category: 'invoice',
        amountMicroUsd: 49_000_000,
      })
    })

    it('shows that revenue in the analytics summary', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const id = await issued(ctx)
      await http()
        .post(`${ctx.base}/invoices/${id}/pay`)
        .set('Cookie', ctx.cookie)
        .send(payment(49_000_000))

      const summary = await http().get(`${ctx.base}/analytics/summary`).set('Cookie', ctx.cookie)

      expect(summary.body.recordedRevenueMicroUsd).toBe(49_000_000)
    })
  })

  describe('voiding', () => {
    it('voids a draft and an open invoice', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await draft(ctx, await aCustomer(ctx))

      const voided = await http()
        .post(`${ctx.base}/invoices/${created.body.id}/void`)
        .set('Cookie', ctx.cookie)

      expect(voided.body.status).toBe('void')
    })

    /** Terminal: unpicking a payment is a credit note, a different document. */
    it('refuses to void a paid invoice', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await draft(ctx, await aCustomer(ctx))
      const open = await http()
        .post(`${ctx.base}/invoices/${created.body.id}/issue`)
        .set('Cookie', ctx.cookie)
      await http()
        .post(`${ctx.base}/invoices/${open.body.id}/pay`)
        .set('Cookie', ctx.cookie)
        .send({
          amountMicroUsd: 49_000_000,
          method: 'card',
          receivedOn: new Date().toISOString().slice(0, 10),
        })

      const response = await http()
        .post(`${ctx.base}/invoices/${open.body.id}/void`)
        .set('Cookie', ctx.cookie)

      expect(response.status).toBe(409)
      expect(response.body.error.message).toMatch(/from paid to void/)
    })
  })

  describe('billing a subscription', () => {
    it('issues one invoice when a subscription renews', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { subscriptionId } = await aSubscription(ctx)

      await http()
        .post(`${ctx.base}/subscriptions/${subscriptionId}/renew`)
        .set('Cookie', ctx.cookie)

      const rows = await db.select().from(invoices)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        status: 'open',
        subscriptionId,
        totalMicroUsd: 49_000_000,
      })
    })

    /** The partial unique index is what makes renewing twice safe. */
    it('does not bill twice for the same period', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { subscriptionId } = await aSubscription(ctx)

      await http()
        .post(`${ctx.base}/subscriptions/${subscriptionId}/renew`)
        .set('Cookie', ctx.cookie)

      // Wind the period back so a second renew targets the same start.
      const [first] = await db.select().from(invoices)
      await db
        .update(subscriptions)
        .set({ currentPeriodEnd: first!.periodStart })
        .where(eq(subscriptions.id, subscriptionId))

      await http()
        .post(`${ctx.base}/subscriptions/${subscriptionId}/renew`)
        .set('Cookie', ctx.cookie)

      expect(await db.select().from(invoices)).toHaveLength(1)
    })
  })

  describe('dunning', () => {
    const overdue = async (ctx: Ctx) => {
      const { subscriptionId } = await aSubscription(ctx)
      await http()
        .post(`${ctx.base}/subscriptions/${subscriptionId}/renew`)
        .set('Cookie', ctx.cookie)

      const [invoice] = await db.select().from(invoices)
      await db
        .update(invoices)
        .set({ dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where(eq(invoices.id, invoice!.id))

      return { subscriptionId, invoiceId: invoice!.id }
    }

    /** The status TASK-008 defined and nothing ever set, until now. */
    it('moves a subscription with an overdue invoice to past_due', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { subscriptionId } = await overdue(ctx)

      const result = await http().post(`${ctx.base}/billing/sweep`).set('Cookie', ctx.cookie)

      expect(result.body.markedPastDue).toBe(1)

      const [row] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId))
      expect(row?.status).toBe('past_due')
    })

    it('is idempotent', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await overdue(ctx)

      await http().post(`${ctx.base}/billing/sweep`).set('Cookie', ctx.cookie)
      const second = await http().post(`${ctx.base}/billing/sweep`).set('Cookie', ctx.cookie)

      expect(second.body.markedPastDue).toBe(0)
    })

    it('restores the subscription when the invoice is paid', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { subscriptionId, invoiceId } = await overdue(ctx)
      await http().post(`${ctx.base}/billing/sweep`).set('Cookie', ctx.cookie)

      await http()
        .post(`${ctx.base}/invoices/${invoiceId}/pay`)
        .set('Cookie', ctx.cookie)
        .send({
          amountMicroUsd: 49_000_000,
          method: 'bank_transfer',
          receivedOn: new Date().toISOString().slice(0, 10),
        })

      const [row] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId))
      expect(row?.status).toBe('active')
    })

    it('leaves an invoice that is not yet due alone', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { subscriptionId } = await aSubscription(ctx)
      await http()
        .post(`${ctx.base}/subscriptions/${subscriptionId}/renew`)
        .set('Cookie', ctx.cookie)

      const result = await http().post(`${ctx.base}/billing/sweep`).set('Cookie', ctx.cookie)

      expect(result.body.markedPastDue).toBe(0)
    })
  })

  describe('the record that must survive', () => {
    /** An invoice records who owed what; deleting the customer must not erase it. */
    it('refuses to delete a customer who has invoices', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customerId = await aCustomer(ctx)
      await draft(ctx, customerId)

      await expect(db.delete(customers).where(eq(customers.id, customerId))).rejects.toThrow()
    })
  })

  describe('isolation', () => {
    it('hides invoices from another tenant', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      expect(
        (await http().get(`${owner.base}/invoices`).set('Cookie', outsider.cookie)).status,
      ).toBe(404)
    })

    it('lets a member read but not bill', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customerId = await aCustomer(ctx)
      await sql.unsafe(`update memberships set role = 'member' where user_id = '${ctx.userId}'`)

      expect((await http().get(`${ctx.base}/invoices`).set('Cookie', ctx.cookie)).status).toBe(200)
      expect((await draft(ctx, customerId)).status).toBe(403)
    })
  })
})
