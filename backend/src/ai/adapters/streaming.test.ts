import { describe, expect, it, vi } from 'vitest'
import { AnthropicProvider, type AnthropicClient } from './anthropic'
import { OpenAiProvider, type OpenAiClient } from './openai'

/**
 * The vendors' streaming paths, which coverage showed were the least exercised
 * code in the AI module — 42% and 62% of lines respectively.
 */

const request = {
  model: 'test-model',
  messages: [{ role: 'user' as const, content: 'Hello' }],
  maxTokens: 100,
}

async function drain(generator: AsyncGenerator<string, unknown>) {
  const pieces: string[] = []
  let next = await generator.next()

  while (!next.done) {
    pieces.push(next.value)
    next = await generator.next()
  }

  return { pieces, result: next.value as { text: string; usage: Record<string, number> } }
}

describe('AnthropicProvider.stream', () => {
  /** The SDK yields events and assembles the final message separately. */
  function clientWith(events: unknown[], finalMessage: unknown): AnthropicClient {
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event
      },
      finalMessage: vi.fn().mockResolvedValue(finalMessage),
    }

    return { messages: { stream: vi.fn().mockReturnValue(stream) } } as unknown as AnthropicClient
  }

  const finalMessage = {
    content: [{ type: 'text', text: 'Hello there' }],
    usage: {
      input_tokens: 12,
      output_tokens: 5,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: null,
    },
    stop_reason: 'end_turn',
  }

  const textEvents = [
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } },
  ]

  it('yields each text delta', async () => {
    const provider = new AnthropicProvider(clientWith(textEvents, finalMessage))

    const { pieces } = await drain(provider.stream(request))

    expect(pieces).toEqual(['Hello ', 'there'])
  })

  it('ignores events that are not text deltas', async () => {
    const provider = new AnthropicProvider(
      clientWith(
        [
          { type: 'message_start' },
          { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
          ...textEvents,
          { type: 'message_stop' },
        ],
        finalMessage,
      ),
    )

    const { pieces } = await drain(provider.stream(request))

    expect(pieces).toEqual(['Hello ', 'there'])
  })

  /** Usage only exists on the assembled message, not on the deltas. */
  it('reports the final usage from the assembled message', async () => {
    const provider = new AnthropicProvider(clientWith(textEvents, finalMessage))

    const { result } = await drain(provider.stream(request))

    expect(result.text).toBe('Hello there')
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: undefined,
    })
  })

  it('sends the system prompt when there is one', async () => {
    const client = clientWith(textEvents, finalMessage)
    const provider = new AnthropicProvider(client)

    await drain(provider.stream({ ...request, system: 'Be brief' }))

    expect(client.messages.stream).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'Be brief' }),
    )
  })
})

describe('OpenAiProvider.stream', () => {
  function clientWith(events: unknown[]): OpenAiClient {
    return {
      responses: {
        create: vi.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event
          },
        }),
      },
    } as unknown as OpenAiClient
  }

  const completed = {
    type: 'response.completed',
    response: {
      output_text: 'Hello there',
      usage: {
        input_tokens: 20,
        output_tokens: 8,
        input_tokens_details: { cached_tokens: 4 },
      },
    },
  }

  it('yields each delta and reports the final usage', async () => {
    const provider = new OpenAiProvider(
      clientWith([
        { type: 'response.output_text.delta', delta: 'Hello ' },
        { type: 'response.output_text.delta', delta: 'there' },
        completed,
      ]),
    )

    const { pieces, result } = await drain(provider.stream(request))

    expect(pieces).toEqual(['Hello ', 'there'])
    expect(result.text).toBe('Hello there')
    expect(result.usage).toMatchObject({ inputTokens: 20, outputTokens: 8, cacheReadTokens: 4 })
  })

  it('ignores unrelated events', async () => {
    const provider = new OpenAiProvider(
      clientWith([
        { type: 'response.created' },
        { type: 'response.output_text.delta', delta: 'Hi' },
        { type: 'response.in_progress' },
        completed,
      ]),
    )

    const { pieces } = await drain(provider.stream(request))

    expect(pieces).toEqual(['Hi'])
  })

  /** Without a completion event there is no usage, and zero is the honest answer. */
  it('falls back to the assembled text when no completion event arrives', async () => {
    const provider = new OpenAiProvider(
      clientWith([{ type: 'response.output_text.delta', delta: 'Partial' }]),
    )

    const { result } = await drain(provider.stream(request))

    expect(result.text).toBe('Partial')
    expect(result.usage).toMatchObject({ inputTokens: 0, outputTokens: 0 })
  })

  it('asks for a stream', async () => {
    const client = clientWith([completed])

    await drain(new OpenAiProvider(client).stream(request))

    expect(client.responses.create).toHaveBeenCalledWith(expect.objectContaining({ stream: true }))
  })
})
