import { z } from 'zod'

/**
 * A TCP port arriving as a string, because that is all an environment holds.
 * Coerced once here so no caller has to remember to parseInt.
 */
export const portSchema = z.coerce.number().int().min(1).max(65535)

/**
 * Comma-separated list, tolerant of the spacing people actually type.
 */
export const csvSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1)))

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])

export type LogLevel = z.infer<typeof logLevelSchema>

/**
 * Validate a process environment against a schema, failing at boot rather than
 * at first use. The thrown message names every offending variable, which is
 * the whole point: a missing DATABASE_URL should not surface as a connection
 * error twenty minutes into a deploy.
 */
export function parseEnv<T extends z.ZodTypeAny>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(source)

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new Error(`Invalid environment:\n${problems}`)
  }

  return result.data
}
