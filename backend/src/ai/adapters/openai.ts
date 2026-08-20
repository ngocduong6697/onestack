import OpenAI from 'openai'
import { ServiceUnavailableError, ValidationError } from '../../common/errors'
import type { TokenUsage } from '../cost'
import type { AiProvider, CompletionRequest, CompletionResult } from '../provider'

/** Only the Responses surface is used, so a fake need only provide that. */
export type OpenAiClient = Pick<OpenAI, 'responses'>

type ResponseLike = {
  output_text: string
  usage?: {
    input_tokens: number
    output_tokens: number
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
  } | null
  incomplete_details?: { reason?: string | null } | null
}

function usageOf(usage: ResponseLike['usage']): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.input_tokens_details?.cached_tokens,
    cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens,
  }
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const

  constructor(private readonly client: OpenAiClient) {}

  static fromApiKey(apiKey: string): OpenAiProvider {
    return new OpenAiProvider(new OpenAI({ apiKey }))
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    try {
      const response = (await this.client.responses.create({
        model: request.model,
        // The Responses API takes a role-tagged input list, and the system
        // prompt is `instructions` rather than a message.
        input: request.messages.map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
        ...(request.system ? { instructions: request.system } : {}),
        max_output_tokens: request.maxTokens,
      })) as unknown as ResponseLike

      return {
        text: response.output_text,
        usage: usageOf(response.usage),
        stopReason:
          response.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : 'end_turn',
      }
    } catch (error) {
      throw translate(error)
    }
  }

  async *stream(request: CompletionRequest): AsyncGenerator<string, CompletionResult> {
    try {
      const events = (await this.client.responses.create({
        model: request.model,
        input: request.messages.map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
        ...(request.system ? { instructions: request.system } : {}),
        max_output_tokens: request.maxTokens,
        stream: true,
      })) as unknown as AsyncIterable<{
        type: string
        delta?: string
        response?: ResponseLike
      }>

      let text = ''
      let final: ResponseLike | undefined

      for await (const event of events) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          text += event.delta
          yield event.delta
        }

        // Usage arrives only on the completion event.
        if (event.type === 'response.completed' && event.response) {
          final = event.response
        }
      }

      return {
        text: final?.output_text ?? text,
        usage: usageOf(final?.usage),
        stopReason: 'end_turn',
      }
    } catch (error) {
      throw translate(error)
    }
  }
}

function translate(error: unknown): Error {
  if (error instanceof OpenAI.RateLimitError) {
    return new ServiceUnavailableError('The AI provider is rate limiting this request')
  }
  if (error instanceof OpenAI.BadRequestError) {
    return new ValidationError('The AI provider rejected this request as invalid')
  }
  if (error instanceof OpenAI.APIError) {
    return new ServiceUnavailableError('The AI provider is unavailable')
  }

  return error instanceof Error ? error : new Error('Unknown AI provider failure')
}
