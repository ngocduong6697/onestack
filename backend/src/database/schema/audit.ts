import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { idColumn, timestamps } from './columns'
import { organizations } from './organizations'
import { users } from './users'
import { workspaces } from './workspaces'

/**
 * CLAUDE.md rule 7.
 *
 * Scoped to the organization rather than a workspace: signing in and changing
 * somebody's role are organization-level facts that happen outside any
 * workspace. `workspace_id` is filled in when there is one.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    /**
     * set null, with the name kept alongside. Deleting a person must not erase
     * what they did — and a null actor with no label is an entry that answers
     * nothing.
     */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The actor's name as it was, or `system` for anything automated. */
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    /** Redacted and bounded before it gets here. */
    changes: jsonb('changes'),
    context: jsonb('context'),
    ...timestamps,
  },
  (table) => [
    index('audit_events_org_created_idx').on(table.organizationId, table.createdAt),
    index('audit_events_org_id_idx').on(table.organizationId, table.id),
    index('audit_events_action_idx').on(table.organizationId, table.action),
  ],
)

export type AuditEventRow = typeof auditEvents.$inferSelect
