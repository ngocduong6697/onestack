import type { PriceInterval } from '../database/schema'

/**
 * Advances a period by exactly one interval from where the last one ended,
 * not from now. A renewal that runs late must not silently shorten the next
 * period — the customer paid for a month, not for a month minus the delay.
 */
export function nextPeriodEnd(from: Date, interval: PriceInterval): Date | null {
  if (interval === 'one_time') return null

  const next = new Date(from.getTime())

  if (interval === 'month') {
    const day = next.getUTCDate()

    next.setUTCMonth(next.getUTCMonth() + 1)

    // 31 January plus a month is 28 or 29 February, not 3 March. Date rolls
    // over silently, so the overflow has to be pulled back deliberately.
    if (next.getUTCDate() < day) next.setUTCDate(0)
  } else {
    const isLeapDay = next.getUTCMonth() === 1 && next.getUTCDate() === 29

    next.setUTCFullYear(next.getUTCFullYear() + 1)

    // 29 February plus a year is 28 February in a common year.
    if (isLeapDay && next.getUTCDate() !== 29) next.setUTCDate(0)
  }

  return next
}

/** The period a subscription starts in. One-off prices have none. */
export function initialPeriod(
  start: Date,
  interval: PriceInterval,
): { start: Date | null; end: Date | null } {
  if (interval === 'one_time') return { start: null, end: null }

  return { start, end: nextPeriodEnd(start, interval) }
}
