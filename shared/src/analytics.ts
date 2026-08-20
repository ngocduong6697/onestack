import { z } from 'zod'

export const LEDGER_KIND_VALUES = ['cost', 'revenue'] as const
export const SERIES_METRICS = [
  'mrr',
  'customers',
  'activeSubscriptions',
  'aiCost',
  'grossProfit',
] as const

export const ledgerKindSchema = z.enum(LEDGER_KIND_VALUES)
export const seriesMetricSchema = z.enum(SERIES_METRICS)

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')

export const createLedgerEntryRequestSchema = z.object({
  entryDate: isoDate,
  kind: ledgerKindSchema,
  category: z.string().trim().min(1, 'A category is required').max(64),
  /**
   * Positive always. The sign is carried by `kind`, so a negative cost cannot
   * quietly become revenue.
   */
  amountMicroUsd: z.number().int().min(1).max(1_000_000_000_000),
  note: z.string().trim().max(500).optional(),
})

export const listLedgerQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  kind: ledgerKindSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const seriesQuerySchema = z.object({
  metric: seriesMetricSchema,
  days: z.coerce.number().int().min(1).max(365).default(30),
})

export const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  entryDate: z.string(),
  kind: ledgerKindSchema,
  category: z.string(),
  amountMicroUsd: z.number().int(),
  note: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
})

export const ledgerPageSchema = z.object({
  items: z.array(ledgerEntrySchema),
  nextCursor: z.string().uuid().nullable(),
})

export const analyticsSummarySchema = z.object({
  mrrMicroUsd: z.number().int(),
  customers: z.number().int(),
  activeCustomers: z.number().int(),
  activeSubscriptions: z.number().int(),
  aiCostMicroUsd: z.number().int(),
  recordedCostMicroUsd: z.number().int(),
  recordedRevenueMicroUsd: z.number().int(),
  revenueMicroUsd: z.number().int(),
  costMicroUsd: z.number().int(),
  grossProfitMicroUsd: z.number().int(),
  /** Hundredths of a percent. Null when there is no revenue to divide by. */
  marginBasisPoints: z.number().int().nullable(),
})

export const seriesPointSchema = z.object({ date: z.string(), value: z.number().int() })

export const seriesSchema = z.object({
  metric: seriesMetricSchema,
  points: z.array(seriesPointSchema),
})

export type LedgerKind = z.infer<typeof ledgerKindSchema>
export type SeriesMetric = z.infer<typeof seriesMetricSchema>
export type CreateLedgerEntryRequest = z.infer<typeof createLedgerEntryRequestSchema>
export type ListLedgerQuery = z.infer<typeof listLedgerQuerySchema>
export type SeriesQuery = z.infer<typeof seriesQuerySchema>
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>
export type LedgerPage = z.infer<typeof ledgerPageSchema>
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>
export type SeriesPoint = z.infer<typeof seriesPointSchema>
export type Series = z.infer<typeof seriesSchema>
