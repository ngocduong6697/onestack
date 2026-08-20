import { describe, expect, it } from 'vitest'
import { ConflictError } from '../common/errors'
import {
  applyPayment,
  assertTransition,
  canTransition,
  invoiceNumber,
  sequenceOf,
} from './invoice-state'

describe('the invoice status machine', () => {
  it.each([
    ['draft', 'open'],
    ['draft', 'void'],
    ['open', 'paid'],
    ['open', 'void'],
    ['open', 'uncollectible'],
    ['uncollectible', 'paid'],
  ] as const)('allows %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  /** The cases that matter: the ones that must not happen. */
  it.each([
    ['paid', 'void'],
    ['paid', 'open'],
    ['void', 'open'],
    ['void', 'paid'],
    ['draft', 'paid'],
    ['open', 'open'],
    ['draft', 'draft'],
  ] as const)('refuses %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
    expect(() => assertTransition(from, to)).toThrow(ConflictError)
  })

  it('says what it refused', () => {
    expect(() => assertTransition('paid', 'void')).toThrow('An invoice cannot go from paid to void')
  })

  it('leaves paid and void terminal', () => {
    for (const to of ['draft', 'open', 'paid', 'void', 'uncollectible'] as const) {
      expect(canTransition('paid', to)).toBe(to === 'paid' ? false : false)
      expect(canTransition('void', to)).toBe(false)
    }
  })
})

describe('applyPayment', () => {
  it('records a partial payment without settling', () => {
    const result = applyPayment({
      totalMicroUsd: 1000,
      alreadyPaidMicroUsd: 0,
      amountMicroUsd: 400,
    })

    expect(result).toEqual({ amountPaidMicroUsd: 400, settled: false })
  })

  it('settles when the remainder arrives', () => {
    const result = applyPayment({
      totalMicroUsd: 1000,
      alreadyPaidMicroUsd: 400,
      amountMicroUsd: 600,
    })

    expect(result).toEqual({ amountPaidMicroUsd: 1000, settled: true })
  })

  it('settles on a single payment in full', () => {
    expect(
      applyPayment({ totalMicroUsd: 1000, alreadyPaidMicroUsd: 0, amountMicroUsd: 1000 }),
    ).toEqual({ amountPaidMicroUsd: 1000, settled: true })
  })

  /** A record claiming more was paid than owed looks like reconciled money. */
  it('refuses an overpayment', () => {
    expect(() =>
      applyPayment({ totalMicroUsd: 1000, alreadyPaidMicroUsd: 0, amountMicroUsd: 1001 }),
    ).toThrow(ConflictError)
  })

  it('refuses a payment against an already settled invoice', () => {
    expect(() =>
      applyPayment({ totalMicroUsd: 1000, alreadyPaidMicroUsd: 1000, amountMicroUsd: 1 }),
    ).toThrow(/outstanding/)
  })

  it('settles a zero-total invoice with a zero payment', () => {
    expect(applyPayment({ totalMicroUsd: 0, alreadyPaidMicroUsd: 0, amountMicroUsd: 0 })).toEqual({
      amountPaidMicroUsd: 0,
      settled: true,
    })
  })
})

describe('invoice numbers', () => {
  it('pads the sequence', () => {
    expect(invoiceNumber(2026, 1)).toBe('INV-2026-0001')
    expect(invoiceNumber(2026, 42)).toBe('INV-2026-0042')
  })

  it('keeps going past four digits', () => {
    expect(invoiceNumber(2026, 12_345)).toBe('INV-2026-12345')
  })

  it('reads its own sequence back', () => {
    expect(sequenceOf('INV-2026-0042', 2026)).toBe(42)
    expect(sequenceOf('INV-2026-12345', 2026)).toBe(12_345)
  })

  it('reads nothing from another year or a foreign format', () => {
    expect(sequenceOf('INV-2025-0042', 2026)).toBe(0)
    expect(sequenceOf('SOMETHING-ELSE', 2026)).toBe(0)
    expect(sequenceOf(null, 2026)).toBe(0)
  })
})
