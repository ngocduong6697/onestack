import { pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { organizations } from './organizations'

export const workspaces = pgTable(
  'workspaces',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ...timestamps,
  },
  // Per organization, not global: two companies may both want "general".
  (table) => [unique('workspaces_org_slug_unique').on(table.organizationId, table.slug)],
)

export type WorkspaceRow = typeof workspaces.$inferSelect
