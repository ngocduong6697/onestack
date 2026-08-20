import { z } from 'zod'

export const AI_PROVIDER_VALUES = ['anthropic', 'openai', 'google'] as const

export const aiProviderSchema = z.enum(AI_PROVIDER_VALUES)

export const aiMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(100_000),
})

export const completionRequestSchema = z.object({
  model: z.string().min(1).max(100),
  messages: z.array(aiMessageSchema).min(1).max(100),
  system: z.string().max(50_000).optional(),
  /** Capped again per model by the registry; this is only the outer bound. */
  maxTokens: z.number().int().min(1).max(128_000).default(4096),
})

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int().optional(),
  cacheWriteTokens: z.number().int().optional(),
})

export const completionResponseSchema = z.object({
  model: z.string(),
  provider: aiProviderSchema,
  text: z.string(),
  usage: tokenUsageSchema,
  /** Exact integer micro-dollars, plus the rounded cents for display. */
  costMicroUsd: z.number().int(),
  costCents: z.number().int(),
  stopReason: z.enum(['end_turn', 'max_tokens', 'refusal', 'other']),
})

export const aiModelSchema = z.object({
  id: z.string(),
  provider: aiProviderSchema,
  label: z.string(),
  contextWindow: z.number().int(),
  maxOutputTokens: z.number().int(),
  inputMicroUsdPerMTok: z.number().int(),
  outputMicroUsdPerMTok: z.number().int(),
  pricing: z.object({ source: z.string(), checkedOn: z.string() }),
})

export type AiProviderName = z.infer<typeof aiProviderSchema>
export type AiMessage = z.infer<typeof aiMessageSchema>
export type CompletionRequestBody = z.infer<typeof completionRequestSchema>
export type TokenUsageDto = z.infer<typeof tokenUsageSchema>
export type CompletionResponse = z.infer<typeof completionResponseSchema>
export type AiModelDto = z.infer<typeof aiModelSchema>
