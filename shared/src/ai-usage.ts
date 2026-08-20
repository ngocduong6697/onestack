import { z } from 'zod'
import { aiProviderSchema } from './ai'

export const AI_REQUEST_STATUS_VALUES = ['succeeded', 'failed'] as const

export const aiRequestStatusSchema = z.enum(AI_REQUEST_STATUS_VALUES)

export const usageQuerySchema = z.object({
  /** ISO dates. Absent means all of time, which is the honest default. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export const listAiRequestsQuerySchema = z.object({
  status: aiRequestStatusSchema.optional(),
  model: z.string().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const aiRequestSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  provider: z.string(),
  model: z.string(),
  status: aiRequestStatusSchema,
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  costMicroUsd: z.number().int(),
  durationMs: z.number().int(),
  errorCode: z.string().nullable(),
  stopReason: z.string().nullable(),
  createdAt: z.string(),
})

export const usageLineSchema = z.object({
  provider: aiProviderSchema,
  model: z.string(),
  requests: z.number().int(),
  failed: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costMicroUsd: z.number().int(),
})

export const usageSummarySchema = z.object({
  /** Zeroes rather than an empty body, so a caller need not special-case it. */
  totals: z.object({
    requests: z.number().int(),
    failed: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costMicroUsd: z.number().int(),
    costCents: z.number().int(),
  }),
  byModel: z.array(usageLineSchema),
})

export const aiRequestPageSchema = z.object({
  items: z.array(aiRequestSchema),
  nextCursor: z.string().uuid().nullable(),
})

export type AiRequestStatus = z.infer<typeof aiRequestStatusSchema>
export type UsageQuery = z.infer<typeof usageQuerySchema>
export type ListAiRequestsQuery = z.infer<typeof listAiRequestsQuerySchema>
export type AiRequestDto = z.infer<typeof aiRequestSchema>
export type UsageLine = z.infer<typeof usageLineSchema>
export type UsageSummary = z.infer<typeof usageSummarySchema>
export type AiRequestPage = z.infer<typeof aiRequestPageSchema>
