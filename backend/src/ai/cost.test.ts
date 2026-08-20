import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../common/errors'
import { costOf, costOfModelId } from './cost'
import { findModel, MODELS } from './registry'

const opus = findModel('claude-opus-5')!

describe('costOf', () => {
  it('charges input and output at their own rates', () => {
    // 1M in at $5 and 1M out at $25 is $30 — 30_000_000 micro-dollars.
    const cost = costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, opus)

    expect(cost.microUsd).toBe(30_000_000)
    expect(cost.cents).toBe(3000)
  })

  it('is zero for a request that used nothing', () => {
    expect(costOf({ inputTokens: 0, outputTokens: 0 }, opus)).toEqual({
      microUsd: 0,
      cents: 0,
    })
  })

  it('charges cached reads at the cache rate, not the input rate', () => {
    const cached = costOf({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }, opus)

    // $0.50 rather than $5.00.
    expect(cached.microUsd).toBe(500_000)
  })

  it('charges cache writes at the premium rate', () => {
    const written = costOf({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 }, opus)

    // 1.25x input.
    expect(written.microUsd).toBe(6_250_000)
  })

  /** A hundredth of a cent still adds up over a month of requests. */
  it('keeps sub-cent amounts exactly, and rounds only for display', () => {
    const cost = costOf({ inputTokens: 1000, outputTokens: 100 }, opus)

    // 1000 * 5 + 100 * 25 = 7500 micro-dollars, which is 0.75 of a cent.
    expect(cost.microUsd).toBe(7500)
    expect(cost.cents).toBe(1)
  })

  it('reports zero cents for a request too small to reach one, without losing it', () => {
    const cost = costOf({ inputTokens: 10, outputTokens: 1 }, opus)

    expect(cost.microUsd).toBe(75)
    expect(cost.cents).toBe(0)
  })

  it('ignores cache buckets for a model that has no cache pricing', () => {
    const model = { ...opus, cacheReadMicroUsdPerMTok: undefined }

    expect(
      costOf({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }, model).microUsd,
    ).toBe(0)
  })

  it('stays exact at a realistic large request', () => {
    const cost = costOf({ inputTokens: 900_000, outputTokens: 120_000 }, opus)

    expect(cost.microUsd).toBe(900_000 * 5 + 120_000 * 25)
    expect(Number.isSafeInteger(cost.microUsd)).toBe(true)
  })
})

describe('costOfModelId', () => {
  it('costs a known model', () => {
    expect(
      costOfModelId({ inputTokens: 1_000_000, outputTokens: 0 }, 'claude-opus-5').microUsd,
    ).toBe(5_000_000)
  })

  /** A silent zero is how an AI bill becomes a surprise. */
  it('refuses an unknown model rather than costing it at nothing', () => {
    expect(() => costOfModelId({ inputTokens: 1000, outputTokens: 1000 }, 'gpt-9')).toThrow(
      NotFoundError,
    )
  })
})

describe('the registry itself', () => {
  it('prices every model it lists', () => {
    for (const model of MODELS) {
      expect(model.inputMicroUsdPerMTok).toBeGreaterThan(0)
      expect(model.outputMicroUsdPerMTok).toBeGreaterThan(0)
    }
  })

  it('uses integer micro-dollars, so no price is a float', () => {
    for (const model of MODELS) {
      expect(Number.isInteger(model.inputMicroUsdPerMTok)).toBe(true)
      expect(Number.isInteger(model.outputMicroUsdPerMTok)).toBe(true)
    }
  })

  it('has no duplicate model ids', () => {
    const ids = MODELS.map((model) => model.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  /** A price nobody checked is worse than no price. */
  it('records where every price came from and when it was checked', () => {
    for (const model of MODELS) {
      expect(model.pricing.source.length).toBeGreaterThan(0)
      expect(model.pricing.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('costs output at least as much as input, which every vendor does', () => {
    for (const model of MODELS) {
      expect(model.outputMicroUsdPerMTok).toBeGreaterThanOrEqual(model.inputMicroUsdPerMTok)
    }
  })

  it('covers all three providers', () => {
    expect(new Set(MODELS.map((model) => model.provider))).toEqual(
      new Set(['anthropic', 'openai', 'google']),
    )
  })
})
