import { timestamp, uuid } from 'drizzle-orm/pg-core'
import { newId } from '../ids'

/**
 * The column conventions every table inherits. Defined once so no future task
 * has to decide again, and so a schema-wide change is a single edit.
 */

/** UUIDv7 primary key, generated in the application before insert. */
export const idColumn = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => newId())

/**
 * Timestamps are `timestamptz`, always. A naive timestamp is a bug waiting
 * for the first customer in another timezone.
 */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}
