import type { InvoiceStatus } from '../database/schema'
import { ConflictError } from '../common/errors'

/**
 * What may follow what.
 *
 * Written as data rather than as a chain of ifs because the interesting cases
 * are the ones that must *not* happen — voiding something already paid, paying
 * a draft, issuing twice — and a table makes each of those a missing entry
 * rather than a missing branch somebody forgot.
 */
const ALLOWED: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['open', 'void'],
  open: ['paid', 'void', 'uncollectible'],
  // Terminal. A paid invoice is a record of money received; unpicking it is a
  // credit note, which is a different document.
  paid: [],
  void: [],
  uncollectible: ['paid'],
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED[from].includes(to)
}

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(`An invoice cannot go from ${from} to ${to}`)
  }
}

export interface PaymentCheck {
  totalMicroUsd: number
  alreadyPaidMicroUsd: number
  amountMicroUsd: number
}

export interface PaymentResult {
  amountPaidMicroUsd: number
  settled: boolean
}

/**
 * Applies a payment, refusing more than is outstanding.
 *
 * Overpayment is refused rather than accepted and ignored: a record claiming
 * more was paid than was owed is worse than a rejected entry, because it looks
 * like reconciled money.
 */
export function applyPayment(check: PaymentCheck): PaymentResult {
  const outstanding = check.totalMicroUsd - check.alreadyPaidMicroUsd

  if (check.amountMicroUsd > outstanding) {
    throw new ConflictError(
      `That payment is more than the ${outstanding} micro-dollars outstanding`,
    )
  }

  const amountPaidMicroUsd = check.alreadyPaidMicroUsd + check.amountMicroUsd

  return { amountPaidMicroUsd, settled: amountPaidMicroUsd >= check.totalMicroUsd }
}

/** `INV-2026-0001`. Sequential within a workspace and a year. */
export function invoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(4, '0')}`
}

/** The sequence in an existing number, or 0 if it is not one of ours. */
export function sequenceOf(number: string | null, year: number): number {
  const match = number?.match(new RegExp(`^INV-${year}-(\\d{4,})$`))

  return match?.[1] ? Number(match[1]) : 0
}
