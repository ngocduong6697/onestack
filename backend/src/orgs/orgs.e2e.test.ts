import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { up } from '../database/migrate'
import * as schema from '../database/schema'
import { memberships, organizations, users, workspaces } from '../database/schema'
import { SESSION_COOKIE } from '../auth/session-cookie'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('organizations and workspaces over HTTP', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined })
  const db = drizzle(sql, { schema })

  /** Registers somebody and returns their cookie and their bootstrap org. */
  const signUp = async (email: string, name: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'a sufficiently long password', name })

    expect(response.status).toBe(201)

    const header = response.headers['set-cookie'] as unknown as string[]
    const cookie = header.find((entry) => entry.startsWith(SESSION_COOKIE))!
    const orgs = await request(app.getHttpServer()).get('/orgs').set('Cookie', cookie)
    // Asserted here so a failed setup names itself, rather than surfacing as
    // `undefined.id` further down and pointing at the wrong thing.
    expect(orgs.status).toBe(200)
    expect(orgs.body.length).toBeGreaterThan(0)

    return { cookie, userId: response.body.id as string, org: orgs.body[0] }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    process.env.THROTTLE_DISABLED = 'true'
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

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
      'truncate table sessions, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('registration bootstrap', () => {
    it('gives a new account an organization it owns and one workspace', async () => {
      const { cookie, org } = await signUp('founder@onestack.test', 'Founder')

      expect(org).toMatchObject({ name: "Founder's Organization", role: 'owner' })

      const spaces = await request(app.getHttpServer())
        .get(`/orgs/${org.id}/workspaces`)
        .set('Cookie', cookie)

      expect(spaces.status).toBe(200)
      expect(spaces.body).toHaveLength(1)
      expect(spaces.body[0]).toMatchObject({ name: 'General', slug: 'general' })
    })

    it('creates the account and the organization as one unit', async () => {
      await signUp('founder@onestack.test', 'Founder')

      expect(await db.select().from(users)).toHaveLength(1)
      expect(await db.select().from(organizations)).toHaveLength(1)
      expect(await db.select().from(memberships)).toHaveLength(1)
    })
  })

  describe('POST /orgs', () => {
    it('creates an organization the caller owns', async () => {
      const { cookie } = await signUp('founder@onestack.test', 'Founder')

      const response = await request(app.getHttpServer())
        .post('/orgs')
        .set('Cookie', cookie)
        .send({ name: 'Second Company' })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ name: 'Second Company', slug: 'second-company' })

      const mine = await request(app.getHttpServer()).get('/orgs').set('Cookie', cookie)
      expect(mine.body).toHaveLength(2)
    })

    it('suffixes a slug that is already taken', async () => {
      const { cookie } = await signUp('founder@onestack.test', 'Founder')

      await request(app.getHttpServer()).post('/orgs').set('Cookie', cookie).send({ name: 'Acme' })
      const second = await request(app.getHttpServer())
        .post('/orgs')
        .set('Cookie', cookie)
        .send({ name: 'Acme' })

      expect(second.body.slug).toBe('acme-2')
    })

    it('requires a session', async () => {
      const response = await request(app.getHttpServer()).post('/orgs').send({ name: 'Nope' })

      expect(response.status).toBe(401)
    })

    it('rejects a blank name with 422', async () => {
      const { cookie } = await signUp('founder@onestack.test', 'Founder')

      const response = await request(app.getHttpServer())
        .post('/orgs')
        .set('Cookie', cookie)
        .send({ name: '   ' })

      expect(response.status).toBe(422)
    })
  })

  describe('tenant isolation', () => {
    /**
     * The point of the whole task: another tenant's organization must be
     * indistinguishable from one that does not exist.
     */
    it('answers 404, never 403, for an organization the caller is not in', async () => {
      const outsider = await signUp('outsider@onestack.test', 'Outsider')
      const owner = await signUp('owner@onestack.test', 'Owner')

      const routes: [string, () => request.Test][] = [
        ['GET org', () => request(app.getHttpServer()).get(`/orgs/${owner.org.id}`)],
        [
          'PATCH org',
          () => request(app.getHttpServer()).patch(`/orgs/${owner.org.id}`).send({ name: 'Taken' }),
        ],
        [
          'GET workspaces',
          () => request(app.getHttpServer()).get(`/orgs/${owner.org.id}/workspaces`),
        ],
        [
          'POST workspace',
          () =>
            request(app.getHttpServer())
              .post(`/orgs/${owner.org.id}/workspaces`)
              .send({ name: 'Intrusion' }),
        ],
      ]

      for (const [label, call] of routes) {
        const response = await call().set('Cookie', outsider.cookie)

        expect(`${label}: ${response.status}`).toBe(`${label}: 404`)
      }
    })

    it('does not leak a workspace id that belongs to another organization', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      const theirs = await request(app.getHttpServer())
        .get(`/orgs/${owner.org.id}/workspaces`)
        .set('Cookie', owner.cookie)
      const workspaceId = theirs.body[0].id as string

      // The outsider is an admin — an owner, even — of their own organization,
      // and names a workspace id that genuinely exists. Still nothing.
      const response = await request(app.getHttpServer())
        .patch(`/orgs/${outsider.org.id}/workspaces/${workspaceId}`)
        .set('Cookie', outsider.cookie)
        .send({ name: 'Stolen' })

      expect(response.status).toBe(404)

      const untouched = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
      expect(untouched[0]?.name).toBe('General')
    })

    it('treats a malformed organization id as not found', async () => {
      const { cookie } = await signUp('founder@onestack.test', 'Founder')

      const response = await request(app.getHttpServer())
        .get('/orgs/not-a-uuid')
        .set('Cookie', cookie)

      expect(response.status).toBe(404)
    })

    it('lists only the caller’s organizations', async () => {
      const founder = await signUp('founder@onestack.test', 'Founder')
      await signUp('other@onestack.test', 'Other')

      const mine = await request(app.getHttpServer()).get('/orgs').set('Cookie', founder.cookie)

      expect(mine.body).toHaveLength(1)
      expect(mine.body[0].id).toBe(founder.org.id)
    })
  })

  describe('roles', () => {
    /** Demotes the caller so the admin-only routes can be tested honestly. */
    const demote = async (userId: string) => {
      await db.update(memberships).set({ role: 'member' }).where(eq(memberships.userId, userId))
    }

    it('lets a member read but not write', async () => {
      const { cookie, userId, org } = await signUp('member@onestack.test', 'Member')
      await demote(userId)

      const read = await request(app.getHttpServer()).get(`/orgs/${org.id}`).set('Cookie', cookie)
      expect(read.status).toBe(200)

      const write = await request(app.getHttpServer())
        .patch(`/orgs/${org.id}`)
        .set('Cookie', cookie)
        .send({ name: 'Renamed' })
      expect(write.status).toBe(403)
      expect(write.body.error.code).toBe('forbidden')
    })

    it.each(['admin', 'owner'] as const)('lets %s write', async (role) => {
      const { cookie, userId, org } = await signUp('writer@onestack.test', 'Writer')
      await db.update(memberships).set({ role }).where(eq(memberships.userId, userId))

      const response = await request(app.getHttpServer())
        .patch(`/orgs/${org.id}`)
        .set('Cookie', cookie)
        .send({ name: 'Renamed' })

      expect(response.status).toBe(200)
      expect(response.body.name).toBe('Renamed')
    })

    it('refuses workspace writes to a member', async () => {
      const { cookie, userId, org } = await signUp('member@onestack.test', 'Member')
      await demote(userId)

      const created = await request(app.getHttpServer())
        .post(`/orgs/${org.id}/workspaces`)
        .set('Cookie', cookie)
        .send({ name: 'Nope' })

      expect(created.status).toBe(403)
    })
  })

  describe('workspaces', () => {
    it('creates, renames and deletes within the organization', async () => {
      const { cookie, org } = await signUp('founder@onestack.test', 'Founder')

      const created = await request(app.getHttpServer())
        .post(`/orgs/${org.id}/workspaces`)
        .set('Cookie', cookie)
        .send({ name: 'Client Work' })
      expect(created.status).toBe(201)
      expect(created.body).toMatchObject({ slug: 'client-work', organizationId: org.id })

      const renamed = await request(app.getHttpServer())
        .patch(`/orgs/${org.id}/workspaces/${created.body.id}`)
        .set('Cookie', cookie)
        .send({ name: 'Client Projects' })
      expect(renamed.body.name).toBe('Client Projects')

      const removed = await request(app.getHttpServer())
        .delete(`/orgs/${org.id}/workspaces/${created.body.id}`)
        .set('Cookie', cookie)
      expect(removed.status).toBe(204)

      const remaining = await request(app.getHttpServer())
        .get(`/orgs/${org.id}/workspaces`)
        .set('Cookie', cookie)
      expect(remaining.body).toHaveLength(1)
    })

    it('scopes slugs per organization, so two tenants may both have one', async () => {
      const first = await signUp('first@onestack.test', 'First')
      const second = await signUp('second@onestack.test', 'Second')

      const a = await request(app.getHttpServer())
        .post(`/orgs/${first.org.id}/workspaces`)
        .set('Cookie', first.cookie)
        .send({ name: 'Shared Name' })
      const b = await request(app.getHttpServer())
        .post(`/orgs/${second.org.id}/workspaces`)
        .set('Cookie', second.cookie)
        .send({ name: 'Shared Name' })

      expect(a.body.slug).toBe('shared-name')
      expect(b.body.slug).toBe('shared-name')
    })

    it('suffixes a duplicate slug inside one organization', async () => {
      const { cookie, org } = await signUp('founder@onestack.test', 'Founder')

      // Registration already created a workspace holding the slug 'general'.
      const second = await request(app.getHttpServer())
        .post(`/orgs/${org.id}/workspaces`)
        .set('Cookie', cookie)
        .send({ name: 'General' })
      expect(second.body.slug).toBe('general-2')

      const third = await request(app.getHttpServer())
        .post(`/orgs/${org.id}/workspaces`)
        .set('Cookie', cookie)
        .send({ name: 'General' })
      expect(third.body.slug).toBe('general-3')
    })
  })

  describe('cascades', () => {
    it('deleting an organization removes its workspaces and memberships', async () => {
      const { org } = await signUp('founder@onestack.test', 'Founder')

      await db.delete(organizations).where(eq(organizations.id, org.id))

      expect(await db.select().from(workspaces)).toEqual([])
      expect(await db.select().from(memberships)).toEqual([])
      expect(await db.select().from(users)).toHaveLength(1)
    })

    it('deleting a user removes their membership but leaves the organization', async () => {
      const { userId, org } = await signUp('founder@onestack.test', 'Founder')

      await db.delete(users).where(eq(users.id, userId))

      expect(await db.select().from(memberships)).toEqual([])
      const remaining = await db.select().from(organizations).where(eq(organizations.id, org.id))
      expect(remaining).toHaveLength(1)
    })
  })
})
