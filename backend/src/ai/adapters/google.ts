import { GoogleGenAI } from '@google/genai'
import { ServiceUnavailableError } from '../../common/errors'
import type { TokenUsage } from '../cost'
import type { AiProvider, CompletionRequest, CompletionResult } from '../provider'

/** Only `models` is used, so a fake need only provide that. */
export type GoogleClient = Pick<GoogleGenAI, 'models'>

type GoogleUsage = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
  thoughtsTokenCount?: number
}

/**
 * Gemini reports thinking tokens separately from the answer, but bills them as
 * output. Folding them in here keeps cost honest — leaving them out would
 * quietly under-report every reasoning request.
 */
function usageOf(usage: GoogleUsage | undefined): TokenUsage {
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    cacheReadTokens: usage?.cachedContentTokenCount,
  }
}

export class GoogleProvider implements AiProvider {
  readonly name = 'google' as const

  constructor(private readonly client: GoogleClient) {}

  static fromApiKey(apiKey: string): GoogleProvider {
    return new GoogleProvider(new GoogleGenAI({ apiKey }))
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    try {
      const response = await this.client.models.generateContent({
        model: request.model,
        // Gemini names the assistant role "model", and carries the system
        // prompt in config rather than in the turn list.
        contents: request.messages.map((entry) => ({
          role: entry.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: entry.content }],
        })),
        config: {
          maxOutputTokens: request.maxTokens,
          ...(request.system ? { systemInstruction: request.system } : {}),
        },
      })

      return {
        text: response.text ?? '',
        usage: usageOf(response.usageMetadata),
        stopReason: 'end_turn',
      }
    } catch (error) {
      throw translate(error)
    }
  }

  async *stream(request: CompletionRequest): AsyncGenerator<string, CompletionResult> {
    try {
      const events = await this.client.models.generateContentStream({
        model: request.model,
        contents: request.messages.map((entry) => ({
          role: entry.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: entry.content }],
        })),
        config: {
          maxOutputTokens: request.maxTokens,
          ...(request.system ? { systemInstruction: request.system } : {}),
        },
      })

      let text = ''
      let usage: GoogleUsage | undefined

      for await (const chunk of events) {
        const piece = chunk.text

        if (piece) {
          text += piece
          yield piece
        }

        // Every chunk may carry usage; the last one is the complete count.
        if (chunk.usageMetadata) usage = chunk.usageMetadata
      }

      return { text, usage: usageOf(usage), stopReason: 'end_turn' }
    } catch (error) {
      throw translate(error)
    }
  }
}

/**
 * The Google SDK does not export typed error classes the way the other two do,
 * so the status is read defensively rather than matched on a class.
 */
function translate(error: unknown): Error {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : undefined

  if (status === 429) {
    return new ServiceUnavailableError('The AI provider is rate limiting this request')
  }
  if (status !== undefined && status >= 500) {
    return new ServiceUnavailableError('The AI provider is unavailable')
  }

  return error instanceof Error ? error : new Error('Unknown AI provider failure')
}
