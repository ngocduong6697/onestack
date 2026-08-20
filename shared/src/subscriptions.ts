import { z } from 'zod'

export const SUBSCRIPTION_STATUS_VALUES = ['trialing', 'active', 'past_due', 'canceled'] as const

export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUS_VALUES)

export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>

export const createSubscriptionRequestSchema = z.object({
  customerId: z.string().uuid(),
  priceId: z.string().uuid(),
  /** A trial delays nothing about the period; it only marks the status. */
  trialDays: z.number().int().min(1).max(365).optional(),
})

export const changePriceRequestSchema = z.object({ priceId: z.string().uuid() })

export const cancelSubscriptionRequestSchema = z.object({
  /** Default is at period end: cancelling should not take away paid time. */
  immediately: z.boolean().default(false),
})

export const listSubscriptionsQuerySchema = z.object({
  status: subscriptionStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const subscriptionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  customerId: z.string().uuid(),
  priceId: z.string().uuid(),
  status: subscriptionStatusSchema,
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodStart: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const subscriptionPageSchema = z.object({
  items: z.array(subscriptionSchema),
  nextCursor: z.string().uuid().nullable(),
})

/**
 * Reported per currency rather than summed. Adding USD to EUR would produce a
 * number that looks right and is not.
 */
export const mrrByCurrencySchema = z.object({
  currency: z.string(),
  amountCents: z.number().int(),
})

export const subscriptionSummarySchema = z.object({
  mrr: z.array(mrrByCurrencySchema),
  countsByStatus: z.record(subscriptionStatusSchema, z.number().int()),
  activeCount: z.number().int(),
})

export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>
export type ChangePriceRequest = z.infer<typeof changePriceRequestSchema>
export type CancelSubscriptionRequest = z.infer<typeof cancelSubscriptionRequestSchema>
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuerySchema>
export type Subscription = z.infer<typeof subscriptionSchema>
export type SubscriptionPage = z.infer<typeof subscriptionPageSchema>
export type MrrByCurrency = z.infer<typeof mrrByCurrencySchema>
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>
