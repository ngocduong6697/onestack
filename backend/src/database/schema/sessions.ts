import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { users } from './users'

export const sessions = pgTable(
  'sessions',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      // Deleting a person deletes their ability to be logged in. Anything
      // else leaves live sessions pointing at nothing.
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * SHA-256 of the token the client holds, never the token. Reading this
     * table gives an attacker nothing they can present as a cookie.
     */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (table) => [
    // Revoking every session for one person.
    index('sessions_user_id_idx').on(table.userId),
    // Sweeping expired rows.
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export type SessionRow = typeof sessions.$inferSelect
