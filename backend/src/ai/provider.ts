import type { TokenUsage } from './cost'
import type { AiProviderName } from './registry'

/** Neutral message shape. Vendors differ; callers should not have to care. */
export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CompletionRequest {
  model: string
  messages: AiMessage[]
  system?: string
  maxTokens: number
}

export interface CompletionResult {
  text: string
  usage: TokenUsage
  /** Vendor's own reason, normalised to a small set. */
  stopReason: 'end_turn' | 'max_tokens' | 'refusal' | 'other'
}

/**
 * What every vendor adapter provides. Deliberately narrow: text in, text out,
 * tokens counted. Tool use and structured output are not here yet, and the
 * interface is the place to add them when a task needs them.
 */
export interface AiProvider {
  readonly name: AiProviderName

  complete(request: CompletionRequest): Promise<CompletionResult>

  /**
   * Yields text as it arrives, then returns the same usage a non-streamed call
   * would have reported — a streamed request must not cost differently or be
   * accounted for differently.
   */
  stream(request: CompletionRequest): AsyncGenerator<string, CompletionResult>
}
