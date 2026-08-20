import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { THROTTLER_GUARD } from '../common/throttler'
import { AppModule } from '../app.module'
import { SESSION_COOKIE } from '../auth/session-cookie'
import * as schema from '../database/schema'
import { up } from '../database/migrate'
import { memberships, productPrices } from '../database/schema'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('products over HTTP', () => {
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
    // Asserted here so a failed setup names itself, rather than surfacing as
    // `undefined.id` further down and pointing at the wrong thing.
    // Asserted here so a failed setup names itself, rather than surfacing as
    // `undefined.id` further down and pointing at the wrong thing.
    expect(orgs.status).toBe(200)
    expect(orgs.body.length).toBeGreaterThan(0)
    // Asserted, so a throttled or unauthorised response fails here by name
    // rather than surfacing as `undefined.id` three lines later.
    // Asserted here so a failed setup names itself, rather than surfacing as
    // `undefined.id` further down and pointing at the wrong thing.
    expect(orgs.status).toBe(200)
    expect(orgs.body.length).toBeGreaterThan(0)
    const org = orgs.body[0]
    const spaces = await http().get(`/orgs/${org.id}/workspaces`).set('Cookie', cookie)
    expect(spaces.status).toBe(200)
    expect(spaces.body.length).toBeGreaterThan(0)
    // Same reasoning as the /orgs assertion: name the failure here rather than
    // letting it surface as `undefined.id` on the next line.
    expect(`${spaces.status} ${JSON.stringify(spaces.body)}`).toMatch(/^200 \[\{/)

    return {
      cookie,
      userId: response.body.id as string,
      org,
      workspace: spaces.body[0],
      base: `/orgs/${org.id}/workspaces/${spaces.body[0].id}/products`,
    }
  }

  type Ctx = Awaited<ReturnType<typeof signUp>>

  const add = (ctx: Ctx, body: Record<string, unknown>) =>
    http().post(ctx.base).set('Cookie', ctx.cookie).send(body)

  const price = (ctx: Ctx, productId: string, body: Record<string, unknown>) =>
    http().post(`${ctx.base}/${productId}/prices`).set('Cookie', ctx.cookie).send(body)

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Rate limiting has its own test file; here it would only fail this
      // suite as the request count grows.
      .overrideProvider(THROTTLER_GUARD)
      .useValue({ canActivate: () => true })
      .compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    /**
     * Listening once matters. supertest starts a server on an ephemeral port
     * whenever the one it is given has no address, and closes it again when
     * the request finishes — roughly two hundred listen/close cycles per file.
     * Occasionally a request went out to a port that had just been released
     * and reassigned, and a server belonging to something else answered it:
     * a bare 404, empty body, never reaching this application at all. Holding
     * one port for the whole file removes the churn and the race with it.
     */
    await app.listen(0)
  })

  afterAll(async () => {
    await app.close()
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await sql.unsafe(
      'truncate table sessions, product_prices, products, customer_notes, customers, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('catalogue', () => {
    it('creates a product, active by default', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await add(ctx, { name: 'Pro Plan', sku: 'PRO', description: 'The good one' })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({
        name: 'Pro Plan',
        sku: 'PRO',
        status: 'active',
        workspaceId: ctx.workspace.id,
      })
    })

    it('updates name, sku and description', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await add(ctx, { name: 'Pro Plan' })

      const updated = await http()
        .patch(`${ctx.base}/${created.body.id}`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Professional', sku: 'PROF' })

      expect(updated.body).toMatchObject({ name: 'Professional', sku: 'PROF' })
    })

    it('refuses a duplicate SKU in one workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'One', sku: 'SAME' })

      expect((await add(ctx, { name: 'Two', sku: 'SAME' })).status).toBe(409)
    })

    it('allows any number of products without a SKU', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect((await add(ctx, { name: 'One' })).status).toBe(201)
      expect((await add(ctx, { name: 'Two' })).status).toBe(201)
      expect((await add(ctx, { name: 'Three' })).status).toBe(201)
    })

    it('searches name, sku and description', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'Pro Plan', sku: 'PRO-1', description: 'for teams' })
      await add(ctx, { name: 'Starter', sku: 'START', description: 'for one person' })

      const byName = await http().get(`${ctx.base}?q=pro`).set('Cookie', ctx.cookie)
      expect(byName.body.items).toHaveLength(1)

      const byDescription = await http().get(`${ctx.base}?q=one%20person`).set('Cookie', ctx.cookie)
      expect(byDescription.body.items[0].name).toBe('Starter')
    })

    it('paginates without gaps or repeats', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      for (let i = 0; i < 7; i += 1) await add(ctx, { name: `Product ${i}` })

      const seen: string[] = []
      let cursor: string | null = null

      do {
        const page: request.Response = await http()
          .get(`${ctx.base}?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
          .set('Cookie', ctx.cookie)
        seen.push(...page.body.items.map((p: { id: string }) => p.id))
        cursor = page.body.nextCursor
      } while (cursor)

      expect(seen).toHaveLength(7)
      expect(new Set(seen).size).toBe(7)
    })
  })

  describe('prices', () => {
    it('creates a price and returns it on the product', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })

      const created = await price(ctx, product.body.id, {
        amountCents: 4900,
        currency: 'usd',
        interval: 'month',
      })

      expect(created.status).toBe(201)
      // Uppercased on the way in, so 'usd' and 'USD' cannot diverge.
      expect(created.body).toMatchObject({ amountCents: 4900, currency: 'USD', active: true })

      const read = await http().get(`${ctx.base}/${product.body.id}`).set('Cookie', ctx.cookie)
      expect(read.body.prices).toHaveLength(1)
    })

    it('allows several prices for one product', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })

      await price(ctx, product.body.id, { amountCents: 4900, currency: 'USD', interval: 'month' })
      await price(ctx, product.body.id, { amountCents: 49000, currency: 'USD', interval: 'year' })

      const prices = await http()
        .get(`${ctx.base}/${product.body.id}/prices`)
        .set('Cookie', ctx.cookie)

      expect(prices.body).toHaveLength(2)
      expect(prices.body.map((p: { interval: string }) => p.interval)).toEqual(['month', 'year'])
    })

    it('allows a free price but not a negative one', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Free Tier' })

      expect(
        (await price(ctx, product.body.id, { amountCents: 0, currency: 'USD', interval: 'month' }))
          .status,
      ).toBe(201)
      expect(
        (await price(ctx, product.body.id, { amountCents: -1, currency: 'USD', interval: 'year' }))
          .status,
      ).toBe(422)
    })

    it.each([['US'], ['USDD'], ['12A'], ['']])('rejects the currency %o', async (currency) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })

      expect(
        (await price(ctx, product.body.id, { amountCents: 100, currency, interval: 'month' }))
          .status,
      ).toBe(422)
    })

    it('rejects a fractional amount, because money is minor units', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })

      expect(
        (
          await price(ctx, product.body.id, {
            amountCents: 49.5,
            currency: 'USD',
            interval: 'month',
          })
        ).status,
      ).toBe(422)
    })

    it('archives a price without changing its amount', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })
      const created = await price(ctx, product.body.id, {
        amountCents: 4900,
        currency: 'USD',
        interval: 'month',
      })

      const archived = await http()
        .post(`${ctx.base}/${product.body.id}/prices/${created.body.id}/archive`)
        .set('Cookie', ctx.cookie)

      expect(archived.status).toBe(201)
      expect(archived.body).toMatchObject({ active: false, amountCents: 4900 })
    })

    it('filters prices by active', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })
      const old = await price(ctx, product.body.id, {
        amountCents: 3900,
        currency: 'USD',
        interval: 'month',
      })
      await price(ctx, product.body.id, { amountCents: 4900, currency: 'USD', interval: 'month' })
      await http()
        .post(`${ctx.base}/${product.body.id}/prices/${old.body.id}/archive`)
        .set('Cookie', ctx.cookie)

      const active = await http()
        .get(`${ctx.base}/${product.body.id}/prices?active=true`)
        .set('Cookie', ctx.cookie)

      expect(active.body).toHaveLength(1)
      expect(active.body[0].amountCents).toBe(4900)
    })

    /**
     * The whole point of the model: raising a price must not change what an
     * existing subscriber already agreed to pay.
     */
    it('offers no route that changes an existing amount', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })
      const created = await price(ctx, product.body.id, {
        amountCents: 4900,
        currency: 'USD',
        interval: 'month',
      })

      // The product patch is the only update endpoint; price fields in its body
      // are simply not part of the schema.
      await http()
        .patch(`${ctx.base}/${product.body.id}`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Pro Plan', amountCents: 999999, currency: 'EUR', interval: 'year' })

      const rows = await db
        .select()
        .from(productPrices)
        .where(eq(productPrices.id, created.body.id))
      expect(rows[0]).toMatchObject({ amountCents: 4900, currency: 'USD', interval: 'month' })
    })

    it('will not price a product in another workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })
      const second = await http()
        .post(`/orgs/${ctx.org.id}/workspaces`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Second' })

      const response = await http()
        .post(`/orgs/${ctx.org.id}/workspaces/${second.body.id}/products/${product.body.id}/prices`)
        .set('Cookie', ctx.cookie)
        .send({ amountCents: 100, currency: 'USD', interval: 'month' })

      expect(response.status).toBe(404)
    })
  })

  describe('delete versus archive', () => {
    it('deletes a product that was never priced', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Never Sold' })

      const removed = await http()
        .delete(`${ctx.base}/${product.body.id}`)
        .set('Cookie', ctx.cookie)

      expect(removed.status).toBe(204)
    })

    it('refuses to delete a product that has prices, and says what to do', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })
      await price(ctx, product.body.id, { amountCents: 4900, currency: 'USD', interval: 'month' })

      const removed = await http()
        .delete(`${ctx.base}/${product.body.id}`)
        .set('Cookie', ctx.cookie)

      expect(removed.status).toBe(409)
      expect(removed.body.error.message).toMatch(/archive/i)
    })

    it('archives and unarchives, idempotently', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })

      const first = await http()
        .post(`${ctx.base}/${product.body.id}/archive`)
        .set('Cookie', ctx.cookie)
      expect(first.body.status).toBe('archived')

      const again = await http()
        .post(`${ctx.base}/${product.body.id}/archive`)
        .set('Cookie', ctx.cookie)
      expect(again.body.status).toBe('archived')

      const back = await http()
        .post(`${ctx.base}/${product.body.id}/unarchive`)
        .set('Cookie', ctx.cookie)
      expect(back.body.status).toBe('active')
    })

    /** Historic subscriptions must still resolve to what was agreed. */
    it('leaves prices readable after the product is archived', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })
      await price(ctx, product.body.id, { amountCents: 4900, currency: 'USD', interval: 'month' })

      await http().post(`${ctx.base}/${product.body.id}/archive`).set('Cookie', ctx.cookie)

      const read = await http().get(`${ctx.base}/${product.body.id}`).set('Cookie', ctx.cookie)
      expect(read.body.status).toBe('archived')
      expect(read.body.prices[0]).toMatchObject({ amountCents: 4900, active: true })
    })

    it('excludes archived products when filtering by active', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })
      await add(ctx, { name: 'Still Selling' })
      await http().post(`${ctx.base}/${product.body.id}/archive`).set('Cookie', ctx.cookie)

      const active = await http().get(`${ctx.base}?status=active`).set('Cookie', ctx.cookie)

      expect(active.body.items).toHaveLength(1)
      expect(active.body.items[0].name).toBe('Still Selling')
    })
  })

  describe('isolation and permissions', () => {
    it('hides products from another workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const product = await add(ctx, { name: 'Pro Plan' })
      const second = await http()
        .post(`/orgs/${ctx.org.id}/workspaces`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Second' })

      const response = await http()
        .get(`/orgs/${ctx.org.id}/workspaces/${second.body.id}/products/${product.body.id}`)
        .set('Cookie', ctx.cookie)

      expect(response.status).toBe(404)
    })

    it('refuses an outsider', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      expect((await http().get(owner.base).set('Cookie', outsider.cookie)).status).toBe(404)
    })

    it('lets a member read but not write', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'Pro Plan' })
      await db.update(memberships).set({ role: 'member' }).where(eq(memberships.userId, ctx.userId))

      expect((await http().get(ctx.base).set('Cookie', ctx.cookie)).status).toBe(200)
      expect((await add(ctx, { name: 'Nope' })).status).toBe(403)
    })
  })
})
