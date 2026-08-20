import { Inject, Injectable, Logger } from '@nestjs/common'
import type { AiModelDto, CompletionRequestBody, CompletionResponse } from '@onestack/shared'
import { NotFoundError, ValidationError } from '../common/errors'
import { costOf } from './cost'
import { AI_PROVIDERS_TOKEN, type ConfiguredProviders } from './providers.factory'
import type { AiProvider } from './provider'
import { findModel, MODELS, type ModelEntry } from './registry'
import { AiUsageService } from './usage.service'

/** Who and where the spend is attributed to. */
export interface AiCaller {
  workspaceId: string
  userId: string | null
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  /**
   * The set of providers that actually have a key, supplied by the module's
   * factory. Injected through a token rather than built here, so a test can
   * hand over fakes without a key or a network.
   */
  constructor(
    @Inject(AI_PROVIDERS_TOKEN) private readonly providers: ConfiguredProviders,
    private readonly usage: AiUsageService,
  ) {}

  /** Only models whose provider is actually configured. */
  listModels(): AiModelDto[] {
    return MODELS.filter((model) => this.providers.has(model.provider)).map((model) => ({
      id: model.id,
      provider: model.provider,
      label: model.label,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      inputMicroUsdPerMTok: model.inputMicroUsdPerMTok,
      outputMicroUsdPerMTok: model.outputMicroUsdPerMTok,
      pricing: model.pricing,
    }))
  }

  /**
   * Recording lives here rather than in an interceptor on the controller.
   * Rule 8 says *every* AI request, and TASK-011's automation engine will call
   * this service directly — a controller-level interceptor would miss it.
   */
  async complete(input: CompletionRequestBody, caller: AiCaller): Promise<CompletionResponse> {
    const { model, provider } = this.resolve(input.model)

    // The registry's ceiling wins, so a caller cannot ask one model for more
    // than it can produce and be billed for the attempt.
    const maxTokens = Math.min(input.maxTokens, model.maxOutputTokens)
    const startedAt = Date.now()

    let result

    try {
      result = await provider.complete({
        model: model.id,
        messages: input.messages,
        system: input.system,
        maxTokens,
      })
    } catch (error) {
      // A failed call can still have cost tokens, and a failure nobody
      // recorded is a bill nobody can explain.
      await this.usage.record({
        workspaceId: caller.workspaceId,
        userId: caller.userId,
        provider: model.provider,
        model: model.id,
        status: 'failed',
        usage: { inputTokens: 0, outputTokens: 0 },
        costMicroUsd: 0,
        durationMs: Date.now() - startedAt,
        errorCode: errorCodeOf(error),
      })

      // Rethrown unchanged: recording must not disguise what went wrong.
      throw error
    }

    const cost = costOf(result.usage, model)

    await this.usage.record({
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      provider: model.provider,
      model: model.id,
      status: 'succeeded',
      usage: result.usage,
      costMicroUsd: cost.microUsd,
      durationMs: Date.now() - startedAt,
      stopReason: result.stopReason,
    })

    return {
      model: model.id,
      provider: model.provider,
      text: result.text,
      usage: result.usage,
      costMicroUsd: cost.microUsd,
      costCents: cost.cents,
      stopReason: result.stopReason,
    }
  }

  /**
   * Yields text, then the same accounting a non-streamed call would give —
   * including the record. TASK-010 recorded `complete` and left this path
   * unrecorded, which would have made rule 8 depend on which method a caller
   * happened to choose.
   */
  async *stream(
    input: CompletionRequestBody,
    caller: AiCaller,
  ): AsyncGenerator<string, CompletionResponse> {
    const { model, provider } = this.resolve(input.model)
    const maxTokens = Math.min(input.maxTokens, model.maxOutputTokens)
    const startedAt = Date.now()

    const generator = provider.stream({
      model: model.id,
      messages: input.messages,
      system: input.system,
      maxTokens,
    })

    let next

    try {
      next = await generator.next()

      while (!next.done) {
        yield next.value
        next = await generator.next()
      }
    } catch (error) {
      await this.usage.record({
        workspaceId: caller.workspaceId,
        userId: caller.userId,
        provider: model.provider,
        model: model.id,
        status: 'failed',
        usage: { inputTokens: 0, outputTokens: 0 },
        costMicroUsd: 0,
        durationMs: Date.now() - startedAt,
        errorCode: errorCodeOf(error),
      })

      throw error
    }

    const result = next.value
    const cost = costOf(result.usage, model)

    await this.usage.record({
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      provider: model.provider,
      model: model.id,
      status: 'succeeded',
      usage: result.usage,
      costMicroUsd: cost.microUsd,
      durationMs: Date.now() - startedAt,
      stopReason: result.stopReason,
    })

    return {
      model: model.id,
      provider: model.provider,
      text: result.text,
      usage: result.usage,
      costMicroUsd: cost.microUsd,
      costCents: cost.cents,
      stopReason: result.stopReason,
    }
  }

  private resolve(modelId: string): { model: ModelEntry; provider: AiProvider } {
    const model = findModel(modelId)

    if (!model) throw new NotFoundError(`Unknown model "${modelId}"`)

    const provider = this.providers.get(model.provider)

    // Configured-ness is a deployment fact, not a caller mistake, but the
    // caller still has to be told it cannot use this model.
    if (!provider) {
      throw new ValidationError(
        `The ${model.provider} provider is not configured on this deployment`,
      )
    }

    return { model, provider }
  }
}

/** The domain code, never the vendor's message. */
function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code

    if (typeof code === 'string') return code
  }

  return error instanceof Error ? error.constructor.name : 'unknown_error'
}
