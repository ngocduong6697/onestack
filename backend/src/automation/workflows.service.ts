import { Inject, Injectable } from '@nestjs/common'
import {
  workflowStepsSchema,
  type CreateWorkflowRequest,
  type Run,
  type RunPage,
  type RunWithSteps,
  type UpdateWorkflowRequest,
  type Workflow,
  type WorkflowStep,
} from '@onestack/shared'
import { and, asc, desc, eq, gt, type SQL } from 'drizzle-orm'
import { NotFoundError } from '../common/errors'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import {
  runSteps,
  runs,
  workflows,
  type RunRow,
  type RunStepRow,
  type WorkflowRow,
} from '../database/schema'
import { JobQueue } from './queue'
import { WorkflowRunner } from './runner'
import { nextRunFor } from './schedule'
import { assertTemplatesResolvable } from './templates'

const MAX_LIMIT = 100

function toWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    enabled: row.enabled,
    triggerType: row.triggerType,
    cron: row.cron,
    timezone: row.timezone,
    steps: workflowStepsSchema.parse(row.steps),
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    workflowId: row.workflowId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.error,
  }
}

function toStep(row: RunStepRow) {
  return {
    id: row.id,
    index: row.index,
    action: row.action,
    status: row.status,
    durationMs: row.durationMs,
    output: row.output ?? null,
    error: row.error,
    costMicroUsd: row.costMicroUsd,
  }
}

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: JobQueue,
    private readonly runner: WorkflowRunner,
  ) {}

  async create(workspaceId: string, input: CreateWorkflowRequest): Promise<Workflow> {
    // Checked here, at write time, so a broken reference is a rejected request
    // rather than a run that fails at three in the morning.
    assertTemplatesResolvable(input.steps as WorkflowStep[])

    const [created] = await this.db
      .insert(workflows)
      .values({
        workspaceId,
        name: input.name,
        enabled: input.enabled,
        triggerType: input.triggerType,
        cron: input.cron ?? null,
        timezone: input.timezone,
        steps: input.steps,
        nextRunAt: nextRunFor({
          enabled: input.enabled,
          triggerType: input.triggerType,
          cron: input.cron ?? null,
          timezone: input.timezone,
        }),
      })
      .returning()

    return toWorkflow(created!)
  }

  async list(workspaceId: string): Promise<Workflow[]> {
    const rows = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.workspaceId, workspaceId))
      .orderBy(asc(workflows.id))

    return rows.map(toWorkflow)
  }

  async get(workspaceId: string, id: string): Promise<Workflow> {
    return toWorkflow(await this.row(workspaceId, id))
  }

  async update(workspaceId: string, id: string, input: UpdateWorkflowRequest): Promise<Workflow> {
    const existing = await this.row(workspaceId, id)

    if (input.steps) assertTemplatesResolvable(input.steps as WorkflowStep[])

    const merged = {
      enabled: input.enabled ?? existing.enabled,
      triggerType: input.triggerType ?? existing.triggerType,
      cron: input.cron === undefined ? existing.cron : (input.cron ?? null),
      timezone: input.timezone ?? existing.timezone,
    }

    const [updated] = await this.db
      .update(workflows)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.steps !== undefined ? { steps: input.steps } : {}),
        ...merged,
        // Recomputed on every edit: disabling, rescheduling or switching to
        // manual all have to change when it next fires.
        nextRunAt: nextRunFor(merged),
      })
      .where(and(eq(workflows.id, id), eq(workflows.workspaceId, workspaceId)))
      .returning()

    return toWorkflow(updated!)
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.workspaceId, workspaceId)))
      .returning()

    if (deleted.length === 0) throw new NotFoundError('Workflow not found')
  }

  /** Runs it now, in the request, so the caller gets the result. */
  async runNow(workspaceId: string, id: string, userId: string): Promise<RunWithSteps> {
    const workflow = await this.row(workspaceId, id)
    const job = await this.queue.enqueue(workspaceId, workflow.id)

    // Claimed immediately so the poller does not also pick it up.
    await this.queue.succeed(job.id)

    const run = await this.runner.run(workflow, job.id, userId)

    return this.getRun(workspaceId, run.id)
  }

  async listRuns(
    workspaceId: string,
    workflowId: string,
    cursor?: string,
    limit = 25,
  ): Promise<RunPage> {
    await this.row(workspaceId, workflowId)

    const capped = Math.min(limit, MAX_LIMIT)
    const conditions: (SQL | undefined)[] = [
      eq(runs.workspaceId, workspaceId),
      eq(runs.workflowId, workflowId),
    ]

    if (cursor) conditions.push(gt(runs.id, cursor))

    const rows = await this.db
      .select()
      .from(runs)
      .where(and(...conditions))
      .orderBy(runs.id)
      .limit(capped + 1)

    const items = rows.slice(0, capped).map(toRun)

    return { items, nextCursor: rows.length > capped ? (items.at(-1)?.id ?? null) : null }
  }

  async getRun(workspaceId: string, runId: string): Promise<RunWithSteps> {
    const [run] = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId)))
      .limit(1)

    if (!run) throw new NotFoundError('Run not found')

    const steps = await this.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, run.id))
      .orderBy(asc(runSteps.index))

    return { ...toRun(run), steps: steps.map(toStep) }
  }

  private async row(workspaceId: string, id: string): Promise<WorkflowRow> {
    const rows = await this.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.workspaceId, workspaceId)))
      .limit(1)

    const row = rows[0]

    if (!row) throw new NotFoundError('Workflow not found')

    return row
  }
}
