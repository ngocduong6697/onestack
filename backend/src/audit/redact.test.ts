import { describe, expect, it } from 'vitest'
import { redact } from './redact'

describe('redact', () => {
  it('keeps ordinary fields', () => {
    expect(redact({ name: 'Acme', stage: 'active', count: 3, enabled: true })).toEqual({
      name: 'Acme',
      stage: 'active',
      count: 3,
      enabled: true,
    })
  })

  it.each([
    ['password'],
    ['passwordHash'],
    ['password_hash'],
    ['tokenHash'],
    ['token'],
    ['apiKey'],
    ['ANTHROPIC_API_KEY'],
    ['clientSecret'],
    ['credentials'],
    ['prompt'],
    ['completion'],
  ])('redacts %s', (key) => {
    expect(redact({ [key]: 'sensitive-value' })[key]).toBe('[redacted]')
  })

  it('redacts by key regardless of the value', () => {
    expect(redact({ passwordHash: 12_345 }).passwordHash).toBe('[redacted]')
  })

  it('keeps null', () => {
    expect(redact({ deletedAt: null })).toEqual({ deletedAt: null })
  })

  /** A workflow must not be able to fill this table. */
  it('truncates a long string', () => {
    const value = redact({ note: 'x'.repeat(2000) }).note as string

    expect(value).toHaveLength(501)
    expect(value.endsWith('…')).toBe(true)
  })

  it('summarises a nested object rather than copying it', () => {
    expect(redact({ price: { amountCents: 4900 } }).price).toBe('[object]')
  })

  it('summarises an array by length', () => {
    expect(redact({ steps: [1, 2, 3] }).steps).toBe('[3 items]')
  })

  it('bounds how many keys it keeps', () => {
    const wide = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]))

    expect(Object.keys(redact(wide))).toHaveLength(50)
  })

  it('handles nothing at all', () => {
    expect(redact({})).toEqual({})
  })
})
