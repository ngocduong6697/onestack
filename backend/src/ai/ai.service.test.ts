import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '../common/errors'
import { AiService } from './ai.service'
import type { AiProvider, CompletionResult } from './provider'
import type { AiProviderName } from './registry'

/** A provider that answers without a network or a key. */
function fakeProvider(name: AiProviderName, result: Partial<CompletionResult> = {}): AiProvider {
  const full: CompletionResult = {
    text: 'answer',
    usage: { inputTokens: 1000, outputTokens: 500 },
    stopReason: 'end_turn',
    ...result,
  }

  return {
    name,
    complete: vi.fn().mockResolvedValue(full),
    stream: vi.fn(),
  } as unknown as AiProvider
}

const serviceWith = (...names: AiProviderName[]) =>
  new AiService(new Map(names.map((name) => [name, fakeProvider(name)])))

describe('AiService', () => {
  describe('listModels', () => {
    it('lists only models whose provider is configured', () => {
      const models = serviceWith('anthropic').listModels()

      expect(models.length).toBeGreaterThan(0)
      expect(models.every((model) => model.provider === 'anthropic')).toBe(true)
    })

    it('lists nothing when no provider has a key', () => {
      expect(new AiService(new Map()).listModels()).toEqual([])
    })

    it('never exposes anything resembling a key', () => {
      const serialised = JSON.stringify(serviceWith('anthropic', 'openai', 'google').listModels())

      expect(serialised).not.toMatch(/apiKey|api_key|sk-/i)
    })

    it('carries pricing provenance to the caller', () => {
      const [model] = serviceWith('anthropic').listModels()

      expect(model?.pricing.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('complete', () => {
    it('returns the answer with usage and cost attached', async () => {
      const result = await serviceWith('anthropic').complete({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      })

      expect(result).toMatchObject({
        model: 'claude-opus-5',
        provider: 'anthropic',
        text: 'answer',
      })
      // 1000 input at $5/MTok plus 500 output at $25/MTok.
      expect(result.costMicroUsd).toBe(1000 * 5 + 500 * 25)
    })

    it('refuses a model nobody has heard of', async () => {
      await expect(
        serviceWith('anthropic').complete({
          model: 'gpt-9-ultra',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 100,
        }),
      ).rejects.toThrow(NotFoundError)
    })

    /** Configured-ness is a deployment fact, but the caller still needs telling. */
    it('refuses a known model whose provider has no key', async () => {
      await expect(
        serviceWith('anthropic').complete({
          model: 'gemini-3.7-flash',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 100,
        }),
      ).rejects.toThrow(ValidationError)
    })

    it('caps maxTokens at what the model can actually produce', async () => {
      const provider = fakeProvider('anthropic')
      const service = new AiService(new Map([['anthropic', provider]]))

      await service.complete({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 128_000,
      })

      // Haiku tops out at 64k, whatever the caller asked for.
      expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 64_000 }))
    })

    it('passes a smaller request through untouched', async () => {
      const provider = fakeProvider('anthropic')
      const service = new AiService(new Map([['anthropic', provider]]))

      await service.complete({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 500,
      })

      expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 500 }))
    })

    it('routes each model to its own provider', async () => {
      const anthropic = fakeProvider('anthropic')
      const google = fakeProvider('google')
      const service = new AiService(
        new Map([
          ['anthropic', anthropic],
          ['google', google],
        ]),
      )

      await service.complete({
        model: 'gemini-3.7-flash',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      })

      expect(google.complete).toHaveBeenCalled()
      expect(anthropic.complete).not.toHaveBeenCalled()
    })

    it('costs a cheap model at its own rate, not the flagship one', async () => {
      const result = await serviceWith('google').complete({
        model: 'gemini-2.5-flash-lite',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      })

      expect(result.costMicroUsd).toBe(1000 * 0.1 + 500 * 0.4)
    })
  })
})
