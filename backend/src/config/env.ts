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
  LOG_LEVEL: logLevelSchema.default('info'),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parseEnv(envSchema, source)
}
