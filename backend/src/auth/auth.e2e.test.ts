import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import postgres from 'postgres'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { up } from '../database/migrate'
import { SESSION_COOKIE } from './session-cookie'

const url = process.env.TEST_DATABASE_URL

/** Over HTTP, because cookie flags and status codes only exist at this level. */
describe.skipIf(!url)('auth over HTTP', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined })

  const body = {
    email: 'founder@onestack.test',
    password: 'a sufficiently long password',
    name: 'Founder',
  }

  const cookieFrom = (response: request.Response): string => {
    const header = response.headers['set-cookie'] as unknown as string[]
    return header.find((entry) => entry.startsWith(SESSION_COOKIE)) ?? ''
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)

    // The throttler has its own test file; here it would only make the suite
    // fail as the request count grows. APP_GUARD cannot be overridden through
    // the testing module, so the module's own skip flag is the way out.
    process.env.THROTTLE_DISABLED = 'true'

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
    await sql.unsafe('truncate table sessions, users cascade')
  })

  describe('POST /auth/register', () => {
    it('creates the account and sets a hardened cookie', async () => {
      const response = await request(app.getHttpServer()).post('/auth/register').send(body)

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ email: body.email, name: body.name })

      const cookie = cookieFrom(response)
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Path=/')
    })

    it('never returns the password hash', async () => {
      const response = await request(app.getHttpServer()).post('/auth/register').send(body)

      expect(JSON.stringify(response.body)).not.toContain('argon2')
      expect(response.body).not.toHaveProperty('passwordHash')
      expect(response.body).not.toHaveProperty('password_hash')
    })

    it('never puts the session token in the body', async () => {
      const response = await request(app.getHttpServer()).post('/auth/register').send(body)
      const token = cookieFrom(response).split('=')[1]?.split(';')[0] ?? ''

      expect(token.length).toBeGreaterThan(0)
      expect(JSON.stringify(response.body)).not.toContain(token)
    })

    it('rejects a duplicate with 409', async () => {
      await request(app.getHttpServer()).post('/auth/register').send(body)
      const response = await request(app.getHttpServer()).post('/auth/register').send(body)

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('conflict')
    })

    it.each([
      ['a short password', { ...body, password: 'short' }],
      ['a malformed email', { ...body, email: 'not-an-email' }],
      ['a blank name', { ...body, name: '   ' }],
      ['a missing field', { email: body.email }],
    ])('rejects %s with 422', async (_label, payload) => {
      const response = await request(app.getHttpServer()).post('/auth/register').send(payload)

      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe('validation_failed')
    })
  })

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer()).post('/auth/register').send(body)
    })

    it('returns 200 and a fresh cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: body.email, password: body.password })

      expect(response.status).toBe(200)
      expect(cookieFrom(response)).toContain('HttpOnly')
    })

    it('answers a wrong password and an unknown email identically', async () => {
      const wrong = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: body.email, password: 'not the password' })
      const unknown = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@onestack.test', password: 'not the password' })

      expect(wrong.status).toBe(401)
      expect(unknown.status).toBe(401)
      expect(wrong.body).toEqual(unknown.body)
    })
  })

  describe('GET /auth/me', () => {
    it('returns the user with a valid session', async () => {
      const registered = await request(app.getHttpServer()).post('/auth/register').send(body)

      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookieFrom(registered))

      expect(response.status).toBe(200)
      expect(response.body.email).toBe(body.email)
    })

    it.each([
      ['no cookie', undefined],
      ['a forged cookie', `${SESSION_COOKIE}=forged-value`],
      ['an empty cookie', `${SESSION_COOKIE}=`],
    ])('returns 401 for %s', async (_label, cookie) => {
      const call = request(app.getHttpServer()).get('/auth/me')
      const response = await (cookie ? call.set('Cookie', cookie) : call)

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('unauthorized')
    })
  })

  describe('POST /auth/logout', () => {
    it('invalidates the session it was given', async () => {
      const registered = await request(app.getHttpServer()).post('/auth/register').send(body)
      const cookie = cookieFrom(registered)

      const loggedOut = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', cookie)
      expect(loggedOut.status).toBe(204)

      const after = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie)
      expect(after.status).toBe(401)
    })

    it('succeeds without a session, so a stale client still ends up clean', async () => {
      const response = await request(app.getHttpServer()).post('/auth/logout')

      expect(response.status).toBe(204)
    })
  })

  describe('probes stay open', () => {
    it.each(['/health', '/ready'])('%s answers without a session', async (path) => {
      const response = await request(app.getHttpServer()).get(path)

      expect(response.status).toBe(200)
    })
  })
})
