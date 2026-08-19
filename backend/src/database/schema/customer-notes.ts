import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { customers } from './customers'
import { users } from './users'

/** Append-only. A timeline that can be rewritten is not a timeline. */
export const customerNotes = pgTable(
  'customer_notes',
  {
    id: idColumn(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /**
     * set null: a note records what was said, and should outlive the person
     * who said it leaving the company.
     */
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    ...timestamps,
  },
  (table) => [index('customer_notes_customer_idx').on(table.customerId, table.id)],
)

export type CustomerNoteRow = typeof customerNotes.$inferSelect
