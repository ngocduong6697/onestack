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
import { memberships, productPrices, subscriptions } from '../database/schema'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('subscriptions over HTTP', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined })
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

    const workspace = spaces.body[0]
    const base = `/orgs/${org.id}/workspaces/${workspace.id}`

    return { cookie, userId: response.body.id as string, org, workspace, base }
  }

  type Ctx = Awaited<ReturnType<typeof signUp>>

  /** A customer and a price, which every subscription needs. */
  const scaffold = async (ctx: Ctx, interval = 'month', amountCents = 4900) => {
    const customer = await http()
      .post(`${ctx.base}/customers`)
      .set('Cookie', ctx.cookie)
      .send({ name: 'Jane Doe', email: `jane-${Math.round(amountCents)}-${interval}@acme.test` })
    expect(customer.status).toBe(201)

    const product = await http()
      .post(`${ctx.base}/products`)
      .set('Cookie', ctx.cookie)
      .send({ name: `Plan ${interval} ${amountCents}` })
    expect(product.status).toBe(201)

    const price = await http()
      .post(`${ctx.base}/products/${product.body.id}/prices`)
      .set('Cookie', ctx.cookie)
      .send({ amountCents, currency: 'USD', interval })
    expect(price.status).toBe(201)

    return { customerId: customer.body.id as string, priceId: price.body.id as string }
  }

  const subscribe = (ctx: Ctx, body: Record<string, unknown>) =>
    http().post(`${ctx.base}/subscriptions`).set('Cookie', ctx.cookie).send(body)

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
      'truncate table sessions, subscriptions, product_prices, products, customer_notes, customers, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('subscribing', () => {
    it('creates an active subscription with a period', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)

      const response = await subscribe(ctx, { customerId, priceId })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ status: 'active', cancelAtPeriodEnd: false })
      expect(response.body.currentPeriodStart).not.toBeNull()
      expect(response.body.currentPeriodEnd).not.toBeNull()
      expect(response.body.trialEndsAt).toBeNull()
    })

    it('starts a trial when asked', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)

      const response = await subscribe(ctx, { customerId, priceId, trialDays: 14 })

      expect(response.body.status).toBe('trialing')
      expect(response.body.trialEndsAt).not.toBeNull()
      // The period still runs from now; a trial marks status, not billing.
      expect(response.body.currentPeriodStart).not.toBeNull()
    })

    it('gives a one-off price no period', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx, 'one_time', 250_000)

      const response = await subscribe(ctx, { customerId, priceId })

      expect(response.status).toBe(201)
      expect(response.body.currentPeriodStart).toBeNull()
      expect(response.body.currentPeriodEnd).toBeNull()
    })

    it('refuses a second live subscription to the same price', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      await subscribe(ctx, { customerId, priceId })

      const duplicate = await subscribe(ctx, { customerId, priceId })

      expect(duplicate.status).toBe(409)
    })

    it('allows resubscribing after cancelling', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      const first = await subscribe(ctx, { customerId, priceId })

      await http()
        .post(`${ctx.base}/subscriptions/${first.body.id}/cancel`)
        .set('Cookie', ctx.cookie)
        .send({ immediately: true })

      expect((await subscribe(ctx, { customerId, priceId })).status).toBe(201)
    })

    it.each([
      ['a customer that does not exist', 'customer'],
      ['a price that does not exist', 'price'],
    ])('rejects %s with 404', async (_label, which) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      const missing = '01a01a00-0000-7000-8000-000000000000'

      const response = await subscribe(ctx, {
        customerId: which === 'customer' ? missing : customerId,
        priceId: which === 'price' ? missing : priceId,
      })

      expect(response.status).toBe(404)
    })
  })

  describe('crossing a workspace boundary', () => {
    it('refuses a customer from another workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const mine = await scaffold(ctx)

      const second = await http()
        .post(`/orgs/${ctx.org.id}/workspaces`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Second' })
      const otherCustomer = await http()
        .post(`/orgs/${ctx.org.id}/workspaces/${second.body.id}/customers`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Elsewhere' })

      const response = await subscribe(ctx, {
        customerId: otherCustomer.body.id,
        priceId: mine.priceId,
      })

      expect(response.status).toBe(404)
    })

    it('refuses a price from another workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const mine = await scaffold(ctx)

      const second = await http()
        .post(`/orgs/${ctx.org.id}/workspaces`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Second' })
      const otherProduct = await http()
        .post(`/orgs/${ctx.org.id}/workspaces/${second.body.id}/products`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Elsewhere' })
      const otherPrice = await http()
        .post(
          `/orgs/${ctx.org.id}/workspaces/${second.body.id}/products/${otherProduct.body.id}/prices`,
        )
        .set('Cookie', ctx.cookie)
        .send({ amountCents: 100, currency: 'USD', interval: 'month' })

      const response = await subscribe(ctx, {
        customerId: mine.customerId,
        priceId: otherPrice.body.id,
      })

      expect(response.status).toBe(404)
    })

    it('hides subscriptions from an outsider', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      const response = await http()
        .get(`${owner.base}/subscriptions`)
        .set('Cookie', outsider.cookie)

      expect(response.status).toBe(404)
    })
  })

  describe('cancelling and resuming', () => {
    const start = async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      const created = await subscribe(ctx, { customerId, priceId })

      return { ctx, id: created.body.id as string }
    }

    /** Cancelling should not take away time already paid for. */
    it('defaults to cancelling at the end of the period', async () => {
      const { ctx, id } = await start()

      const response = await http()
        .post(`${ctx.base}/subscriptions/${id}/cancel`)
        .set('Cookie', ctx.cookie)
        .send({})

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ status: 'active', cancelAtPeriodEnd: true })
      expect(response.body.endedAt).toBeNull()
    })

    it('cancels immediately when asked', async () => {
      const { ctx, id } = await start()

      const response = await http()
        .post(`${ctx.base}/subscriptions/${id}/cancel`)
        .set('Cookie', ctx.cookie)
        .send({ immediately: true })

      expect(response.body).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: false })
      expect(response.body.endedAt).not.toBeNull()
      expect(response.body.canceledAt).not.toBeNull()
    })

    it('resumes a subscription scheduled to cancel', async () => {
      const { ctx, id } = await start()
      await http().post(`${ctx.base}/subscriptions/${id}/cancel`).set('Cookie', ctx.cookie).send({})

      const response = await http()
        .post(`${ctx.base}/subscriptions/${id}/resume`)
        .set('Cookie', ctx.cookie)

      expect(response.body).toMatchObject({ cancelAtPeriodEnd: false, canceledAt: null })
    })

    it('refuses to resume one that was never cancelled', async () => {
      const { ctx, id } = await start()

      expect(
        (await http().post(`${ctx.base}/subscriptions/${id}/resume`).set('Cookie', ctx.cookie))
          .status,
      ).toBe(409)
    })

    it('refuses to resume one that has ended', async () => {
      const { ctx, id } = await start()
      await http()
        .post(`${ctx.base}/subscriptions/${id}/cancel`)
        .set('Cookie', ctx.cookie)
        .send({ immediately: true })

      expect(
        (await http().post(`${ctx.base}/subscriptions/${id}/resume`).set('Cookie', ctx.cookie))
          .status,
      ).toBe(409)
    })

    it('refuses to cancel twice', async () => {
      const { ctx, id } = await start()
      await http()
        .post(`${ctx.base}/subscriptions/${id}/cancel`)
        .set('Cookie', ctx.cookie)
        .send({ immediately: true })

      expect(
        (
          await http()
            .post(`${ctx.base}/subscriptions/${id}/cancel`)
            .set('Cookie', ctx.cookie)
            .send({})
        ).status,
      ).toBe(409)
    })
  })

  describe('renewing', () => {
    it('advances the period from where the last one ended, not from now', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      const created = await subscribe(ctx, { customerId, priceId })

      // Pretend the renewal is running late: the period ended yesterday.
      const endedYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      await db
        .update(subscriptions)
        .set({ currentPeriodEnd: endedYesterday })
        .where(eq(subscriptions.id, created.body.id))

      const renewed = await http()
        .post(`${ctx.base}/subscriptions/${created.body.id}/renew`)
        .set('Cookie', ctx.cookie)

      // The new period starts when the old one ended, so no time is lost.
      expect(new Date(renewed.body.currentPeriodStart).getTime()).toBe(endedYesterday.getTime())
      expect(new Date(renewed.body.currentPeriodEnd).getTime()).toBeGreaterThan(
        endedYesterday.getTime(),
      )
    })

    it('turns a trial into an active subscription', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      const created = await subscribe(ctx, { customerId, priceId, trialDays: 14 })

      const renewed = await http()
        .post(`${ctx.base}/subscriptions/${created.body.id}/renew`)
        .set('Cookie', ctx.cookie)

      expect(renewed.body.status).toBe('active')
    })

    /** Renewal is where a scheduled cancellation actually takes effect. */
    it('ends a subscription that was scheduled to cancel', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      const created = await subscribe(ctx, { customerId, priceId })
      await http()
        .post(`${ctx.base}/subscriptions/${created.body.id}/cancel`)
        .set('Cookie', ctx.cookie)
        .send({})

      const renewed = await http()
        .post(`${ctx.base}/subscriptions/${created.body.id}/renew`)
        .set('Cookie', ctx.cookie)

      expect(renewed.body.status).toBe('canceled')
      expect(renewed.body.endedAt).not.toBeNull()
    })

    it('refuses to renew a one-off subscription', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx, 'one_time', 250_000)
      const created = await subscribe(ctx, { customerId, priceId })

      expect(
        (
          await http()
            .post(`${ctx.base}/subscriptions/${created.body.id}/renew`)
            .set('Cookie', ctx.cookie)
        ).status,
      ).toBe(409)
    })
  })

  describe('changing price', () => {
    it('moves the subscription onto another price', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      const created = await subscribe(ctx, { customerId, priceId })
      const upgrade = await scaffold(ctx, 'month', 9900)

      const response = await http()
        .patch(`${ctx.base}/subscriptions/${created.body.id}`)
        .set('Cookie', ctx.cookie)
        .send({ priceId: upgrade.priceId })

      expect(response.status).toBe(200)
      expect(response.body.priceId).toBe(upgrade.priceId)
    })

    it('refuses a price from another workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      const created = await subscribe(ctx, { customerId, priceId })

      const second = await http()
        .post(`/orgs/${ctx.org.id}/workspaces`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Second' })
      const otherProduct = await http()
        .post(`/orgs/${ctx.org.id}/workspaces/${second.body.id}/products`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Elsewhere' })
      const otherPrice = await http()
        .post(
          `/orgs/${ctx.org.id}/workspaces/${second.body.id}/products/${otherProduct.body.id}/prices`,
        )
        .set('Cookie', ctx.cookie)
        .send({ amountCents: 100, currency: 'USD', interval: 'month' })

      const response = await http()
        .patch(`${ctx.base}/subscriptions/${created.body.id}`)
        .set('Cookie', ctx.cookie)
        .send({ priceId: otherPrice.body.id })

      expect(response.status).toBe(404)
    })
  })

  describe('the summary', () => {
    /** The route ordering hazard: `summary` must not be read as an id. */
    it('is not swallowed by the :id route', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http()
        .get(`${ctx.base}/subscriptions/summary`)
        .set('Cookie', ctx.cookie)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('mrr')
    })

    it('adds monthly and yearly into one monthly figure', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const monthly = await scaffold(ctx, 'month', 4900)
      const yearly = await scaffold(ctx, 'year', 120_000)
      await subscribe(ctx, monthly)
      await subscribe(ctx, yearly)

      const summary = await http()
        .get(`${ctx.base}/subscriptions/summary`)
        .set('Cookie', ctx.cookie)

      expect(summary.body.mrr).toEqual([{ currency: 'USD', amountCents: 4900 + 10_000 }])
      expect(summary.body.activeCount).toBe(2)
    })

    it('excludes one-off prices and cancelled subscriptions', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const monthly = await scaffold(ctx, 'month', 4900)
      const oneOff = await scaffold(ctx, 'one_time', 500_000)
      const doomed = await scaffold(ctx, 'month', 1900)
      await subscribe(ctx, monthly)
      await subscribe(ctx, oneOff)
      const cancelled = await subscribe(ctx, doomed)
      await http()
        .post(`${ctx.base}/subscriptions/${cancelled.body.id}/cancel`)
        .set('Cookie', ctx.cookie)
        .send({ immediately: true })

      const summary = await http()
        .get(`${ctx.base}/subscriptions/summary`)
        .set('Cookie', ctx.cookie)

      expect(summary.body.mrr).toEqual([{ currency: 'USD', amountCents: 4900 }])
      expect(summary.body.countsByStatus.canceled).toBe(1)
    })

    it('counts a trial as earning, because it is expected to convert', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      await subscribe(ctx, { customerId, priceId, trialDays: 14 })

      const summary = await http()
        .get(`${ctx.base}/subscriptions/summary`)
        .set('Cookie', ctx.cookie)

      expect(summary.body.mrr).toEqual([{ currency: 'USD', amountCents: 4900 }])
      expect(summary.body.countsByStatus.trialing).toBe(1)
    })

    it('is empty for a workspace with nothing in it', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const summary = await http()
        .get(`${ctx.base}/subscriptions/summary`)
        .set('Cookie', ctx.cookie)

      expect(summary.body).toEqual({ mrr: [], countsByStatus: {}, activeCount: 0 })
    })
  })

  describe('the price that must not vanish', () => {
    /** restrict, not cascade: what the customer agreed to has to survive. */
    it('refuses to delete a price something is subscribed to', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      await subscribe(ctx, { customerId, priceId })

      await expect(db.delete(productPrices).where(eq(productPrices.id, priceId))).rejects.toThrow()
    })
  })

  describe('permissions', () => {
    it('lets a member read but not write', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const { customerId, priceId } = await scaffold(ctx)
      await db.update(memberships).set({ role: 'member' }).where(eq(memberships.userId, ctx.userId))

      expect((await http().get(`${ctx.base}/subscriptions`).set('Cookie', ctx.cookie)).status).toBe(
        200,
      )
      expect((await subscribe(ctx, { customerId, priceId })).status).toBe(403)
    })
  })
})
