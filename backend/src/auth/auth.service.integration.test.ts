import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, UnauthorizedError } from '../common/errors'
import * as schema from '../database/schema'
import { sessions, users } from '../database/schema'
import { up } from '../database/migrate'
import { AuthService } from './auth.service'
import { hashSessionToken } from './tokens'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('AuthService against a real database', () => {
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  const auth = new AuthService(db)

  const credentials = {
    email: 'founder@onestack.test',
    password: 'a sufficiently long password',
    name: 'Founder',
  }

  beforeAll(async () => {
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await sql.unsafe('truncate table sessions, users cascade')
  })

  describe('register', () => {
    it('creates a user and an immediately usable session', async () => {
      const result = await auth.register(credentials)

      expect(result.user.email).toBe(credentials.email)
      expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(await auth.authenticate(result.token)).toMatchObject({ id: result.user.id })
    })

    it('stores the digest of the token, never the token', async () => {
      const result = await auth.register(credentials)
      const rows = await db.select().from(sessions)

      expect(rows[0]?.tokenHash).toBe(hashSessionToken(result.token))
      expect(rows.map((row) => row.tokenHash)).not.toContain(result.token)
    })

    it('stores an argon2id hash, never the password', async () => {
      await auth.register(credentials)
      const rows = await db.select().from(users)

      expect(rows[0]?.passwordHash).toMatch(/^\$argon2id\$/)
      expect(rows[0]?.passwordHash).not.toContain(credentials.password)
    })

    it('rejects a duplicate email with a conflict, not a 500', async () => {
      await auth.register(credentials)

      await expect(auth.register(credentials)).rejects.toThrow(ConflictError)
    })

    /** citext is why this passes without any lower() in the query. */
    it('treats email as case-insensitive', async () => {
      await auth.register(credentials)

      await expect(
        auth.register({ ...credentials, email: 'Founder@OneStack.test' }),
      ).rejects.toThrow(ConflictError)
    })
  })

  describe('login', () => {
    beforeEach(async () => {
      await auth.register(credentials)
    })

    it('issues a new session for the right password', async () => {
      const result = await auth.login({
        email: credentials.email,
        password: credentials.password,
      })

      expect(await auth.authenticate(result.token)).toMatchObject({ email: credentials.email })
    })

    it('records last_login_at', async () => {
      await auth.login({ email: credentials.email, password: credentials.password })
      const rows = await db.select().from(users)

      expect(rows[0]?.lastLoginAt).toBeInstanceOf(Date)
    })

    it('rejects the wrong password and an unknown email identically', async () => {
      const wrongPassword = auth.login({ email: credentials.email, password: 'wrong password xx' })
      const unknownEmail = auth.login({ email: 'nobody@onestack.test', password: 'whatever it is' })

      await expect(wrongPassword).rejects.toThrow('Invalid email or password')
      await expect(unknownEmail).rejects.toThrow('Invalid email or password')
    })

    it('refuses a disabled account without saying so', async () => {
      await db.update(users).set({ status: 'disabled' }).where(eq(users.email, credentials.email))

      await expect(
        auth.login({ email: credentials.email, password: credentials.password }),
      ).rejects.toThrow(UnauthorizedError)
    })
  })

  describe('authenticate', () => {
    it('rejects a token nobody issued', async () => {
      expect(await auth.authenticate('not-a-real-token')).toBeNull()
    })

    it('rejects an expired session', async () => {
      const { token } = await auth.register(credentials)

      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.tokenHash, hashSessionToken(token)))

      expect(await auth.authenticate(token)).toBeNull()
    })

    it('stops accepting a session once its user is disabled', async () => {
      const { token, user } = await auth.register(credentials)

      await db.update(users).set({ status: 'disabled' }).where(eq(users.id, user.id))

      expect(await auth.authenticate(token)).toBeNull()
    })
  })

  describe('logout', () => {
    it('deletes the row, so a captured cookie is worthless', async () => {
      const { token } = await auth.register(credentials)

      await auth.logout(token)

      expect(await auth.authenticate(token)).toBeNull()
      expect(await db.select().from(sessions)).toEqual([])
    })

    it('is silent about a token that was never valid', async () => {
      await expect(auth.logout('never-existed')).resolves.toBeUndefined()
    })
  })

  describe('purgeExpiredSessions', () => {
    it('removes expired rows and leaves live ones', async () => {
      const live = await auth.register(credentials)
      const stale = await auth.login({ email: credentials.email, password: credentials.password })

      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.tokenHash, hashSessionToken(stale.token)))

      expect(await auth.purgeExpiredSessions()).toBe(1)
      expect(await auth.authenticate(live.token)).not.toBeNull()
    })
  })

  describe('cascade', () => {
    it('deleting a user deletes their sessions', async () => {
      const { user } = await auth.register(credentials)

      await db.delete(users).where(eq(users.id, user.id))

      expect(await db.select().from(sessions)).toEqual([])
    })
  })
})
