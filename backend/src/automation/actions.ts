import { Injectable, Logger } from '@nestjs/common'
import type { HttpStep, WorkflowStep } from '@onestack/shared'
import { AiService } from '../ai/ai.service'
import { AnalyticsService } from '../analytics/analytics.service'
import { assertSafeUrl } from './safe-url'
import { render, type StepOutputs } from './templates'

/** Enough of a response to be useful, bounded so nobody can fill the disk. */
const MAX_STORED_BODY = 10_000
const HTTP_TIMEOUT_MS = 30_000

export interface StepContext {
  workspaceId: string
  userId: string | null
  outputs: StepOutputs
}

export interface StepOutcome {
  output: Record<string, unknown>
  costMicroUsd: number
}

@Injectable()
export class Actions {
  private readonly logger = new Logger(Actions.name)

  constructor(
    private readonly ai: AiService,
    private readonly analytics: AnalyticsService,
  ) {}

  async run(step: WorkflowStep, context: StepContext): Promise<StepOutcome> {
    if (step.action === 'ai.complete') {
      // Through AiService, so the call is recorded like every other — rule 8
      // does not have an exception for automation.
      const result = await this.ai.complete(
        {
          model: step.model,
          messages: [{ role: 'user', content: render(step.prompt, context.outputs) }],
          system: step.system ? render(step.system, context.outputs) : undefined,
          maxTokens: step.maxTokens,
        },
        { workspaceId: context.workspaceId, userId: context.userId },
      )

      return {
        output: {
          text: result.text,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
        costMicroUsd: result.costMicroUsd,
      }
    }

    if (step.action === 'analytics.snapshot') {
      const row = await this.analytics.snapshot(context.workspaceId)

      return { output: { capturedOn: row.capturedOn }, costMicroUsd: 0 }
    }

    return this.http(step, context)
  }

  private async http(step: HttpStep, context: StepContext): Promise<StepOutcome> {
    const url = render(step.url, context.outputs)

    // Checked on the resolved address, every time, immediately before use.
    const safe = await assertSafeUrl(url)

    const headers = Object.fromEntries(
      Object.entries(step.headers ?? {}).map(([key, value]) => [
        key,
        render(value, context.outputs),
      ]),
    )

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

    try {
      const response = await fetch(safe.url, {
        method: step.method,
        headers,
        body: step.body ? render(step.body, context.outputs) : undefined,
        // A redirect is a second destination, and it has not been checked.
        redirect: 'manual',
        signal: controller.signal,
      })

      const text = (await response.text()).slice(0, MAX_STORED_BODY)

      return {
        output: { status: response.status, ok: response.ok, body: text },
        costMicroUsd: 0,
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
