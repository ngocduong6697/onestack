import { Inject, Injectable, Logger } from '@nestjs/common'
import type { AiModelDto, CompletionRequestBody, CompletionResponse } from '@onestack/shared'
import { NotFoundError, ValidationError } from '../common/errors'
import { costOf } from './cost'
import { AI_PROVIDERS_TOKEN, type ConfiguredProviders } from './providers.factory'
import type { AiProvider } from './provider'
import { findModel, MODELS, type ModelEntry } from './registry'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  /**
   * The set of providers that actually have a key, supplied by the module's
   * factory. Injected through a token rather than built here, so a test can
   * hand over fakes without a key or a network.
   */
  constructor(@Inject(AI_PROVIDERS_TOKEN) private readonly providers: ConfiguredProviders) {}

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

  async complete(input: CompletionRequestBody): Promise<CompletionResponse> {
    const { model, provider } = this.resolve(input.model)

    // The registry's ceiling wins, so a caller cannot ask one model for more
    // than it can produce and be billed for the attempt.
    const maxTokens = Math.min(input.maxTokens, model.maxOutputTokens)

    const result = await provider.complete({
      model: model.id,
      messages: input.messages,
      system: input.system,
      maxTokens,
    })

    const cost = costOf(result.usage, model)

    // Tokens and cost, never the prompt or the answer: both are customer data.
    this.logger.log(
      `${model.provider}/${model.id} in=${result.usage.inputTokens} out=${result.usage.outputTokens} cost=${cost.microUsd}µ$`,
    )

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

  /** Yields text, then the same accounting a non-streamed call would give. */
  async *stream(input: CompletionRequestBody): AsyncGenerator<string, CompletionResponse> {
    const { model, provider } = this.resolve(input.model)
    const maxTokens = Math.min(input.maxTokens, model.maxOutputTokens)

    const generator = provider.stream({
      model: model.id,
      messages: input.messages,
      system: input.system,
      maxTokens,
    })

    let next = await generator.next()

    while (!next.done) {
      yield next.value
      next = await generator.next()
    }

    const result = next.value
    const cost = costOf(result.usage, model)

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
