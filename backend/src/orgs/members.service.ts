import { Inject, Injectable } from '@nestjs/common'
import type { Member } from '@onestack/shared'
import { and, count, eq } from 'drizzle-orm'
import { ConflictError, ForbiddenError, NotFoundError } from '../common/errors'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { memberships, users } from '../database/schema'
import type { Role } from './roles'

@Injectable()
export class MembersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(organizationId: string): Promise<Member[]> {
    const rows = await this.db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, organizationId))

    return rows.map((row) => ({
      userId: row.user.id,
      email: row.user.email,
      name: row.user.name,
      role: row.membership.role,
      joinedAt: row.membership.createdAt.toISOString(),
    }))
  }

  /**
   * Changing somebody's role. Two rules beyond the permission check: an admin
   * may not act on an owner or mint one, and the last owner may not be demoted.
   */
  async updateRole(
    organizationId: string,
    targetUserId: string,
    role: Role,
    actor: { userId: string; role: Role },
  ): Promise<Member> {
    const target = await this.membership(organizationId, targetUserId)

    if (actor.role !== 'owner') {
      if (target.role === 'owner') {
        throw new ForbiddenError('Only an owner can change an owner')
      }
      if (role === 'owner') {
        throw new ForbiddenError('Only an owner can grant the owner role')
      }
    }

    if (target.role === 'owner' && role !== 'owner') {
      await this.assertNotLastOwner(organizationId, 'demote')
    }

    await this.db
      .update(memberships)
      .set({ role })
      .where(
        and(eq(memberships.organizationId, organizationId), eq(memberships.userId, targetUserId)),
      )

    const updated = await this.list(organizationId)

    return updated.find((member) => member.userId === targetUserId)!
  }

  /**
   * Removal, which is also how somebody leaves. A member may only remove
   * themselves; anything else needs the permission the guard already checked.
   */
  async remove(
    organizationId: string,
    targetUserId: string,
    actor: { userId: string; role: Role },
  ): Promise<void> {
    const target = await this.membership(organizationId, targetUserId)
    const isSelf = targetUserId === actor.userId

    if (!isSelf && actor.role !== 'owner' && target.role === 'owner') {
      throw new ForbiddenError('Only an owner can remove an owner')
    }

    if (target.role === 'owner') {
      // Applies to leaving too: an organization with no owner has nobody who
      // can appoint one.
      await this.assertNotLastOwner(organizationId, 'remove')
    }

    await this.db
      .delete(memberships)
      .where(
        and(eq(memberships.organizationId, organizationId), eq(memberships.userId, targetUserId)),
      )
  }

  /** Membership without the organization join — used by the invite flow. */
  async isMember(organizationId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
      .limit(1)

    return rows.length > 0
  }

  private async membership(organizationId: string, userId: string) {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
      .limit(1)

    const row = rows[0]

    if (!row) throw new NotFoundError('Member not found')

    return row
  }

  private async assertNotLastOwner(organizationId: string, action: string): Promise<void> {
    const rows = await this.db
      .select({ owners: count() })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, 'owner')))

    // Absent means zero owners, which must not read as "plenty".
    if ((rows[0]?.owners ?? 0) <= 1) {
      throw new ConflictError(`Cannot ${action} the last owner. Promote another owner first.`)
    }
  }
}
