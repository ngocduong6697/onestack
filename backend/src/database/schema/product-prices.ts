import { boolean, index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { products } from './products'

export const PRICE_INTERVALS = ['one_time', 'month', 'year'] as const
export type PriceInterval = (typeof PRICE_INTERVALS)[number]

/**
 * Immutable once created. Nothing writes amount, currency or interval after
 * the insert — raising a price means adding a row and archiving the old one,
 * so a subscription created against a price still describes what was agreed.
 *
 * The guarantee is that no endpoint exists to change them. A trigger would be
 * stronger and invisible to anyone reading the service.
 */
export const productPrices = pgTable(
  'product_prices',
  {
    id: idColumn(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Minor units. Zero is legitimate: free plans exist. */
    amountCents: integer('amount_cents').notNull(),
    /** ISO 4217, stored uppercase. */
    currency: varchar('currency', { length: 3 }).notNull(),
    interval: text('interval', { enum: PRICE_INTERVALS }).notNull(),
    /** The only mutable column, and only ever from true to false. */
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [index('product_prices_product_active_idx').on(table.productId, table.active)],
)

export type ProductPriceRow = typeof productPrices.$inferSelect
