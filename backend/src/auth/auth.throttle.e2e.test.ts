import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import postgres from 'postgres'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { up } from '../database/migrate'

const url = process.env.TEST_DATABASE_URL

/** The throttler with its real guard in place — unlimited login attempts is
 *  the cheapest attack there is, so the limit is worth a test of its own. */
describe.skipIf(!url)('auth throttling', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined })

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    // Explicit, because another test file in this worker may have set it.
    process.env.THROTTLE_DISABLED = 'false'
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

  it('returns 429 once the login limit is exceeded', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@onestack.test', password: 'wrong password here' })

    const statuses: number[] = []

    for (let i = 0; i < 7; i += 1) {
      statuses.push((await attempt()).status)
    }

    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true)
    expect(statuses).toContain(429)
  })
})
