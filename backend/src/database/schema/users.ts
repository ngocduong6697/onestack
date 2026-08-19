import { customType, index, text, timestamp } from 'drizzle-orm/pg-core'
import { pgTable } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'

/**
 * citext, installed by TASK-002's migration. Emails are compared
 * case-insensitively by the database rather than by every caller remembering
 * to lower() first.
 */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
})

export const USER_STATUSES = ['active', 'disabled'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const users = pgTable(
  'users',
  {
    id: idColumn(),
    email: citext('email').notNull().unique(),
    /** argon2id encoded string. Never a password, never reversible. */
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('users_status_idx').on(table.status)],
)

export type UserRow = typeof users.$inferSelect
