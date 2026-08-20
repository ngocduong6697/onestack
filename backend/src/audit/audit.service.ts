import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { cappedLimit, toPage } from '../common/pagination'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { auditEvents, type AuditEventRow } from '../database/schema'
import type { AuditAction } from './actions'
import { redact } from './redact'

/** What automation records itself as. */
export const SYSTEM_ACTOR = 'system'

export interface AuditActor {
  userId: string | null
  /** The name at the time, kept so a deleted user still answers "who". */
  label: string
}

export interface AuditEntry {
  organizationId: string
  workspaceId?: string | null
  actor: AuditActor
  action: AuditAction
  resourceType: string
  resourceId?: string | null
  changes?: Record<string, unknown>
  context?: Record<string, unknown>
}

export interface AuditQuery {
  action?: string
  resourceType?: string
  actorId?: string
  from?: string
  to?: string
  cursor?: string
  limit: number
}

export interface AuditEventDto {
  id: string
  organizationId: string
  workspaceId: string | null
  actorUserId: string | null
  actorLabel: string
  action: string
  resourceType: string
  resourceId: string | null
  changes: unknown
  createdAt: string
}

function toDto(row: AuditEventRow): AuditEventDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    actorUserId: row.actorUserId,
    actorLabel: row.actorLabel,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    changes: row.changes ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Records an event, and never throws.
   *
   * An audit write that fails a payment is worse than a missing entry — the
   * money has moved either way, and refusing the action because the note
   * could not be filed helps nobody. A gap is therefore possible, which is
   * why the failure is logged loudly rather than swallowed quietly.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditEvents).values({
        organizationId: entry.organizationId,
        workspaceId: entry.workspaceId ?? null,
        actorUserId: entry.actor.userId,
        actorLabel: entry.actor.label,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        // Redacted here rather than at every call site, so a caller cannot
        // forget and put a token in the log.
        changes: entry.changes ? redact(entry.changes) : null,
        context: entry.context ? redact(entry.context) : null,
      })
    } catch (error) {
      this.logger.error(
        `AUDIT GAP — failed to record ${entry.action} on ${entry.resourceType}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async list(organizationId: string, query: AuditQuery) {
    const limit = cappedLimit(query.limit)
    const conditions: (SQL | undefined)[] = [eq(auditEvents.organizationId, organizationId)]

    if (query.action) conditions.push(eq(auditEvents.action, query.action))
    if (query.resourceType) conditions.push(eq(auditEvents.resourceType, query.resourceType))
    if (query.actorId) conditions.push(eq(auditEvents.actorUserId, query.actorId))
    if (query.from) conditions.push(gte(auditEvents.createdAt, new Date(query.from)))
    if (query.to) conditions.push(lte(auditEvents.createdAt, new Date(query.to)))
    if (query.cursor) conditions.push(sql`${auditEvents.id} > ${query.cursor}`)

    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(asc(auditEvents.id))
      .limit(limit + 1)

    return toPage(rows, limit, toDto)
  }

  /** Most recent first — what a person actually wants to see. */
  async recent(organizationId: string, limit = 20): Promise<AuditEventDto[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(cappedLimit(limit))

    return rows.map(toDto)
  }
}
