/**
 * The arithmetic behind the dashboard, as pure functions.
 *
 * These are the figures somebody makes decisions on, and each has an edge case
 * that is easy to get quietly wrong — so they are separated from the queries
 * that feed them and tested directly.
 */

export interface ProfitInputs {
  /** Recurring revenue plus anything recorded as one-off revenue. */
  revenueMicroUsd: number
  aiCostMicroUsd: number
  recordedCostMicroUsd: number
}

export interface Profit {
  revenueMicroUsd: number
  costMicroUsd: number
  grossProfitMicroUsd: number
  /**
   * Basis points — hundredths of a percent — as an integer, so a margin is
   * never a float. 8240 is 82.40%.
   *
   * Null when there is no revenue: a margin on nothing is not zero, it has no
   * answer, and reporting 0% would read as "we lost everything".
   */
  marginBasisPoints: number | null
}

const BASIS_POINTS = 10_000

export function profitOf(inputs: ProfitInputs): Profit {
  const costMicroUsd = inputs.aiCostMicroUsd + inputs.recordedCostMicroUsd
  const grossProfitMicroUsd = inputs.revenueMicroUsd - costMicroUsd

  return {
    revenueMicroUsd: inputs.revenueMicroUsd,
    costMicroUsd,
    grossProfitMicroUsd,
    marginBasisPoints:
      inputs.revenueMicroUsd === 0
        ? null
        : Math.round((grossProfitMicroUsd * BASIS_POINTS) / inputs.revenueMicroUsd),
  }
}

/** Micro-dollars to whole cents, for display only. */
export function toCents(microUsd: number): number {
  return Math.round(microUsd / 10_000)
}

/** The dates a series covers, oldest first, as `YYYY-MM-DD`. */
export function windowDays(days: number, endingOn = new Date()): string[] {
  const dates: string[] = []

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(
      Date.UTC(endingOn.getUTCFullYear(), endingOn.getUTCMonth(), endingOn.getUTCDate()),
    )

    day.setUTCDate(day.getUTCDate() - offset)
    dates.push(day.toISOString().slice(0, 10))
  }

  return dates
}
