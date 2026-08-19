import { Inject, Injectable } from '@nestjs/common'
import type { CreateInviteRequest, CreatedInvitation, Invitation } from '@onestack/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { createSessionToken, hashSessionToken } from '../auth/tokens'
import { ConflictError, ForbiddenError, NotFoundError } from '../common/errors'
import { isUniqueViolation } from '../common/postgres-errors'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { invitations, memberships, type InvitationRow } from '../database/schema'
import { MembersService } from './members.service'
import type { Role } from './roles'

/** Long enough to hand over by another channel, short enough to matter. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function toInvitation(row: InvitationRow): Invitation {
  // Field by field, so token_hash cannot travel by being part of the row.
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly members: MembersService,
  ) {}

  /** The only moment the token exists in readable form. */
  async create(
    organizationId: string,
    input: CreateInviteRequest,
    actor: { userId: string; role: Role },
  ): Promise<CreatedInvitation> {
    if (input.role === 'owner' && actor.role !== 'owner') {
      throw new ForbiddenError('Only an owner can invite an owner')
    }

    const token = createSessionToken()

    let created: InvitationRow

    try {
      const rows = await this.db
        .insert(invitations)
        .values({
          organizationId,
          email: input.email,
          role: input.role,
          tokenHash: hashSessionToken(token),
          invitedBy: actor.userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning()

      created = rows[0]!
    } catch (error) {
      // The partial unique index is the authority on "already invited".
      if (isUniqueViolation(error)) {
        throw new ConflictError('That address already has an open invitation')
      }
      throw error
    }

    return { ...toInvitation(created), token }
  }

  /** Open invitations only. Never tokens — a readable token is a password. */
  async list(organizationId: string): Promise<Invitation[]> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.organizationId, organizationId), isNull(invitations.acceptedAt)))

    return rows.map(toInvitation)
  }

  async revoke(organizationId: string, invitationId: string): Promise<void> {
    const deleted = await this.db
      .delete(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.organizationId, organizationId),
          isNull(invitations.acceptedAt),
        ),
      )
      .returning()

    if (deleted.length === 0) throw new NotFoundError('Invitation not found')
  }

  /**
   * Accepting binds the invitation to whoever holds the token and is logged
   * in — not to the address it names. The address is a label for the person
   * who sent it; the token is the credential.
   */
  async accept(token: string, userId: string): Promise<{ organizationId: string; role: Role }> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashSessionToken(token)))
      .limit(1)

    const invitation = rows[0]

    // Unknown, already used and expired are all "not found": a token that
    // does not work should not explain itself.
    if (!invitation) throw new NotFoundError('Invitation not found')
    if (invitation.acceptedAt) throw new NotFoundError('Invitation not found')
    if (invitation.expiresAt.getTime() <= Date.now())
      throw new NotFoundError('Invitation not found')

    if (await this.members.isMember(invitation.organizationId, userId)) {
      throw new ConflictError('You are already a member of this organization')
    }

    await this.db.transaction(async (tx) => {
      await tx.insert(memberships).values({
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
      })

      // Marking it used inside the same transaction is what makes it
      // single-use rather than single-use-most-of-the-time.
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id))
    })

    return { organizationId: invitation.organizationId, role: invitation.role }
  }
}
