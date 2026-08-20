import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { workflows } from './workflows'
import { workspaces } from './workspaces'

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const jobs = pgTable(
  'jobs',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    /** When it becomes eligible. Backoff pushes this forward. */
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    /** Set when claimed; an old value means the worker died holding it. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [
    /**
     * Exactly what the claim filters and orders by. A claim that cannot use an
     * index is a claim that locks the table.
     */
    index('jobs_claim_idx').on(table.status, table.runAt),
    index('jobs_workspace_idx').on(table.workspaceId, table.id),
  ],
)

export type JobRow = typeof jobs.$inferSelect
