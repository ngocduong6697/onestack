import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { ROLES } from '../../orgs/roles'
import { idColumn, timestamps } from './columns'
import { organizations } from './organizations'
import { citext, users } from './users'

export const invitations = pgTable(
  'invitations',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    role: text('role', { enum: ROLES }).notNull().default('member'),
    /** SHA-256 of the token, exactly like a session. Never the token. */
    tokenHash: text('token_hash').notNull().unique(),
    /**
     * set null, not cascade: an invitation records something that happened,
     * and it should survive the person who sent it leaving.
     */
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    /**
     * One *open* invite per address per organization. Partial, because a plain
     * unique constraint would refuse to re-invite somebody who accepted and
     * later left.
     */
    uniqueIndex('invitations_open_unique')
      .on(table.organizationId, table.email)
      .where(sql`${table.acceptedAt} is null`),
    index('invitations_org_idx').on(table.organizationId),
  ],
)

export type InvitationRow = typeof invitations.$inferSelect
