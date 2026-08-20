import Anthropic from '@anthropic-ai/sdk'
import { ServiceUnavailableError, ValidationError } from '../../common/errors'
import type { AiProvider, CompletionRequest, CompletionResult } from '../provider'
import type { TokenUsage } from '../cost'

/** The pieces of the SDK this adapter uses, so a test can supply a fake. */
export type AnthropicClient = Pick<Anthropic, 'messages'>

function usageOf(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? undefined,
  }
}

function stopReasonOf(reason: Anthropic.Message['stop_reason']): CompletionResult['stopReason'] {
  if (reason === 'end_turn') return 'end_turn'
  if (reason === 'max_tokens') return 'max_tokens'
  if (reason === 'refusal') return 'refusal'
  return 'other'
}

/** Content is a union; only text blocks contribute to the answer. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const

  constructor(private readonly client: AnthropicClient) {}

  static fromApiKey(apiKey: string): AnthropicProvider {
    return new AnthropicProvider(new Anthropic({ apiKey }))
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    try {
      const message = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages.map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
      })

      return {
        text: textOf(message.content),
        usage: usageOf(message.usage),
        stopReason: stopReasonOf(message.stop_reason),
      }
    } catch (error) {
      throw translate(error)
    }
  }

  async *stream(request: CompletionRequest): AsyncGenerator<string, CompletionResult> {
    try {
      const stream = this.client.messages.stream({
        model: request.model,
        max_tokens: request.maxTokens,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages.map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text
        }
      }

      // The SDK assembles the final message for us; usage lives only there.
      const message = await stream.finalMessage()

      return {
        text: textOf(message.content),
        usage: usageOf(message.usage),
        stopReason: stopReasonOf(message.stop_reason),
      }
    } catch (error) {
      throw translate(error)
    }
  }
}

/**
 * Vendor errors become domain errors. The vendor's message may carry request
 * internals, so only the shape is kept, never the body.
 */
function translate(error: unknown): Error {
  if (error instanceof Anthropic.RateLimitError) {
    return new ServiceUnavailableError('The AI provider is rate limiting this request')
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ValidationError('The AI provider rejected this request as invalid')
  }
  if (error instanceof Anthropic.APIError) {
    return new ServiceUnavailableError('The AI provider is unavailable')
  }

  return error instanceof Error ? error : new Error('Unknown AI provider failure')
}
