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
import { invitations, memberships } from '../database/schema'
import type { Role } from './roles'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('members and invitations over HTTP', () => {
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

    return { cookie, userId: response.body.id as string, org: orgs.body[0] }
  }

  const setRole = async (organizationId: string, userId: string, role: Role) => {
    await db
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
  }

  /** Invites somebody in and returns their cookie and id, at the given role. */
  const addMember = async (
    org: { id: string },
    inviterCookie: string,
    email: string,
    role: Role = 'member',
  ) => {
    const invite = await http()
      .post(`/orgs/${org.id}/invites`)
      .set('Cookie', inviterCookie)
      .send({ email, role })
    expect(invite.status).toBe(201)

    const joiner = await signUp(email, email.split('@')[0]!)
    const accepted = await http()
      .post(`/invites/${invite.body.token}/accept`)
      .set('Cookie', joiner.cookie)
    expect(accepted.status).toBe(200)

    return joiner
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
      'truncate table sessions, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('invitations', () => {
    it('returns the token exactly once, at creation', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')

      const created = await http()
        .post(`/orgs/${owner.org.id}/invites`)
        .set('Cookie', owner.cookie)
        .send({ email: 'invitee@onestack.test', role: 'member' })

      expect(created.status).toBe(201)
      expect(created.body.token).toMatch(/^[A-Za-z0-9_-]+$/)

      const listed = await http().get(`/orgs/${owner.org.id}/invites`).set('Cookie', owner.cookie)
      expect(listed.body).toHaveLength(1)
      expect(listed.body[0]).not.toHaveProperty('token')
      expect(JSON.stringify(listed.body)).not.toContain(created.body.token)
    })

    it('stores the token hashed, like a session', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const created = await http()
        .post(`/orgs/${owner.org.id}/invites`)
        .set('Cookie', owner.cookie)
        .send({ email: 'invitee@onestack.test' })

      const rows = await db.select().from(invitations)
      expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
      expect(rows[0]?.tokenHash).not.toBe(created.body.token)
    })

    it('lets the holder join, at the role they were invited as', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const joiner = await addMember(owner.org, owner.cookie, 'admin@onestack.test', 'admin')

      const theirOrgs = await http().get('/orgs').set('Cookie', joiner.cookie)
      const joined = theirOrgs.body.find((entry: { id: string }) => entry.id === owner.org.id)

      expect(joined).toMatchObject({ role: 'admin' })
    })

    it('is single-use', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const invite = await http()
        .post(`/orgs/${owner.org.id}/invites`)
        .set('Cookie', owner.cookie)
        .send({ email: 'invitee@onestack.test' })

      const first = await signUp('invitee@onestack.test', 'Invitee')
      expect(
        (await http().post(`/invites/${invite.body.token}/accept`).set('Cookie', first.cookie))
          .status,
      ).toBe(200)

      const second = await signUp('another@onestack.test', 'Another')
      const replay = await http()
        .post(`/invites/${invite.body.token}/accept`)
        .set('Cookie', second.cookie)

      expect(replay.status).toBe(404)
    })

    it('refuses an expired invitation', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const invite = await http()
        .post(`/orgs/${owner.org.id}/invites`)
        .set('Cookie', owner.cookie)
        .send({ email: 'invitee@onestack.test' })

      await db
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invitations.id, invite.body.id))

      const joiner = await signUp('invitee@onestack.test', 'Invitee')
      const response = await http()
        .post(`/invites/${invite.body.token}/accept`)
        .set('Cookie', joiner.cookie)

      expect(response.status).toBe(404)
    })

    it('refuses a revoked invitation', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const invite = await http()
        .post(`/orgs/${owner.org.id}/invites`)
        .set('Cookie', owner.cookie)
        .send({ email: 'invitee@onestack.test' })

      const revoked = await http()
        .delete(`/orgs/${owner.org.id}/invites/${invite.body.id}`)
        .set('Cookie', owner.cookie)
      expect(revoked.status).toBe(204)

      const joiner = await signUp('invitee@onestack.test', 'Invitee')
      expect(
        (await http().post(`/invites/${invite.body.token}/accept`).set('Cookie', joiner.cookie))
          .status,
      ).toBe(404)
    })

    it('refuses a garbage token', async () => {
      const joiner = await signUp('nobody@onestack.test', 'Nobody')

      expect(
        (await http().post('/invites/not-a-real-token/accept').set('Cookie', joiner.cookie)).status,
      ).toBe(404)
    })

    it('refuses when the caller already belongs', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const invite = await http()
        .post(`/orgs/${owner.org.id}/invites`)
        .set('Cookie', owner.cookie)
        .send({ email: 'owner@onestack.test' })

      const response = await http()
        .post(`/invites/${invite.body.token}/accept`)
        .set('Cookie', owner.cookie)

      expect(response.status).toBe(409)
    })

    it('refuses a second open invite for the same address', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const body = { email: 'invitee@onestack.test' }

      await http().post(`/orgs/${owner.org.id}/invites`).set('Cookie', owner.cookie).send(body)
      const second = await http()
        .post(`/orgs/${owner.org.id}/invites`)
        .set('Cookie', owner.cookie)
        .send(body)

      expect(second.status).toBe(409)
    })

    it('will not let an admin invite an owner', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const admin = await addMember(owner.org, owner.cookie, 'admin@onestack.test', 'admin')

      const response = await http()
        .post(`/orgs/${owner.org.id}/invites`)
        .set('Cookie', admin.cookie)
        .send({ email: 'usurper@onestack.test', role: 'owner' })

      expect(response.status).toBe(403)
    })

    it('is invisible to another tenant', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      expect(
        (await http().get(`/orgs/${owner.org.id}/invites`).set('Cookie', outsider.cookie)).status,
      ).toBe(404)
    })
  })

  describe('members', () => {
    it('lists everybody with their role', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      await addMember(owner.org, owner.cookie, 'member@onestack.test')

      const listed = await http().get(`/orgs/${owner.org.id}/members`).set('Cookie', owner.cookie)

      expect(listed.status).toBe(200)
      expect(listed.body).toHaveLength(2)
      expect(listed.body.map((m: { role: string }) => m.role).sort()).toEqual(['member', 'owner'])
    })

    it('lets an owner change a role', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const member = await addMember(owner.org, owner.cookie, 'member@onestack.test')

      const response = await http()
        .patch(`/orgs/${owner.org.id}/members/${member.userId}`)
        .set('Cookie', owner.cookie)
        .send({ role: 'admin' })

      expect(response.status).toBe(200)
      expect(response.body.role).toBe('admin')
    })

    it('refuses a member the right to change roles', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const member = await addMember(owner.org, owner.cookie, 'member@onestack.test')

      const response = await http()
        .patch(`/orgs/${owner.org.id}/members/${owner.userId}`)
        .set('Cookie', member.cookie)
        .send({ role: 'member' })

      expect(response.status).toBe(403)
    })

    it('will not let an admin touch an owner', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const admin = await addMember(owner.org, owner.cookie, 'admin@onestack.test', 'admin')

      const demote = await http()
        .patch(`/orgs/${owner.org.id}/members/${owner.userId}`)
        .set('Cookie', admin.cookie)
        .send({ role: 'member' })

      expect(demote.status).toBe(403)
    })

    it('will not let an admin promote themselves to owner', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const admin = await addMember(owner.org, owner.cookie, 'admin@onestack.test', 'admin')

      const response = await http()
        .patch(`/orgs/${owner.org.id}/members/${admin.userId}`)
        .set('Cookie', admin.cookie)
        .send({ role: 'owner' })

      expect(response.status).toBe(403)
    })

    it('lets an admin remove a member', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const admin = await addMember(owner.org, owner.cookie, 'admin@onestack.test', 'admin')
      const member = await addMember(owner.org, owner.cookie, 'member@onestack.test')

      const removed = await http()
        .delete(`/orgs/${owner.org.id}/members/${member.userId}`)
        .set('Cookie', admin.cookie)
      expect(removed.status).toBe(204)

      // Their access goes with the membership.
      expect((await http().get(`/orgs/${owner.org.id}`).set('Cookie', member.cookie)).status).toBe(
        404,
      )
    })

    it('lets a member leave, and only themselves', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const member = await addMember(owner.org, owner.cookie, 'member@onestack.test')
      const other = await addMember(owner.org, owner.cookie, 'other@onestack.test')

      const removingSomebodyElse = await http()
        .delete(`/orgs/${owner.org.id}/members/${other.userId}`)
        .set('Cookie', member.cookie)
      expect(removingSomebodyElse.status).toBe(403)

      const leaving = await http()
        .delete(`/orgs/${owner.org.id}/members/${member.userId}`)
        .set('Cookie', member.cookie)
      expect(leaving.status).toBe(204)
    })
  })

  describe('the last owner', () => {
    /** The invariant: an organization can never end up with nobody in charge. */
    it('cannot be demoted', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')

      const response = await http()
        .patch(`/orgs/${owner.org.id}/members/${owner.userId}`)
        .set('Cookie', owner.cookie)
        .send({ role: 'member' })

      expect(response.status).toBe(409)
      expect(response.body.error.message).toMatch(/last owner/i)
    })

    it('cannot be removed', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')

      expect(
        (
          await http()
            .delete(`/orgs/${owner.org.id}/members/${owner.userId}`)
            .set('Cookie', owner.cookie)
        ).status,
      ).toBe(409)
    })

    it('cannot leave', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      await addMember(owner.org, owner.cookie, 'member@onestack.test')

      // Even with other people present, the last *owner* may not walk away.
      expect(
        (
          await http()
            .delete(`/orgs/${owner.org.id}/members/${owner.userId}`)
            .set('Cookie', owner.cookie)
        ).status,
      ).toBe(409)
    })

    it('may step down once somebody else is an owner', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const second = await addMember(owner.org, owner.cookie, 'second@onestack.test')

      await setRole(owner.org.id, second.userId, 'owner')

      const response = await http()
        .patch(`/orgs/${owner.org.id}/members/${owner.userId}`)
        .set('Cookie', owner.cookie)
        .send({ role: 'admin' })

      expect(response.status).toBe(200)
    })
  })
})
