import { describe, expect, it } from 'vitest'
import { formatCount, formatMargin, formatMoney, formatMoneyPrecise } from './format'

describe('formatMoney', () => {
  it('turns micro-dollars into whole dollars', () => {
    expect(formatMoney(2_100_000_000)).toBe('$2,100')
  })

  it('renders zero', () => {
    expect(formatMoney(0)).toBe('$0')
  })

  it('renders a negative amount', () => {
    expect(formatMoney(-50_000_000)).toBe('-$50')
  })

  it('rounds sub-dollar amounts to whole dollars', () => {
    expect(formatMoney(499_999)).toBe('$0')
  })

  it('honours another currency', () => {
    expect(formatMoney(1_000_000, 'EUR')).toBe('€1')
  })
})

describe('formatMoneyPrecise', () => {
  it('keeps cents for small figures', () => {
    expect(formatMoneyPrecise(17_500)).toBe('$0.02')
    expect(formatMoneyPrecise(280_000_000)).toBe('$280.00')
  })
})

describe('formatMargin', () => {
  it('turns basis points into a percentage', () => {
    expect(formatMargin(8238)).toBe('82%')
    expect(formatMargin(10_000)).toBe('100%')
  })

  /** A margin on no revenue has no answer; zero would read as a total loss. */
  it('renders a dash when there is no margin', () => {
    expect(formatMargin(null)).toBe('—')
  })

  it('renders a negative margin', () => {
    expect(formatMargin(-5000)).toBe('-50%')
  })

  it('renders an exactly zero margin as zero, not a dash', () => {
    expect(formatMargin(0)).toBe('0%')
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(18)).toBe('18')
    expect(formatCount(12_345)).toBe('12,345')
  })
})
