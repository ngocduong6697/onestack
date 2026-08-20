/**
 * The model registry: what can be called, and what it costs.
 *
 * Prices are integer **micro-dollars per million tokens** — a millionth of a
 * dollar, so $5.00/MTok is 5_000_000 and $0.075/MTok is 75_000. Money is never
 * a float here, and these are the numbers a cost report is built from, so each
 * entry records where the price came from and when it was checked. A price
 * nobody has verified is worse than no price at all.
 */
export const AI_PROVIDERS = ['anthropic', 'openai', 'google'] as const
export type AiProviderName = (typeof AI_PROVIDERS)[number]

export interface ModelEntry {
  id: string
  provider: AiProviderName
  /** Marketing name, for a picker. */
  label: string
  contextWindow: number
  maxOutputTokens: number
  inputMicroUsdPerMTok: number
  outputMicroUsdPerMTok: number
  /** Reading from the vendor's prompt cache, where the vendor offers one. */
  cacheReadMicroUsdPerMTok?: number
  /** Writing to it. Anthropic charges 1.25x input; others fold it into input. */
  cacheWriteMicroUsdPerMTok?: number
  pricing: { source: string; checkedOn: string }
}

const ANTHROPIC_PRICING = {
  source: 'Anthropic first-party API rates, via the claude-api reference',
  checkedOn: '2026-06-24',
}

const OPENAI_PRICING = {
  source: 'https://developers.openai.com/api/docs/pricing',
  checkedOn: '2026-08-20',
}

const GOOGLE_PRICING = {
  source: 'https://ai.google.dev/gemini-api/docs/pricing',
  checkedOn: '2026-08-20',
}

export const MODELS: readonly ModelEntry[] = [
  // --- Anthropic ---
  {
    id: 'claude-opus-5',
    provider: 'anthropic',
    label: 'Claude Opus 5',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputMicroUsdPerMTok: 5_000_000,
    outputMicroUsdPerMTok: 25_000_000,
    cacheReadMicroUsdPerMTok: 500_000,
    cacheWriteMicroUsdPerMTok: 6_250_000,
    pricing: ANTHROPIC_PRICING,
  },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputMicroUsdPerMTok: 3_000_000,
    outputMicroUsdPerMTok: 15_000_000,
    cacheReadMicroUsdPerMTok: 300_000,
    cacheWriteMicroUsdPerMTok: 3_750_000,
    pricing: ANTHROPIC_PRICING,
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputMicroUsdPerMTok: 1_000_000,
    outputMicroUsdPerMTok: 5_000_000,
    cacheReadMicroUsdPerMTok: 100_000,
    cacheWriteMicroUsdPerMTok: 1_250_000,
    pricing: ANTHROPIC_PRICING,
  },
  // --- OpenAI ---
  {
    id: 'gpt-5.6-terra',
    provider: 'openai',
    label: 'GPT-5.6 Terra',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    inputMicroUsdPerMTok: 2_000_000,
    outputMicroUsdPerMTok: 12_000_000,
    cacheReadMicroUsdPerMTok: 200_000,
    pricing: OPENAI_PRICING,
  },
  {
    id: 'gpt-5.6-luna',
    provider: 'openai',
    label: 'GPT-5.6 Luna',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    inputMicroUsdPerMTok: 200_000,
    outputMicroUsdPerMTok: 1_200_000,
    cacheReadMicroUsdPerMTok: 20_000,
    pricing: OPENAI_PRICING,
  },
  // --- Google ---
  {
    id: 'gemini-3.7-flash',
    provider: 'google',
    label: 'Gemini 3.7 Flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    inputMicroUsdPerMTok: 750_000,
    outputMicroUsdPerMTok: 3_750_000,
    cacheReadMicroUsdPerMTok: 75_000,
    pricing: GOOGLE_PRICING,
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'google',
    label: 'Gemini 2.5 Flash-Lite',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    inputMicroUsdPerMTok: 100_000,
    outputMicroUsdPerMTok: 400_000,
    cacheReadMicroUsdPerMTok: 10_000,
    pricing: GOOGLE_PRICING,
  },
]

export function findModel(id: string): ModelEntry | undefined {
  return MODELS.find((model) => model.id === id)
}

export function modelsFor(providers: readonly AiProviderName[]): ModelEntry[] {
  return MODELS.filter((model) => providers.includes(model.provider))
}
