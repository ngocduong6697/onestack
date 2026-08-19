import { pgTable, text } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'

/** The tenant. Every business row will reach one of these, eventually. */
export const organizations = pgTable('organizations', {
  id: idColumn(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  ...timestamps,
})

export type OrganizationRow = typeof organizations.$inferSelect
