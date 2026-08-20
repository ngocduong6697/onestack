import { Logger } from '@nestjs/common'
import { loadEnv } from '../config/env'
import { AnthropicProvider } from './adapters/anthropic'
import { GoogleProvider } from './adapters/google'
import { OpenAiProvider } from './adapters/openai'
import type { AiProvider } from './provider'
import type { AiProviderName } from './registry'

export const AI_PROVIDERS_TOKEN = Symbol('AI_PROVIDERS')

export type ConfiguredProviders = Map<AiProviderName, AiProvider>

/**
 * Builds the providers that have a key. A provider without one is simply
 * absent — constructing it anyway would defer the failure to the first
 * request, and refusing to boot would make one unused vendor everybody's
 * problem.
 */
export function providersFromEnv(): ConfiguredProviders {
  const env = loadEnv()
  const providers: ConfiguredProviders = new Map()

  if (env.ANTHROPIC_API_KEY) {
    providers.set('anthropic', AnthropicProvider.fromApiKey(env.ANTHROPIC_API_KEY))
  }
  if (env.OPENAI_API_KEY) {
    providers.set('openai', OpenAiProvider.fromApiKey(env.OPENAI_API_KEY))
  }
  if (env.GOOGLE_API_KEY) {
    providers.set('google', GoogleProvider.fromApiKey(env.GOOGLE_API_KEY))
  }

  // Names only, never a key.
  new Logger('AiProviders').log(
    `AI providers configured: ${[...providers.keys()].join(', ') || 'none'}`,
  )

  return providers
}
