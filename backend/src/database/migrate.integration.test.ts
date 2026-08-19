import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { down, status, up } from './migrate'

const url = process.env.TEST_DATABASE_URL

/**
 * Exercises the real thing against a real Postgres. Skipped — loudly, by
 * name — when TEST_DATABASE_URL is unset, so a run without a database reads
 * as "not verified" instead of green.
 */
describe.skipIf(!url)('migrations against a real database', () => {
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined })

  const extensionExists = async (name: string): Promise<boolean> => {
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from pg_extension where extname = ${name}
    `
    return (rows[0]?.count ?? 0) > 0
  }

  beforeAll(async () => {
    await sql.unsafe('drop schema public cascade; create schema public;')
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('applies pending migrations', async () => {
    const ran = await up(sql)

    expect(ran).toContain('0000_extensions')
    expect(await extensionExists('pgcrypto')).toBe(true)
    expect(await extensionExists('citext')).toBe(true)
  })

  it('is idempotent on a second run', async () => {
    expect(await up(sql)).toEqual([])
  })

  it('reports what has been applied', async () => {
    const entries = await status(sql)

    expect(entries.every((entry) => entry.appliedAt !== null)).toBe(true)
  })

  it('rolls the last migration back', async () => {
    expect(await down(sql)).toBe('0000_extensions')
    expect(await extensionExists('citext')).toBe(false)
    expect(await status(sql)).toEqual([{ id: '0000_extensions', appliedAt: null }])
  })

  it('reports nothing to revert once the history is empty', async () => {
    expect(await down(sql)).toBeNull()
  })

  it('re-applies after a rollback, so the cycle is repeatable', async () => {
    expect(await up(sql)).toEqual(['0000_extensions'])
    expect(await extensionExists('citext')).toBe(true)
  })
})
