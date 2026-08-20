import { bigint, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { users } from './users'
import { workspaces } from './workspaces'

export const LEDGER_KINDS = ['cost', 'revenue'] as const
export type LedgerKind = (typeof LEDGER_KINDS)[number]

/**
 * One row per workspace per day.
 *
 * Snapshots exist because current state cannot answer "what was MRR in June".
 * A subscription records what it is now; once a price changes or it cancels,
 * what it used to be is gone.
 */
export const metricSnapshots = pgTable(
  'metric_snapshots',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    capturedOn: date('captured_on').notNull(),
    mrrMicroUsd: bigint('mrr_micro_usd', { mode: 'number' }).notNull().default(0),
    customers: integer('customers').notNull().default(0),
    activeCustomers: integer('active_customers').notNull().default(0),
    activeSubscriptions: integer('active_subscriptions').notNull().default(0),
    aiCostMicroUsd: bigint('ai_cost_micro_usd', { mode: 'number' }).notNull().default(0),
    recordedCostMicroUsd: bigint('recorded_cost_micro_usd', { mode: 'number' })
      .notNull()
      .default(0),
    recordedRevenueMicroUsd: bigint('recorded_revenue_micro_usd', { mode: 'number' })
      .notNull()
      .default(0),
    ...timestamps,
  },
  (table) => [
    // A day has one row: running the job twice corrects it, never duplicates.
    uniqueIndex('metric_snapshots_day_unique').on(table.workspaceId, table.capturedOn),
    index('metric_snapshots_range_idx').on(table.workspaceId, table.capturedOn),
  ],
)

/**
 * Costs and revenue the system cannot know for itself — a hosting bill, a
 * one-off invoice. TASK-013 can write into the same table automatically.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    entryDate: date('entry_date').notNull(),
    /** The sign lives here, so an amount is always positive. */
    kind: text('kind', { enum: LEDGER_KINDS }).notNull(),
    category: text('category').notNull(),
    amountMicroUsd: bigint('amount_micro_usd', { mode: 'number' }).notNull(),
    note: text('note'),
    /** set null: the money moved regardless of who is still here. */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    index('ledger_entries_range_idx').on(table.workspaceId, table.entryDate),
    index('ledger_entries_workspace_id_idx').on(table.workspaceId, table.id),
  ],
)

export type MetricSnapshotRow = typeof metricSnapshots.$inferSelect
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect
