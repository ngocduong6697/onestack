import { csvSchema, logLevelSchema, parseEnv, portSchema } from '@onestack/shared'
import { z } from 'zod'

/**
 * An optional secret, where an empty string means absent.
 *
 * `.env` files are written as `KEY=` far more often than the key is left out
 * altogether — this repository's own `.env.example` does exactly that — and
 * treating that as "present but invalid" refuses to boot over a vendor nobody
 * is using.
 */
const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
)

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
  /**
   * AI provider keys. All optional: a provider without a key is simply not
   * available, which is better than refusing to boot because one vendor is
   * unused. Server-side only — these are never sent anywhere near a client.
   */
  ANTHROPIC_API_KEY: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  GOOGLE_API_KEY: optionalSecret,
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parseEnv(envSchema, source)
}
