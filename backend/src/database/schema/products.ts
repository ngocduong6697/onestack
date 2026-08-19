import { sql } from 'drizzle-orm'
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { workspaces } from './workspaces'

export const PRODUCT_STATUSES = ['active', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const products = pgTable(
  'products',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sku: text('sku'),
    description: text('description'),
    /**
     * Archived rather than deleted once a price exists, so a subscription in
     * TASK-008 can never point at a row that vanished.
     */
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('active'),
    ...timestamps,
  },
  (table) => [
    // Unique when present, absent as often as you like — the same shape as
    // the customer email index, and for the same reason.
    uniqueIndex('products_workspace_sku_unique')
      .on(table.workspaceId, table.sku)
      .where(sql`${table.sku} is not null`),
    index('products_workspace_status_idx').on(table.workspaceId, table.status),
    index('products_workspace_id_idx').on(table.workspaceId, table.id),
  ],
)

export type ProductRow = typeof products.$inferSelect
