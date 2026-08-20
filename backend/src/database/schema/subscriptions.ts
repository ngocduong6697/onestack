import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { customers } from './customers'
import { productPrices } from './product-prices'
import { workspaces } from './workspaces'

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /**
     * restrict, where everything else here cascades. A price somebody is
     * subscribed to must outlive an attempt to tidy the catalogue — it records
     * what they agreed to pay. TASK-007 refuses to delete a priced product;
     * this closes the same door from the other side.
     */
    priceId: uuid('price_id')
      .notNull()
      .references(() => productPrices.id, { onDelete: 'restrict' }),
    status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull().default('active'),
    /** Cancelling keeps what was paid for until the period runs out. */
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    /** Null for a one-off price, which has no period to be inside. */
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    /**
     * One live subscription per customer per price. Partial, so cancelling and
     * resubscribing later is allowed — the same shape used for open invitations.
     */
    uniqueIndex('subscriptions_live_unique')
      .on(table.customerId, table.priceId)
      .where(sql`${table.status} <> 'canceled'`),
    index('subscriptions_workspace_status_idx').on(table.workspaceId, table.status),
    index('subscriptions_workspace_id_idx').on(table.workspaceId, table.id),
    index('subscriptions_customer_idx').on(table.customerId),
  ],
)

export type SubscriptionRow = typeof subscriptions.$inferSelect
