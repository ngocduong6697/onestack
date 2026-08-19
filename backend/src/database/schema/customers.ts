import { sql } from 'drizzle-orm'
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { citext } from './users'
import { workspaces } from './workspaces'

/** A lead and a customer are the same person at different moments. */
export const CUSTOMER_STAGES = ['lead', 'qualified', 'active', 'churned'] as const
export type CustomerStage = (typeof CUSTOMER_STAGES)[number]

export const customers = pgTable(
  'customers',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: citext('email'),
    company: text('company'),
    phone: text('phone'),
    stage: text('stage', { enum: CUSTOMER_STAGES }).notNull().default('lead'),
    /** Minor units. Money is never a float. */
    valueCents: integer('value_cents').notNull().default(0),
    /** Stamped the first time this record reaches `active`, and never again. */
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    /**
     * Partial, on purpose. One address should not appear twice in a workspace,
     * but a record without an address is ordinary and many must coexist.
     */
    uniqueIndex('customers_workspace_email_unique')
      .on(table.workspaceId, table.email)
      .where(sql`${table.email} is not null`),
    index('customers_workspace_stage_idx').on(table.workspaceId, table.stage),
    // Keyset pagination reads this directly.
    index('customers_workspace_id_idx').on(table.workspaceId, table.id),
  ],
)

export type CustomerRow = typeof customers.$inferSelect
