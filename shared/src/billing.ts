import { z } from 'zod'

export const INVOICE_STATUS_VALUES = ['draft', 'open', 'paid', 'void', 'uncollectible'] as const

export const invoiceStatusSchema = z.enum(INVOICE_STATUS_VALUES)

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')

export const invoiceLineInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).max(100_000).default(1),
  unitMicroUsd: z.number().int().min(0).max(1_000_000_000_000),
})

export const createInvoiceRequestSchema = z.object({
  customerId: z.string().uuid(),
  currency: z.string().length(3).default('USD'),
  lines: z.array(invoiceLineInputSchema).min(1).max(100),
  dueInDays: z.number().int().min(0).max(365).default(30),
})

export const recordPaymentRequestSchema = z.object({
  amountMicroUsd: z.number().int().min(0).max(1_000_000_000_000),
  method: z.string().trim().min(1).max(50),
  reference: z.string().trim().max(200).optional(),
  receivedOn: isoDate,
})

export const listInvoicesQuerySchema = z.object({
  status: invoiceStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const invoiceLineSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number().int(),
  unitMicroUsd: z.number().int(),
  amountMicroUsd: z.number().int(),
})

export const paymentSchema = z.object({
  id: z.string().uuid(),
  amountMicroUsd: z.number().int(),
  method: z.string(),
  reference: z.string().nullable(),
  receivedOn: z.string(),
})

export const invoiceSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  customerId: z.string().uuid(),
  subscriptionId: z.string().uuid().nullable(),
  number: z.string().nullable(),
  status: invoiceStatusSchema,
  currency: z.string(),
  subtotalMicroUsd: z.number().int(),
  totalMicroUsd: z.number().int(),
  amountPaidMicroUsd: z.number().int(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  issuedAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
})

export const invoiceDetailSchema = invoiceSchema.extend({
  lines: z.array(invoiceLineSchema),
  payments: z.array(paymentSchema),
})

export const invoicePageSchema = z.object({
  items: z.array(invoiceSchema),
  nextCursor: z.string().uuid().nullable(),
})

export const sweepResultSchema = z.object({
  markedPastDue: z.number().int(),
  restored: z.number().int(),
})

export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>
export type CreateInvoiceRequest = z.infer<typeof createInvoiceRequestSchema>
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequestSchema>
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>
export type Invoice = z.infer<typeof invoiceSchema>
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>
export type InvoicePage = z.infer<typeof invoicePageSchema>
export type SweepResult = z.infer<typeof sweepResultSchema>
