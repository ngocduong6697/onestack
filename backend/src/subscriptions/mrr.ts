import type { MrrByCurrency } from '@onestack/shared'
import type { PriceInterval } from '../database/schema'

export interface RecurringLine {
  amountCents: number
  currency: string
  interval: PriceInterval
}

/**
 * Monthly recurring revenue, in minor units.
 *
 * Two decisions worth stating. A yearly price contributes a twelfth of itself,
 * rounded — 49900 a year is 4158 a month, not 4158.33, because MRR is money
 * and money here is an integer. And currencies are reported separately rather
 * than summed: adding USD to EUR produces a number that looks authoritative
 * and is meaningless.
 *
 * One-off prices contribute nothing. They are revenue, but they are not
 * recurring, and folding them in makes MRR a different metric that happens to
 * share the name.
 */
export function monthlyCents(line: RecurringLine): number {
  switch (line.interval) {
    case 'month':
      return line.amountCents
    case 'year':
      return Math.round(line.amountCents / 12)
    case 'one_time':
      return 0
  }
}

export function calculateMrr(lines: readonly RecurringLine[]): MrrByCurrency[] {
  const totals = new Map<string, number>()

  for (const line of lines) {
    const monthly = monthlyCents(line)

    if (monthly === 0) continue

    totals.set(line.currency, (totals.get(line.currency) ?? 0) + monthly)
  }

  return (
    [...totals.entries()]
      .map(([currency, amountCents]) => ({ currency, amountCents }))
      // Stable order, so a dashboard does not reshuffle between reads.
      .sort((a, b) => a.currency.localeCompare(b.currency))
  )
}
