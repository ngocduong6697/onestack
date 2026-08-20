import { Inject, Injectable, Logger } from '@nestjs/common'
import { workflowStepsSchema, type WorkflowStep } from '@onestack/shared'
import { eq } from 'drizzle-orm'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { runs, runSteps, workflows, type RunRow, type WorkflowRow } from '../database/schema'
import { Actions } from './actions'
import type { StepOutputs } from './templates'

const MAX_STORED_ERROR = 1000

@Injectable()
export class WorkflowRunner {
  private readonly logger = new Logger(WorkflowRunner.name)

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly actions: Actions,
  ) {}

  /**
   * Runs every step in order, stopping at the first failure. The steps after
   * it are still recorded, as `skipped` — a run that simply ends leaves you
   * guessing whether the rest ran and produced nothing, or never ran at all.
   */
  async run(workflow: WorkflowRow, jobId: string | null, userId: string | null): Promise<RunRow> {
    const steps = workflowStepsSchema.parse(workflow.steps) as WorkflowStep[]

    const [run] = await this.db
      .insert(runs)
      .values({
        workspaceId: workflow.workspaceId,
        workflowId: workflow.id,
        jobId,
        status: 'running',
      })
      .returning()

    const outputs: StepOutputs = {}
    let failure: string | null = null

    for (const [index, step] of steps.entries()) {
      if (failure !== null) {
        await this.db.insert(runSteps).values({
          runId: run!.id,
          index,
          action: step.action,
          status: 'skipped',
        })
        continue
      }

      const startedAt = Date.now()

      try {
        const outcome = await this.actions.run(step, {
          workspaceId: workflow.workspaceId,
          userId,
          outputs,
        })

        outputs[index] = outcome.output

        await this.db.insert(runSteps).values({
          runId: run!.id,
          index,
          action: step.action,
          status: 'succeeded',
          durationMs: Date.now() - startedAt,
          output: outcome.output,
          costMicroUsd: outcome.costMicroUsd,
        })
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)

        await this.db.insert(runSteps).values({
          runId: run!.id,
          index,
          action: step.action,
          status: 'failed',
          durationMs: Date.now() - startedAt,
          error: failure.slice(0, MAX_STORED_ERROR),
        })
      }
    }

    const [finished] = await this.db
      .update(runs)
      .set({
        status: failure ? 'failed' : 'succeeded',
        finishedAt: new Date(),
        error: failure?.slice(0, MAX_STORED_ERROR) ?? null,
      })
      .where(eq(runs.id, run!.id))
      .returning()

    await this.db
      .update(workflows)
      .set({ lastRunAt: new Date() })
      .where(eq(workflows.id, workflow.id))

    return finished!
  }
}
