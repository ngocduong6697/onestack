import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { workspaces } from './workspaces'

export const TRIGGER_TYPES = ['manual', 'schedule'] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

export const workflows = pgTable(
  'workflows',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    triggerType: text('trigger_type', { enum: TRIGGER_TYPES }).notNull().default('manual'),
    cron: text('cron'),
    timezone: text('timezone').notNull().default('UTC'),
    /**
     * jsonb rather than a fifth table: a definition is written and read whole
     * and never queried by step, so a table would buy joins nobody needs.
     */
    steps: jsonb('steps').notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('workflows_workspace_id_idx').on(table.workspaceId, table.id),
    // The scheduler's sweep: enabled, scheduled, and due.
    index('workflows_due_idx').on(table.enabled, table.nextRunAt),
  ],
)

export type WorkflowRow = typeof workflows.$inferSelect
