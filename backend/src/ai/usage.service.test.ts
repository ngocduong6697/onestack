import { describe, expect, it, vi } from 'vitest'
import type { Database } from '../database/client'
import { AiUsageService } from './usage.service'

/**
 * The guarantee that matters here: the answer has already been generated and
 * paid for by the time a row is written. Losing it because bookkeeping failed
 * would be the worse of the two outcomes, so `record` must never throw.
 */
describe('AiUsageService.record', () => {
  const entry = {
    workspaceId: '01a01a00-0000-7000-8000-000000000001',
    userId: null,
    provider: 'anthropic',
    model: 'claude-opus-5',
    status: 'succeeded' as const,
    usage: { inputTokens: 1000, outputTokens: 500 },
    costMicroUsd: 17_500,
    durationMs: 1234,
  }

  it('writes the row it was given', async () => {
    const values = vi.fn().mockResolvedValue(undefined)
    const db = { insert: vi.fn().mockReturnValue({ values }) } as unknown as Database

    await new AiUsageService(db).record(entry)

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-opus-5',
        status: 'succeeded',
        inputTokens: 1000,
        outputTokens: 500,
        costMicroUsd: 17_500,
        durationMs: 1234,
      }),
    )
  })

  it('defaults the cache buckets a vendor did not report', async () => {
    const values = vi.fn().mockResolvedValue(undefined)
    const db = { insert: vi.fn().mockReturnValue({ values }) } as unknown as Database

    await new AiUsageService(db).record(entry)

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ cacheReadTokens: 0, cacheWriteTokens: 0 }),
    )
  })

  it('carries cache buckets through when the vendor did report them', async () => {
    const values = vi.fn().mockResolvedValue(undefined)
    const db = { insert: vi.fn().mockReturnValue({ values }) } as unknown as Database

    await new AiUsageService(db).record({
      ...entry,
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 3 },
    })

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ cacheReadTokens: 7, cacheWriteTokens: 3 }),
    )
  })

  /** The whole point: a bookkeeping failure must not cost the caller an answer. */
  it('does not throw when the database is unavailable', async () => {
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('database is down')),
      }),
    } as unknown as Database

    await expect(new AiUsageService(db).record(entry)).resolves.toBeUndefined()
  })

  it('does not throw when the insert itself blows up synchronously', async () => {
    const db = {
      insert: vi.fn().mockImplementation(() => {
        throw new Error('pool exhausted')
      }),
    } as unknown as Database

    await expect(new AiUsageService(db).record(entry)).resolves.toBeUndefined()
  })

  it('writes nothing resembling a prompt or an answer', async () => {
    const values = vi.fn().mockResolvedValue(undefined)
    const db = { insert: vi.fn().mockReturnValue({ values }) } as unknown as Database

    await new AiUsageService(db).record(entry)

    const written = JSON.stringify(values.mock.calls[0]![0])
    for (const field of ['prompt', 'completion', 'text', 'content', 'messages']) {
      expect(written).not.toContain(field)
    }
  })
})
