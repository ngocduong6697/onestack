import { bigint, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { users } from './users'
import { workspaces } from './workspaces'

export const AI_REQUEST_STATUSES = ['succeeded', 'failed'] as const
export type AiRequestStatus = (typeof AI_REQUEST_STATUSES)[number]

/**
 * One row per AI call — CLAUDE.md rule 8.
 *
 * Deliberately holds no prompt and no completion. A leak here exposes what was
 * spent, not what anybody asked.
 */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** set null: the spend happened, and outlives the person leaving. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status', { enum: AI_REQUEST_STATUSES }).notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /**
     * bigint, not integer. Micro-dollars are millionths, so integer would top
     * out near $2,147 and wrap silently — which is worse than no column.
     * Read back as a number: JavaScript is exact to about $9e9 in these units.
     */
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    /** The domain code, never a vendor message. */
    errorCode: text('error_code'),
    stopReason: text('stop_reason'),
    ...timestamps,
  },
  (table) => [
    // The summary's range query.
    index('ai_requests_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('ai_requests_workspace_id_idx').on(table.workspaceId, table.id),
  ],
)

export type AiRequestRow = typeof aiRequests.$inferSelect
