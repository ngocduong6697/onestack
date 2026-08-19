import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { SESSION_COOKIE } from '../auth/session-cookie'
import { up } from '../database/migrate'
import * as schema from '../database/schema'
import { customerNotes, memberships, users } from '../database/schema'
import type { Role } from '../orgs/roles'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('customers over HTTP', () => {
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
    const org = orgs.body[0]
    const spaces = await http().get(`/orgs/${org.id}/workspaces`).set('Cookie', cookie)

    return {
      cookie,
      userId: response.body.id as string,
      org,
      workspace: spaces.body[0],
      base: `/orgs/${org.id}/workspaces/${spaces.body[0].id}/customers`,
    }
  }

  const add = (ctx: { cookie: string; base: string }, body: Record<string, unknown>) =>
    http().post(ctx.base).set('Cookie', ctx.cookie).send(body)

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    process.env.THROTTLE_DISABLED = 'true'
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await sql.unsafe(
      'truncate table sessions, customer_notes, customers, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('records', () => {
    it('creates a customer as a lead by default', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await add(ctx, { name: 'Jane Doe', email: 'jane@acme.test' })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({
        name: 'Jane Doe',
        stage: 'lead',
        valueCents: 0,
        convertedAt: null,
        workspaceId: ctx.workspace.id,
      })
    })

    it('normalises blank optional fields to null', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await add(ctx, { name: 'Jane Doe', company: '   ', phone: '' })

      expect(response.body.company).toBeNull()
      expect(response.body.phone).toBeNull()
    })

    it('reads, updates and deletes', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await add(ctx, { name: 'Jane Doe' })

      const read = await http().get(`${ctx.base}/${created.body.id}`).set('Cookie', ctx.cookie)
      expect(read.status).toBe(200)

      const updated = await http()
        .patch(`${ctx.base}/${created.body.id}`)
        .set('Cookie', ctx.cookie)
        .send({ company: 'Acme', valueCents: 150_00 })
      expect(updated.body).toMatchObject({ company: 'Acme', valueCents: 15000 })

      const removed = await http()
        .delete(`${ctx.base}/${created.body.id}`)
        .set('Cookie', ctx.cookie)
      expect(removed.status).toBe(204)

      expect(
        (await http().get(`${ctx.base}/${created.body.id}`).set('Cookie', ctx.cookie)).status,
      ).toBe(404)
    })

    it.each([
      ['a blank name', { name: '  ' }],
      ['a malformed email', { name: 'Jane', email: 'not-an-email' }],
      ['a negative value', { name: 'Jane', valueCents: -1 }],
      ['a fractional value', { name: 'Jane', valueCents: 12.34 }],
      ['an unknown stage', { name: 'Jane', stage: 'prospect' }],
    ])('rejects %s with 422', async (_label, body) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect((await add(ctx, body)).status).toBe(422)
    })
  })

  describe('the pipeline', () => {
    it('stamps converted_at when a lead becomes active', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await add(ctx, { name: 'Jane Doe' })
      expect(created.body.convertedAt).toBeNull()

      const converted = await http()
        .patch(`${ctx.base}/${created.body.id}`)
        .set('Cookie', ctx.cookie)
        .send({ stage: 'active' })

      expect(converted.body.stage).toBe('active')
      expect(converted.body.convertedAt).not.toBeNull()
    })

    /** Somebody who churns and returns keeps the date they first converted. */
    it('never restamps converted_at', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await add(ctx, { name: 'Jane Doe', stage: 'active' })
      const first = created.body.convertedAt
      expect(first).not.toBeNull()

      await http()
        .patch(`${ctx.base}/${created.body.id}`)
        .set('Cookie', ctx.cookie)
        .send({ stage: 'churned' })
      const returned = await http()
        .patch(`${ctx.base}/${created.body.id}`)
        .set('Cookie', ctx.cookie)
        .send({ stage: 'active' })

      expect(returned.body.convertedAt).toBe(first)
    })

    it('filters by stage', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'A Lead' })
      await add(ctx, { name: 'A Customer', stage: 'active' })

      const active = await http().get(`${ctx.base}?stage=active`).set('Cookie', ctx.cookie)

      expect(active.body.items).toHaveLength(1)
      expect(active.body.items[0].name).toBe('A Customer')
    })
  })

  describe('search', () => {
    const seed = async (ctx: { cookie: string; base: string }) => {
      await add(ctx, { name: 'Jane Doe', email: 'jane@acme.test', company: 'Acme Corp' })
      await add(ctx, { name: 'John Smith', email: 'john@globex.test', company: 'Globex' })
      await add(ctx, { name: 'Discount Co', company: '100% Cotton' })
    }

    it.each([
      ['name', 'jane', 'Jane Doe'],
      ['email', 'globex.test', 'John Smith'],
      ['company', 'acme corp', 'Jane Doe'],
    ])('matches on %s, case-insensitively', async (_field, q, expected) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await seed(ctx)

      const found = await http()
        .get(`${ctx.base}?q=${encodeURIComponent(q)}`)
        .set('Cookie', ctx.cookie)

      expect(found.body.items).toHaveLength(1)
      expect(found.body.items[0].name).toBe(expected)
    })

    /** A wildcard typed by a person is a character, not an instruction. */
    it('treats % as a literal rather than matching everything', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await seed(ctx)

      const found = await http()
        .get(`${ctx.base}?q=${encodeURIComponent('100%')}`)
        .set('Cookie', ctx.cookie)

      expect(found.body.items).toHaveLength(1)
      expect(found.body.items[0].name).toBe('Discount Co')
    })

    it('treats _ as a literal', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'a_b' })
      await add(ctx, { name: 'axb' })

      const found = await http()
        .get(`${ctx.base}?q=${encodeURIComponent('a_b')}`)
        .set('Cookie', ctx.cookie)

      expect(found.body.items).toHaveLength(1)
      expect(found.body.items[0].name).toBe('a_b')
    })
  })

  describe('pagination', () => {
    it('walks every record exactly once, with no gaps or repeats', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      for (let i = 0; i < 12; i += 1) {
        await add(ctx, { name: `Customer ${String(i).padStart(2, '0')}` })
      }

      const seen: string[] = []
      let cursor: string | null = null

      do {
        const page: request.Response = await http()
          .get(`${ctx.base}?limit=5${cursor ? `&cursor=${cursor}` : ''}`)
          .set('Cookie', ctx.cookie)

        seen.push(...page.body.items.map((item: { id: string }) => item.id))
        cursor = page.body.nextCursor
      } while (cursor)

      expect(seen).toHaveLength(12)
      expect(new Set(seen).size).toBe(12)
    })

    it('reports no next cursor on the last page', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'Only One' })

      const page = await http().get(`${ctx.base}?limit=5`).set('Cookie', ctx.cookie)

      expect(page.body.items).toHaveLength(1)
      expect(page.body.nextCursor).toBeNull()
    })

    it.each([['0'], ['101'], ['abc']])('rejects a limit of %s with 422', async (limit) => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect(
        (await http().get(`${ctx.base}?limit=${limit}`).set('Cookie', ctx.cookie)).status,
      ).toBe(422)
    })

    it('rejects a malformed cursor', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect((await http().get(`${ctx.base}?cursor=nope`).set('Cookie', ctx.cookie)).status).toBe(
        422,
      )
    })
  })

  describe('the duplicate-email rule', () => {
    it('refuses the same address twice in one workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'Jane', email: 'jane@acme.test' })

      const duplicate = await add(ctx, { name: 'Jane Again', email: 'jane@acme.test' })

      expect(duplicate.status).toBe(409)
    })

    it('is case-insensitive, because the column is citext', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'Jane', email: 'jane@acme.test' })

      expect((await add(ctx, { name: 'Jane', email: 'JANE@ACME.test' })).status).toBe(409)
    })

    /** The partial index exists precisely so this works. */
    it('allows any number of records without an address', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      expect((await add(ctx, { name: 'No Email One' })).status).toBe(201)
      expect((await add(ctx, { name: 'No Email Two' })).status).toBe(201)
      expect((await add(ctx, { name: 'No Email Three' })).status).toBe(201)
    })

    it('lets two workspaces hold the same address', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'Jane', email: 'jane@acme.test' })

      const second = await http()
        .post(`/orgs/${ctx.org.id}/workspaces`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Second' })

      const response = await http()
        .post(`/orgs/${ctx.org.id}/workspaces/${second.body.id}/customers`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Jane', email: 'jane@acme.test' })

      expect(response.status).toBe(201)
    })
  })

  describe('isolation', () => {
    it('hides a customer from another workspace in the same organization', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await add(ctx, { name: 'Jane Doe' })

      const second = await http()
        .post(`/orgs/${ctx.org.id}/workspaces`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Second' })
      const otherBase = `/orgs/${ctx.org.id}/workspaces/${second.body.id}/customers`

      // Same person, same organization, owner of both — still not found.
      expect(
        (await http().get(`${otherBase}/${created.body.id}`).set('Cookie', ctx.cookie)).status,
      ).toBe(404)
      expect((await http().get(otherBase).set('Cookie', ctx.cookie)).body.items).toHaveLength(0)
    })

    it('refuses a workspace belonging to another organization', async () => {
      const mine = await signUp('founder@onestack.test', 'Founder')
      const theirs = await signUp('other@onestack.test', 'Other')

      // Their workspace id, my organization in the path.
      const response = await http()
        .get(`/orgs/${mine.org.id}/workspaces/${theirs.workspace.id}/customers`)
        .set('Cookie', mine.cookie)

      expect(response.status).toBe(404)
    })

    it('refuses an outsider entirely', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      expect((await http().get(owner.base).set('Cookie', outsider.cookie)).status).toBe(404)
    })

    it('ignores a cursor from another workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const created = await add(ctx, { name: 'Jane Doe' })

      const second = await http()
        .post(`/orgs/${ctx.org.id}/workspaces`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Second' })

      const page = await http()
        .get(`/orgs/${ctx.org.id}/workspaces/${second.body.id}/customers?cursor=${created.body.id}`)
        .set('Cookie', ctx.cookie)

      expect(page.status).toBe(200)
      expect(page.body.items).toEqual([])
    })
  })

  describe('permissions', () => {
    it('lets a member read but not write', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await add(ctx, { name: 'Jane Doe' })

      await db
        .update(memberships)
        .set({ role: 'member' as Role })
        .where(and(eq(memberships.userId, ctx.userId)))

      expect((await http().get(ctx.base).set('Cookie', ctx.cookie)).status).toBe(200)
      expect((await add(ctx, { name: 'Nope' })).status).toBe(403)
    })
  })

  describe('notes', () => {
    it('appends to a timeline, newest first', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customer = await add(ctx, { name: 'Jane Doe' })

      await http()
        .post(`${ctx.base}/${customer.body.id}/notes`)
        .set('Cookie', ctx.cookie)
        .send({ body: 'First call went well' })
      await http()
        .post(`${ctx.base}/${customer.body.id}/notes`)
        .set('Cookie', ctx.cookie)
        .send({ body: 'Sent the proposal' })

      const listed = await http()
        .get(`${ctx.base}/${customer.body.id}/notes`)
        .set('Cookie', ctx.cookie)

      expect(listed.body).toHaveLength(2)
      expect(listed.body[0].body).toBe('Sent the proposal')
      expect(listed.body[0].authorId).toBe(ctx.userId)
    })

    it('rejects an empty note', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customer = await add(ctx, { name: 'Jane Doe' })

      const response = await http()
        .post(`${ctx.base}/${customer.body.id}/notes`)
        .set('Cookie', ctx.cookie)
        .send({ body: '   ' })

      expect(response.status).toBe(422)
    })

    it('will not attach a note to a customer in another workspace', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customer = await add(ctx, { name: 'Jane Doe' })
      const second = await http()
        .post(`/orgs/${ctx.org.id}/workspaces`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Second' })

      const response = await http()
        .post(
          `/orgs/${ctx.org.id}/workspaces/${second.body.id}/customers/${customer.body.id}/notes`,
        )
        .set('Cookie', ctx.cookie)
        .send({ body: 'Should not land' })

      expect(response.status).toBe(404)
    })

    it('deletes notes with the customer', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customer = await add(ctx, { name: 'Jane Doe' })
      await http()
        .post(`${ctx.base}/${customer.body.id}/notes`)
        .set('Cookie', ctx.cookie)
        .send({ body: 'A note' })

      await http().delete(`${ctx.base}/${customer.body.id}`).set('Cookie', ctx.cookie)

      expect(await db.select().from(customerNotes)).toEqual([])
    })

    /** The note outlives its author leaving. */
    it('keeps a note when its author is deleted, with a null author', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customer = await add(ctx, { name: 'Jane Doe' })
      await http()
        .post(`${ctx.base}/${customer.body.id}/notes`)
        .set('Cookie', ctx.cookie)
        .send({ body: 'Said before they left' })

      await db.delete(users).where(eq(users.id, ctx.userId))

      const rows = await db.select().from(customerNotes)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.authorId).toBeNull()
      expect(rows[0]?.body).toBe('Said before they left')
    })
  })
})
