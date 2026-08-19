import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { discover, down, status, up } from './migrate'

const url = process.env.TEST_DATABASE_URL

/**
 * Exercises the real thing against a real Postgres. Skipped — loudly, by
 * name — when TEST_DATABASE_URL is unset, so a run without a database reads
 * as "not verified" instead of green.
 *
 * Assertions are written against whatever migrations exist rather than against
 * a fixed list, so adding one does not break this file.
 */
describe.skipIf(!url)('migrations against a real database', () => {
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined })

  const extensionExists = async (name: string): Promise<boolean> => {
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from pg_extension where extname = ${name}
    `
    return (rows[0]?.count ?? 0) > 0
  }

  const tableExists = async (name: string): Promise<boolean> => {
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from information_schema.tables
      where table_schema = 'public' and table_name = ${name}
    `
    return (rows[0]?.count ?? 0) > 0
  }

  beforeAll(async () => {
    await sql.unsafe('drop schema public cascade; create schema public;')
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('applies every pending migration in order', async () => {
    const expected = (await discover()).map((migration) => migration.id)

    expect(await up(sql)).toEqual(expected)
    expect(await extensionExists('pgcrypto')).toBe(true)
    expect(await extensionExists('citext')).toBe(true)
    expect(await tableExists('users')).toBe(true)
    expect(await tableExists('sessions')).toBe(true)
  })

  it('is idempotent on a second run', async () => {
    expect(await up(sql)).toEqual([])
  })

  it('reports every migration as applied', async () => {
    const entries = await status(sql)

    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((entry) => entry.appliedAt !== null)).toBe(true)
  })

  it('rolls back one migration at a time, most recent first', async () => {
    const ids = (await discover()).map((migration) => migration.id)
    const last = ids.at(-1)!

    expect(await down(sql)).toBe(last)
    // Only the last one went; everything before it is still applied.
    expect(await tableExists('users')).toBe(false)
    expect(await extensionExists('citext')).toBe(true)
  })

  it('unwinds the whole history and then reports nothing to revert', async () => {
    const remaining = (await status(sql)).filter((entry) => entry.appliedAt !== null).length

    for (let i = 0; i < remaining; i += 1) {
      expect(await down(sql)).not.toBeNull()
    }

    expect(await down(sql)).toBeNull()
    expect(await extensionExists('citext')).toBe(false)
    expect(await extensionExists('pgcrypto')).toBe(false)
  })

  it('re-applies the full history, so the cycle is repeatable', async () => {
    const expected = (await discover()).map((migration) => migration.id)

    expect(await up(sql)).toEqual(expected)
    expect(await tableExists('users')).toBe(true)
  })
})
