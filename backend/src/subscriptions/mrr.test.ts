import { describe, expect, it } from 'vitest'
import { calculateMrr, monthlyCents } from './mrr'

describe('monthlyCents', () => {
  it('takes a monthly price at face value', () => {
    expect(monthlyCents({ amountCents: 4900, currency: 'USD', interval: 'month' })).toBe(4900)
  })

  it('spreads a yearly price over twelve months', () => {
    expect(monthlyCents({ amountCents: 120_000, currency: 'USD', interval: 'year' })).toBe(10_000)
  })

  it('rounds a yearly price that does not divide cleanly', () => {
    // 49900 / 12 = 4158.33...
    expect(monthlyCents({ amountCents: 49_900, currency: 'USD', interval: 'year' })).toBe(4158)
  })

  /** One-off revenue is revenue, but it is not recurring. */
  it('counts a one-off price as nothing', () => {
    expect(monthlyCents({ amountCents: 500_000, currency: 'USD', interval: 'one_time' })).toBe(0)
  })

  it('handles a free plan', () => {
    expect(monthlyCents({ amountCents: 0, currency: 'USD', interval: 'month' })).toBe(0)
  })
})

describe('calculateMrr', () => {
  it('is empty when there is nothing recurring', () => {
    expect(calculateMrr([])).toEqual([])
    expect(calculateMrr([{ amountCents: 999, currency: 'USD', interval: 'one_time' }])).toEqual([])
  })

  it('adds up one currency', () => {
    const mrr = calculateMrr([
      { amountCents: 4900, currency: 'USD', interval: 'month' },
      { amountCents: 2900, currency: 'USD', interval: 'month' },
      { amountCents: 120_000, currency: 'USD', interval: 'year' },
    ])

    expect(mrr).toEqual([{ currency: 'USD', amountCents: 4900 + 2900 + 10_000 }])
  })

  /** Summing these would produce a confident, meaningless number. */
  it('keeps currencies apart', () => {
    const mrr = calculateMrr([
      { amountCents: 4900, currency: 'USD', interval: 'month' },
      { amountCents: 4500, currency: 'EUR', interval: 'month' },
    ])

    expect(mrr).toEqual([
      { currency: 'EUR', amountCents: 4500 },
      { currency: 'USD', amountCents: 4900 },
    ])
  })

  it('orders currencies stably, so a dashboard does not reshuffle', () => {
    const mrr = calculateMrr([
      { amountCents: 100, currency: 'USD', interval: 'month' },
      { amountCents: 100, currency: 'GBP', interval: 'month' },
      { amountCents: 100, currency: 'EUR', interval: 'month' },
    ])

    expect(mrr.map((entry) => entry.currency)).toEqual(['EUR', 'GBP', 'USD'])
  })

  it('omits a currency whose only lines are one-off', () => {
    const mrr = calculateMrr([
      { amountCents: 4900, currency: 'USD', interval: 'month' },
      { amountCents: 900_000, currency: 'JPY', interval: 'one_time' },
    ])

    expect(mrr).toEqual([{ currency: 'USD', amountCents: 4900 }])
  })
})
