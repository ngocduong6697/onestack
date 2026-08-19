import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { discover, migrationsDir } from './migrate'

describe('migration files', () => {
  it('finds the migrations directory from the backend workspace', () => {
    expect(existsSync(migrationsDir())).toBe(true)
  })

  /**
   * CLAUDE.md rule 9 as a test rather than a habit: a migration that ships
   * without a way back fails CI, not a code review someone was busy for.
   */
  it('every migration has a paired down migration', async () => {
    const missing = (await discover())
      .filter((migration) => !existsSync(migration.downPath))
      .map((migration) => migration.id)

    expect(missing).toEqual([])
  })

  it('orders migrations by id so they apply in the order they were written', async () => {
    const ids = (await discover()).map((migration) => migration.id)

    expect(ids).toEqual([...ids].sort())
  })
})
