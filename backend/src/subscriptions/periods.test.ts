import { describe, expect, it } from 'vitest'
import { initialPeriod, nextPeriodEnd } from './periods'

const utc = (iso: string) => new Date(iso)

describe('nextPeriodEnd', () => {
  it('advances a month', () => {
    expect(nextPeriodEnd(utc('2026-03-15T00:00:00Z'), 'month')?.toISOString()).toBe(
      '2026-04-15T00:00:00.000Z',
    )
  })

  it('advances a year', () => {
    expect(nextPeriodEnd(utc('2026-03-15T00:00:00Z'), 'year')?.toISOString()).toBe(
      '2027-03-15T00:00:00.000Z',
    )
  })

  /** Date rolls over silently; 31 January must not become 3 March. */
  it.each([
    ['2026-01-31T00:00:00Z', '2026-02-28T00:00:00.000Z'],
    ['2026-03-31T00:00:00Z', '2026-04-30T00:00:00.000Z'],
    ['2026-05-31T00:00:00Z', '2026-06-30T00:00:00.000Z'],
  ])('clamps %s to the end of the shorter month', (from, expected) => {
    expect(nextPeriodEnd(utc(from), 'month')?.toISOString()).toBe(expected)
  })

  it('handles a leap February', () => {
    // 2028 is a leap year, so 31 January lands on the 29th.
    expect(nextPeriodEnd(utc('2028-01-31T00:00:00Z'), 'month')?.toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    )
  })

  it('pulls 29 February back to the 28th a common year later', () => {
    expect(nextPeriodEnd(utc('2028-02-29T00:00:00Z'), 'year')?.toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    )
  })

  it('keeps the time of day', () => {
    expect(nextPeriodEnd(utc('2026-03-15T13:45:30Z'), 'month')?.toISOString()).toBe(
      '2026-04-15T13:45:30.000Z',
    )
  })

  it('has no period for a one-off price', () => {
    expect(nextPeriodEnd(utc('2026-03-15T00:00:00Z'), 'one_time')).toBeNull()
  })
})

describe('initialPeriod', () => {
  it('runs from the start date to one interval later', () => {
    const period = initialPeriod(utc('2026-03-15T00:00:00Z'), 'month')

    expect(period.start?.toISOString()).toBe('2026-03-15T00:00:00.000Z')
    expect(period.end?.toISOString()).toBe('2026-04-15T00:00:00.000Z')
  })

  it('is absent for a one-off price', () => {
    expect(initialPeriod(utc('2026-03-15T00:00:00Z'), 'one_time')).toEqual({
      start: null,
      end: null,
    })
  })
})
