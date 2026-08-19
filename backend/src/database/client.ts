import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Env } from '../config/env'
import * as schema from './schema'

export type Database = PostgresJsDatabase<typeof schema>

export interface DatabaseHandle {
  db: Database
  /** Closes the pool. Called from the module's shutdown hook. */
  close: () => Promise<void>
}

/**
 * postgres.js connects lazily, which is deliberate here: the API must still
 * boot with Postgres down so frontend work is not blocked by it. /ready is
 * what reports the problem, not the process exiting.
 */
export function createDatabase(env: Env): DatabaseHandle {
  const sql = postgres(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    idle_timeout: env.DATABASE_IDLE_TIMEOUT,
    connect_timeout: env.DATABASE_CONNECT_TIMEOUT,
    // Errors carry the failing statement; keep it out of shipped logs.
    onnotice: () => undefined,
  })

  return {
    db: drizzle(sql, { schema }),
    close: async () => {
      // Give in-flight queries a moment rather than severing them.
      await sql.end({ timeout: 5 })
    },
  }
}
