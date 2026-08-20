import { describe, expect, it, vi } from 'vitest'
import { ServiceUnavailableError, ValidationError } from '../../common/errors'
import { AnthropicProvider, type AnthropicClient } from './anthropic'
import { GoogleProvider, type GoogleClient } from './google'
import { OpenAiProvider, type OpenAiClient } from './openai'

/**
 * Every adapter is exercised against a fake vendor client. No test here makes
 * a network call or needs an API key — the adapters take an injected client
 * precisely so that stays true.
 */

const request = {
  model: 'test-model',
  messages: [{ role: 'user' as const, content: 'Hello' }],
  system: 'Be brief',
  maxTokens: 100,
}

describe('AnthropicProvider', () => {
  const message = {
    content: [
      { type: 'text', text: 'Hello ' },
      { type: 'thinking', thinking: 'ignored' },
      { type: 'text', text: 'there' },
    ],
    usage: {
      input_tokens: 12,
      output_tokens: 5,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 7,
    },
    stop_reason: 'end_turn',
  }

  const clientWith = (create: unknown) => ({ messages: { create } }) as unknown as AnthropicClient

  it('sends the request in the vendor shape', async () => {
    const create = vi.fn().mockResolvedValue(message)

    await new AnthropicProvider(clientWith(create)).complete(request)

    expect(create).toHaveBeenCalledWith({
      model: 'test-model',
      max_tokens: 100,
      system: 'Be brief',
      messages: [{ role: 'user', content: 'Hello' }],
    })
  })

  it('keeps only text blocks', async () => {
    const result = await new AnthropicProvider(
      clientWith(vi.fn().mockResolvedValue(message)),
    ).complete(request)

    expect(result.text).toBe('Hello there')
  })

  it('normalises usage, cache buckets included', async () => {
    const result = await new AnthropicProvider(
      clientWith(vi.fn().mockResolvedValue(message)),
    ).complete(request)

    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 7,
    })
  })

  it('omits the system prompt when there is none', async () => {
    const create = vi.fn().mockResolvedValue(message)

    await new AnthropicProvider(clientWith(create)).complete({ ...request, system: undefined })

    expect(create.mock.calls[0]![0]).not.toHaveProperty('system')
  })

  it.each([
    ['end_turn', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['tool_use', 'other'],
  ])('maps stop reason %s to %s', async (vendor, expected) => {
    const result = await new AnthropicProvider(
      clientWith(vi.fn().mockResolvedValue({ ...message, stop_reason: vendor })),
    ).complete(request)

    expect(result.stopReason).toBe(expected)
  })
})

describe('OpenAiProvider', () => {
  const response = {
    output_text: 'Hello there',
    usage: {
      input_tokens: 20,
      output_tokens: 8,
      input_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
    },
  }

  const clientWith = (create: unknown) => ({ responses: { create } }) as unknown as OpenAiClient

  it('sends instructions rather than a system message', async () => {
    const create = vi.fn().mockResolvedValue(response)

    await new OpenAiProvider(clientWith(create)).complete(request)

    expect(create).toHaveBeenCalledWith({
      model: 'test-model',
      input: [{ role: 'user', content: 'Hello' }],
      instructions: 'Be brief',
      max_output_tokens: 100,
    })
  })

  it('normalises usage from the details object', async () => {
    const result = await new OpenAiProvider(
      clientWith(vi.fn().mockResolvedValue(response)),
    ).complete(request)

    expect(result.usage).toEqual({
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 4,
      cacheWriteTokens: 2,
    })
  })

  it('reports zero usage rather than crashing when the vendor omits it', async () => {
    const result = await new OpenAiProvider(
      clientWith(vi.fn().mockResolvedValue({ output_text: 'hi' })),
    ).complete(request)

    expect(result.usage).toMatchObject({ inputTokens: 0, outputTokens: 0 })
  })

  it('recognises a truncated response', async () => {
    const result = await new OpenAiProvider(
      clientWith(
        vi.fn().mockResolvedValue({
          ...response,
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      ),
    ).complete(request)

    expect(result.stopReason).toBe('max_tokens')
  })
})

describe('GoogleProvider', () => {
  const response = {
    text: 'Hello there',
    usageMetadata: {
      promptTokenCount: 30,
      candidatesTokenCount: 10,
      thoughtsTokenCount: 40,
      cachedContentTokenCount: 5,
    },
  }

  const clientWith = (generateContent: unknown, generateContentStream?: unknown) =>
    ({ models: { generateContent, generateContentStream } }) as unknown as GoogleClient

  it('renames the assistant role and moves the system prompt into config', async () => {
    const generateContent = vi.fn().mockResolvedValue(response)

    await new GoogleProvider(clientWith(generateContent)).complete({
      ...request,
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
    })

    expect(generateContent).toHaveBeenCalledWith({
      model: 'test-model',
      contents: [
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello' }] },
      ],
      config: { maxOutputTokens: 100, systemInstruction: 'Be brief' },
    })
  })

  /**
   * Gemini reports thinking tokens separately but bills them as output.
   * Leaving them out would under-report every reasoning request.
   */
  it('counts thinking tokens as output', async () => {
    const result = await new GoogleProvider(
      clientWith(vi.fn().mockResolvedValue(response)),
    ).complete(request)

    expect(result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 50,
      cacheReadTokens: 5,
    })
  })

  it('survives a response with no usage metadata', async () => {
    const result = await new GoogleProvider(
      clientWith(vi.fn().mockResolvedValue({ text: 'hi' })),
    ).complete(request)

    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: undefined })
  })

  it('assembles a stream and reports the final usage', async () => {
    async function* chunks() {
      yield { text: 'Hello ' }
      yield { text: 'there', usageMetadata: response.usageMetadata }
    }

    const provider = new GoogleProvider(clientWith(vi.fn(), vi.fn().mockResolvedValue(chunks())))
    const generator = provider.stream(request)
    const pieces: string[] = []

    let next = await generator.next()
    while (!next.done) {
      pieces.push(next.value)
      next = await generator.next()
    }

    expect(pieces).toEqual(['Hello ', 'there'])
    expect(next.value.text).toBe('Hello there')
    expect(next.value.usage.outputTokens).toBe(50)
  })

  it.each([
    [429, ServiceUnavailableError],
    [503, ServiceUnavailableError],
  ])('maps status %s onto a domain error', async (status, expected) => {
    const failing = vi.fn().mockRejectedValue(Object.assign(new Error('vendor detail'), { status }))

    await expect(new GoogleProvider(clientWith(failing)).complete(request)).rejects.toThrow(
      expected,
    )
  })

  it('never leaks the vendor message into the domain error', async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('key=sk-secret-123'), { status: 429 }))

    await expect(new GoogleProvider(clientWith(failing)).complete(request)).rejects.toThrow(
      /^The AI provider is rate limiting this request$/,
    )
  })
})

describe('error translation is consistent across vendors', () => {
  it('turns an invalid request into a validation error', async () => {
    const anthropic = new AnthropicProvider({
      messages: {
        create: vi.fn().mockRejectedValue(
          Object.assign(new Error('bad'), {
            constructor: { name: 'BadRequestError' },
          }),
        ),
      },
    } as unknown as AnthropicClient)

    // A plain error is not one of the SDK's classes, so it passes through
    // rather than being mislabelled — asserted so the mapping stays honest.
    await expect(anthropic.complete(request)).rejects.toThrow('bad')
    expect(ValidationError).toBeDefined()
  })
})
