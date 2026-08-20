import { CronExpressionParser } from 'cron-parser'
import { ValidationError } from '../common/errors'

/**
 * The next time a cron expression fires, in the workflow's own timezone.
 *
 * Timezones are the reason this is a dependency rather than fifty lines of
 * arithmetic: "every day at 09:00 in Europe/London" is not a fixed number of
 * hours after the previous firing, twice a year.
 */
export function nextOccurrence(cron: string, timezone: string, from = new Date()): Date {
  try {
    const expression = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone })

    return expression.next().toDate()
  } catch (error) {
    throw new ValidationError(
      `That schedule could not be understood: ${error instanceof Error ? error.message : 'invalid'}`,
    )
  }
}

/**
 * What a workflow's `next_run_at` should be. A workflow that is disabled or
 * not on a schedule has none — which is also what stops the scheduler from
 * ever picking it up.
 */
export function nextRunFor(
  workflow: { enabled: boolean; triggerType: string; cron: string | null; timezone: string },
  from = new Date(),
): Date | null {
  if (!workflow.enabled) return null
  if (workflow.triggerType !== 'schedule') return null
  if (!workflow.cron) return null

  return nextOccurrence(workflow.cron, workflow.timezone, from)
}
