import { describe, expect, it, vi } from 'vitest'
import { AiService } from './ai.service'
import type { AiProvider, CompletionResult } from './provider'
import type { AiUsageService } from './usage.service'

/**
 * The streaming path, which TASK-011 added usage recording to and nothing
 * exercised until now. Rule 8 says every AI request records usage and cost;
 * until this file existed, that was true of `complete` by test and of
 * `stream` by inspection.
 */

function streamingProvider(
  pieces: string[],
  final: CompletionResult,
  failAfter?: number,
): AiProvider {
  return {
    name: 'anthropic',
    complete: vi.fn(),
    async *stream() {
      for (const [index, piece] of pieces.entries()) {
        if (failAfter !== undefined && index === failAfter) {
          throw Object.assign(new Error('the stream broke'), { code: 'service_unavailable' })
        }
        yield piece
      }

      return final
    },
  } as unknown as AiProvider
}

const finished: CompletionResult = {
  text: 'Hello there',
  usage: { inputTokens: 1000, outputTokens: 500 },
  stopReason: 'end_turn',
}

const caller = { workspaceId: '01a01a00-0000-7000-8000-000000000001', userId: 'user-1' }

const request = {
  model: 'claude-opus-5',
  messages: [{ role: 'user' as const, content: 'Hi' }],
  maxTokens: 100,
}

function fakeUsage() {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AiUsageService
}

/** Drains a generator, keeping both the yields and the return value. */
async function drain(generator: AsyncGenerator<string, unknown>) {
  const pieces: string[] = []
  let next = await generator.next()

  while (!next.done) {
    pieces.push(next.value)
    next = await generator.next()
  }

  return { pieces, result: next.value }
}

describe('AiService.stream', () => {
  it('yields each piece as it arrives', async () => {
    const service = new AiService(
      new Map([['anthropic', streamingProvider(['Hello ', 'there'], finished)]]),
      fakeUsage(),
    )

    const { pieces } = await drain(service.stream(request, caller))

    expect(pieces).toEqual(['Hello ', 'there'])
  })

  it('returns the same accounting a non-streamed call would', async () => {
    const service = new AiService(
      new Map([['anthropic', streamingProvider(['Hello ', 'there'], finished)]]),
      fakeUsage(),
    )

    const { result } = await drain(service.stream(request, caller))

    expect(result).toMatchObject({
      model: 'claude-opus-5',
      provider: 'anthropic',
      text: 'Hello there',
      // 1000 input at $5/MTok plus 500 output at $25/MTok.
      costMicroUsd: 1000 * 5 + 500 * 25,
      stopReason: 'end_turn',
    })
  })

  /** The claim TASK-011 made, now asserted rather than inspected. */
  it('records the usage, like complete does', async () => {
    const usage = fakeUsage()
    const service = new AiService(
      new Map([['anthropic', streamingProvider(['Hello'], finished)]]),
      usage,
    )

    await drain(service.stream(request, caller))

    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: caller.workspaceId,
        userId: 'user-1',
        provider: 'anthropic',
        model: 'claude-opus-5',
        status: 'succeeded',
        costMicroUsd: 1000 * 5 + 500 * 25,
      }),
    )
  })

  /** A stream that dies half way still cost something to start. */
  it('records a failure when the stream breaks part way, and rethrows', async () => {
    const usage = fakeUsage()
    const service = new AiService(
      new Map([['anthropic', streamingProvider(['Hello ', 'there'], finished, 1)]]),
      usage,
    )

    await expect(drain(service.stream(request, caller))).rejects.toThrow('the stream broke')

    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: 'service_unavailable' }),
    )
  })

  it('records a failure that happens before anything is yielded', async () => {
    const usage = fakeUsage()
    const service = new AiService(
      new Map([['anthropic', streamingProvider(['Hello'], finished, 0)]]),
      usage,
    )

    await expect(drain(service.stream(request, caller))).rejects.toThrow()

    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('caps maxTokens at what the model can produce', async () => {
    const provider = streamingProvider(['x'], finished)
    const spy = vi.spyOn(provider, 'stream')
    const service = new AiService(new Map([['anthropic', provider]]), fakeUsage())

    await drain(
      service.stream({ ...request, model: 'claude-haiku-4-5', maxTokens: 128_000 }, caller),
    )

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 64_000 }))
  })

  it('refuses a model whose provider is not configured', async () => {
    const service = new AiService(new Map(), fakeUsage())

    await expect(drain(service.stream(request, caller))).rejects.toThrow(/not configured/)
  })

  it('never passes prompt text to the recorder', async () => {
    const usage = fakeUsage()
    const service = new AiService(
      new Map([['anthropic', streamingProvider(['Hello'], finished)]]),
      usage,
    )

    await drain(
      service.stream(
        { ...request, messages: [{ role: 'user', content: 'a very secret prompt' }] },
        caller,
      ),
    )

    const entry = (usage.record as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]
    expect(JSON.stringify(entry)).not.toContain('a very secret prompt')
  })
})
