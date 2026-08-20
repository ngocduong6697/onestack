import { TEMPLATE_PATTERN, type WorkflowStep } from '@onestack/shared'
import { ValidationError } from '../common/errors'

/** What each finished step exposes to the ones after it. */
export type StepOutputs = Record<number, Record<string, unknown>>

/**
 * Substitutes `{{steps.0.text}}` with the named field of an earlier step.
 *
 * A reference to a step that has not run resolves to the empty string rather
 * than the literal template — but that case is meant to be unreachable,
 * because `assertTemplatesResolvable` rejects it when the workflow is written.
 */
export function render(template: string, outputs: StepOutputs): string {
  return template.replace(TEMPLATE_PATTERN, (_match, index: string, field: string) => {
    const value = outputs[Number(index)]?.[field]

    if (value === undefined || value === null) return ''

    return typeof value === 'string' ? value : JSON.stringify(value)
  })
}

/** Every `{{steps.N.field}}` a string mentions. */
export function referencedSteps(template: string): number[] {
  return [...template.matchAll(TEMPLATE_PATTERN)].map((match) => Number(match[1]))
}

function templatesIn(step: WorkflowStep): string[] {
  if (step.action === 'ai.complete') {
    return [step.prompt, step.system ?? '']
  }

  // A snapshot step takes no input, so it has nothing to template.
  if (step.action === 'analytics.snapshot') return []

  return [step.url, step.body ?? '', ...Object.values(step.headers ?? {})]
}

/**
 * Checked at write time. A step may only reference steps before it: referring
 * forward, or to itself, describes an order that cannot happen, and finding
 * that out mid-run at three in the morning is not the moment for it.
 */
export function assertTemplatesResolvable(steps: WorkflowStep[]): void {
  steps.forEach((step, index) => {
    for (const template of templatesIn(step)) {
      for (const referenced of referencedSteps(template)) {
        if (referenced >= index) {
          throw new ValidationError(
            `Step ${index} refers to step ${referenced}, which does not run before it`,
          )
        }
        if (referenced < 0 || referenced >= steps.length) {
          throw new ValidationError(
            `Step ${index} refers to step ${referenced}, which does not exist`,
          )
        }
      }
    }
  })
}
