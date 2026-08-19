import { index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { ROLES } from '../../orgs/roles'
import { idColumn, timestamps } from './columns'
import { organizations } from './organizations'
import { users } from './users'

/** The join that makes tenancy real: who may see which organization, as what. */
export const memberships = pgTable(
  'memberships',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ROLES }).notNull().default('member'),
    ...timestamps,
  },
  (table) => [
    // One role per person per organization, enforced by the database rather
    // than by every caller checking first.
    unique('memberships_org_user_unique').on(table.organizationId, table.userId),
    // "Which organizations am I in" runs on every navigation.
    index('memberships_user_id_idx').on(table.userId),
  ],
)

export type MembershipRow = typeof memberships.$inferSelect
