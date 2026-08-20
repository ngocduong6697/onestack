import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { jobs } from './jobs'
import { workflows } from './workflows'
import { workspaces } from './workspaces'

export const RUN_STATUSES = ['running', 'succeeded', 'failed'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const STEP_STATUSES = ['succeeded', 'failed', 'skipped'] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

export const runs = pgTable(
  'runs',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    /** set null: the run happened even if the job row is later cleaned up. */
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    status: text('status', { enum: RUN_STATUSES }).notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    ...timestamps,
  },
  (table) => [index('runs_workflow_idx').on(table.workflowId, table.id)],
)

export const runSteps = pgTable(
  'run_steps',
  {
    id: idColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    /** Position in the definition, so ordering survives out-of-order writes. */
    index: integer('index').notNull(),
    action: text('action').notNull(),
    status: text('status', { enum: STEP_STATUSES }).notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    /** Bounded before storage — a workflow must not be able to fill the disk. */
    output: jsonb('output'),
    error: text('error'),
    costMicroUsd: integer('cost_micro_usd').notNull().default(0),
    ...timestamps,
  },
  (table) => [index('run_steps_run_idx').on(table.runId, table.index)],
)

export type RunRow = typeof runs.$inferSelect
export type RunStepRow = typeof runSteps.$inferSelect
