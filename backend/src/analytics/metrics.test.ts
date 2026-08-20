import { describe, expect, it } from 'vitest'
import { profitOf, toCents, windowDays } from './metrics'

describe('profitOf', () => {
  /** The numbers from the original sketch: $2,100 MRR, $280 AI, $90 infra. */
  it('reproduces the figures on the dashboard sketch', () => {
    const profit = profitOf({
      revenueMicroUsd: 2_100_000_000,
      aiCostMicroUsd: 280_000_000,
      recordedCostMicroUsd: 90_000_000,
    })

    expect(profit.grossProfitMicroUsd).toBe(1_730_000_000)
    // 1730 / 2100 = 82.38%
    expect(profit.marginBasisPoints).toBe(8238)
  })

  it('is all profit when nothing was spent', () => {
    const profit = profitOf({
      revenueMicroUsd: 1_000_000,
      aiCostMicroUsd: 0,
      recordedCostMicroUsd: 0,
    })

    expect(profit.grossProfitMicroUsd).toBe(1_000_000)
    expect(profit.marginBasisPoints).toBe(10_000)
  })

  /**
   * A margin on no revenue has no answer. Reporting 0% would read as "we lost
   * everything", which is a different and wrong statement.
   */
  it('has no margin when there is no revenue', () => {
    const profit = profitOf({
      revenueMicroUsd: 0,
      aiCostMicroUsd: 50_000,
      recordedCostMicroUsd: 0,
    })

    expect(profit.marginBasisPoints).toBeNull()
    expect(profit.grossProfitMicroUsd).toBe(-50_000)
  })

  it('reports a loss as a negative margin', () => {
    const profit = profitOf({
      revenueMicroUsd: 100_000,
      aiCostMicroUsd: 150_000,
      recordedCostMicroUsd: 0,
    })

    expect(profit.grossProfitMicroUsd).toBe(-50_000)
    expect(profit.marginBasisPoints).toBe(-5000)
  })

  it('adds AI and recorded costs together', () => {
    const profit = profitOf({
      revenueMicroUsd: 1_000_000,
      aiCostMicroUsd: 300_000,
      recordedCostMicroUsd: 200_000,
    })

    expect(profit.costMicroUsd).toBe(500_000)
  })

  it('is zero all round for an empty workspace', () => {
    expect(profitOf({ revenueMicroUsd: 0, aiCostMicroUsd: 0, recordedCostMicroUsd: 0 })).toEqual({
      revenueMicroUsd: 0,
      costMicroUsd: 0,
      grossProfitMicroUsd: 0,
      marginBasisPoints: null,
    })
  })

  it('keeps everything an integer', () => {
    const profit = profitOf({
      revenueMicroUsd: 333_333,
      aiCostMicroUsd: 111_111,
      recordedCostMicroUsd: 1,
    })

    expect(Number.isInteger(profit.grossProfitMicroUsd)).toBe(true)
    expect(Number.isInteger(profit.marginBasisPoints)).toBe(true)
  })
})

describe('toCents', () => {
  it.each([
    [1_000_000, 100],
    [17_500, 2],
    [4999, 0],
    [5000, 1],
    [0, 0],
  ])('turns %i micro-dollars into %i cents', (micro, cents) => {
    expect(toCents(micro)).toBe(cents)
  })
})

describe('windowDays', () => {
  it('returns the window oldest first, ending today', () => {
    expect(windowDays(3, new Date('2026-03-10T12:00:00Z'))).toEqual([
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
  })

  it('returns just today for a window of one', () => {
    expect(windowDays(1, new Date('2026-03-10T12:00:00Z'))).toEqual(['2026-03-10'])
  })

  it('crosses a month boundary', () => {
    expect(windowDays(3, new Date('2026-03-02T00:00:00Z'))).toEqual([
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ])
  })

  it('crosses a leap day', () => {
    expect(windowDays(2, new Date('2028-03-01T00:00:00Z'))).toEqual(['2028-02-29', '2028-03-01'])
  })

  it('ignores the time of day', () => {
    expect(windowDays(1, new Date('2026-03-10T23:59:59Z'))).toEqual(['2026-03-10'])
  })
})
