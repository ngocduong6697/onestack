import { csvSchema, logLevelSchema, parseEnv, portSchema } from '@onestack/shared'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: portSchema.default(4000),
  /**
   * Required even though nothing connects yet (TASK-002 does). A deploy that
   * forgets it should fail on the first second, not the first query.
   */
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: csvSchema.default('http://localhost:3000'),
  /** Pool ceiling. One person's traffic does not need more than this. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Seconds an idle connection is kept before being returned to the system. */
  DATABASE_IDLE_TIMEOUT: z.coerce.number().int().min(1).default(30),
  /** Seconds to wait for a connection before failing, so a dead database
   * fails fast instead of hanging a request. */
  DATABASE_CONNECT_TIMEOUT: z.coerce.number().int().min(1).default(10),
  LOG_LEVEL: logLevelSchema.default('info'),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parseEnv(envSchema, source)
}
