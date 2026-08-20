import { sql } from 'drizzle-orm'
import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { customers } from './customers'
import { subscriptions } from './subscriptions'
import { users } from './users'
import { workspaces } from './workspaces'

export const INVOICE_STATUSES = ['draft', 'open', 'paid', 'void', 'uncollectible'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const invoices = pgTable(
  'invoices',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * restrict, not cascade. An invoice records who owed what; deleting the
     * customer must not erase it. Deleting a customer with invoices therefore
     * fails, which is the correct answer rather than an inconvenience.
     */
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    /** set null: an invoice outlives the subscription that caused it. */
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    /** Null until issued: a draft has no number to burn. */
    number: text('number'),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('draft'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    subtotalMicroUsd: bigint('subtotal_micro_usd', { mode: 'number' }).notNull().default(0),
    totalMicroUsd: bigint('total_micro_usd', { mode: 'number' }).notNull().default(0),
    amountPaidMicroUsd: bigint('amount_paid_micro_usd', { mode: 'number' }).notNull().default(0),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // A number is unique within a workspace; drafts have none.
    uniqueIndex('invoices_number_unique')
      .on(table.workspaceId, table.number)
      .where(sql`${table.number} is not null`),
    /**
     * One invoice per subscription per period, so renewing twice cannot bill
     * twice — the guarantee the renew path depends on.
     */
    uniqueIndex('invoices_period_unique')
      .on(table.subscriptionId, table.periodStart)
      .where(sql`${table.subscriptionId} is not null`),
    index('invoices_workspace_status_idx').on(table.workspaceId, table.status),
    index('invoices_workspace_id_idx').on(table.workspaceId, table.id),
    index('invoices_due_idx').on(table.status, table.dueAt),
  ],
)

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: idColumn(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitMicroUsd: bigint('unit_micro_usd', { mode: 'number' }).notNull(),
    amountMicroUsd: bigint('amount_micro_usd', { mode: 'number' }).notNull(),
    ...timestamps,
  },
  (table) => [index('invoice_lines_invoice_idx').on(table.invoiceId, table.id)],
)

export const payments = pgTable(
  'payments',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amountMicroUsd: bigint('amount_micro_usd', { mode: 'number' }).notNull(),
    method: text('method').notNull(),
    /** Whatever identifies it elsewhere — a bank reference, a receipt number. */
    reference: text('reference'),
    receivedOn: date('received_on').notNull(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [index('payments_invoice_idx').on(table.invoiceId, table.id)],
)

export type InvoiceRow = typeof invoices.$inferSelect
export type InvoiceLineRow = typeof invoiceLines.$inferSelect
export type PaymentRow = typeof payments.$inferSelect
