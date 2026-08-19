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
import { sessions, users } from '../database/schema'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('profile and password over HTTP', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  const http = () => request(app.getHttpServer())

  const password = 'a sufficiently long password'
  const email = 'founder@onestack.test'

  const cookieOf = (response: request.Response) => {
    const header = response.headers['set-cookie'] as unknown as string[]
    return header.find((entry) => entry.startsWith(SESSION_COOKIE))!
  }

  const signUp = async () => {
    const response = await http().post('/auth/register').send({ email, password, name: 'Founder' })
    expect(response.status).toBe(201)
    return { cookie: cookieOf(response), userId: response.body.id as string }
  }

  /** A second, independent session for the same person. */
  const secondSession = async () => {
    const response = await http().post('/auth/login').send({ email, password })
    expect(response.status).toBe(200)
    return cookieOf(response)
  }

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
      'truncate table sessions, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('GET /users/me', () => {
    it('returns the caller and never their hash', async () => {
      const { cookie } = await signUp()

      const response = await http().get('/users/me').set('Cookie', cookie)

      expect(response.status).toBe(200)
      expect(response.body.email).toBe(email)
      expect(JSON.stringify(response.body)).not.toContain('argon2')
    })

    it('requires a session', async () => {
      expect((await http().get('/users/me')).status).toBe(401)
    })
  })

  describe('PATCH /users/me', () => {
    it('renames the caller', async () => {
      const { cookie } = await signUp()

      const response = await http()
        .patch('/users/me')
        .set('Cookie', cookie)
        .send({ name: 'Renamed' })

      expect(response.status).toBe(200)
      expect(response.body.name).toBe('Renamed')
      expect((await http().get('/users/me').set('Cookie', cookie)).body.name).toBe('Renamed')
    })

    it('rejects a blank name and an empty patch', async () => {
      const { cookie } = await signUp()

      expect(
        (await http().patch('/users/me').set('Cookie', cookie).send({ name: '  ' })).status,
      ).toBe(422)
      expect((await http().patch('/users/me').set('Cookie', cookie).send({})).status).toBe(422)
    })

    it('cannot change anything but the name', async () => {
      const { cookie } = await signUp()

      await http()
        .patch('/users/me')
        .set('Cookie', cookie)
        .send({ name: 'Renamed', email: 'attacker@onestack.test', status: 'disabled' })

      const rows = await db.select().from(users).where(eq(users.email, email))
      expect(rows[0]?.email).toBe(email)
      expect(rows[0]?.status).toBe('active')
    })
  })

  describe('POST /users/me/password', () => {
    const change = (cookie: string, body: Record<string, string>) =>
      http().post('/users/me/password').set('Cookie', cookie).send(body)

    it('changes the password and lets the new one log in', async () => {
      const { cookie } = await signUp()

      const response = await change(cookie, {
        currentPassword: password,
        newPassword: 'an even longer new password',
      })
      expect(response.status).toBe(204)

      expect((await http().post('/auth/login').send({ email, password })).status).toBe(401)
      expect(
        (await http().post('/auth/login').send({ email, password: 'an even longer new password' }))
          .status,
      ).toBe(200)
    })

    it('refuses without the current password', async () => {
      const { cookie } = await signUp()

      const response = await change(cookie, {
        currentPassword: 'not the current one',
        newPassword: 'an even longer new password',
      })

      expect(response.status).toBe(401)
      // And the old password still works.
      expect((await http().post('/auth/login').send({ email, password })).status).toBe(200)
    })

    it('enforces the password policy on the new one', async () => {
      const { cookie } = await signUp()

      expect(
        (await change(cookie, { currentPassword: password, newPassword: 'short' })).status,
      ).toBe(422)
    })

    /** The actual remedy after a session is stolen. */
    it('revokes every other session but keeps the caller signed in', async () => {
      const { cookie } = await signUp()
      const other = await secondSession()

      expect((await http().get('/users/me').set('Cookie', other)).status).toBe(200)

      await change(cookie, {
        currentPassword: password,
        newPassword: 'an even longer new password',
      })

      expect((await http().get('/users/me').set('Cookie', other)).status).toBe(401)
      expect((await http().get('/users/me').set('Cookie', cookie)).status).toBe(200)

      const remaining = await db.select().from(sessions)
      expect(remaining).toHaveLength(1)
    })

    it('requires a session', async () => {
      expect(
        (
          await http()
            .post('/users/me/password')
            .send({ currentPassword: password, newPassword: 'an even longer new password' })
        ).status,
      ).toBe(401)
    })
  })
})
