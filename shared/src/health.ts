import { z } from 'zod'

/**
 * The API's liveness contract. It lives in shared so the container
 * healthcheck, the API and any future consumer read the same shape —
 * CLAUDE.md rule 3, one definition of the truth.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  /** Seconds since the process started, rounded. */
  uptime: z.number().nonnegative(),
  version: z.string().min(1),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
