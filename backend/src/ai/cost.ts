import { NotFoundError } from '../common/errors'
import { findModel, type ModelEntry } from './registry'

/** What every adapter must report, whatever the vendor calls these fields. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  /** Served from the vendor's prompt cache, where it reports them. */
  cacheReadTokens?: number
  /** Written to it. */
  cacheWriteTokens?: number
}

export interface RequestCost {
  /** Exact, integer. A hundredth of a cent still adds up over a month. */
  microUsd: number
  /** Rounded, for display. Small requests legitimately round to zero. */
  cents: number
}

const MICRO_USD_PER_CENT = 10_000

/**
 * Cost from usage, in integer arithmetic throughout.
 *
 * Prices are micro-dollars per million tokens, so `tokens * price` is
 * micro-dollars per million and the division lands back on micro-dollars.
 * Both operands stay far inside the safe integer range: a million tokens at
 * the most expensive listed rate is about 1.8e14.
 */
export function costOf(usage: TokenUsage, model: ModelEntry): RequestCost {
  const line = (tokens: number | undefined, microUsdPerMTok: number | undefined): number => {
    if (!tokens || !microUsdPerMTok) return 0

    return Math.round((tokens * microUsdPerMTok) / 1_000_000)
  }

  // Cached reads are billed at the cache rate instead of the input rate, not
  // as well as it — the vendor reports them as a separate bucket.
  const microUsd =
    line(usage.inputTokens, model.inputMicroUsdPerMTok) +
    line(usage.outputTokens, model.outputMicroUsdPerMTok) +
    line(usage.cacheReadTokens, model.cacheReadMicroUsdPerMTok) +
    line(usage.cacheWriteTokens, model.cacheWriteMicroUsdPerMTok)

  return { microUsd, cents: Math.round(microUsd / MICRO_USD_PER_CENT) }
}

/**
 * Refuses an unknown model rather than costing it at zero. A silent zero is
 * how an AI bill becomes a surprise.
 */
export function costOfModelId(usage: TokenUsage, modelId: string): RequestCost {
  const model = findModel(modelId)

  if (!model) {
    throw new NotFoundError(`Unknown model "${modelId}" — cost cannot be determined`)
  }

  return costOf(usage, model)
}
