/**
 * Formatting lives at the edge. The API deals in integer micro-dollars and
 * basis points precisely so nothing rounds on the way through; turning those
 * into something readable is the last thing that happens.
 */

const MICRO_USD_PER_USD = 1_000_000

export function formatMoney(microUsd: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(microUsd / MICRO_USD_PER_USD)
}

/** With cents, for figures small enough that whole dollars would read as zero. */
export function formatMoneyPrecise(microUsd: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(microUsd / MICRO_USD_PER_USD)
}

/**
 * Basis points to a percentage. Null has no answer — a margin on no revenue
 * is not zero — so it renders as a dash rather than a number that would be
 * read as a loss.
 */
export function formatMargin(basisPoints: number | null): string {
  if (basisPoints === null) return '—'

  return `${(basisPoints / 100).toFixed(0)}%`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}
