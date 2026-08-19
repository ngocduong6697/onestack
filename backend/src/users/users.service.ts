import { Inject, Injectable } from '@nestjs/common'
import type { ChangePasswordRequest, PublicUser, UpdateProfileRequest } from '@onestack/shared'
import { and, eq, ne } from 'drizzle-orm'
import { hashPassword, verifyPassword } from '../auth/password'
import { toPublicUser } from '../auth/auth.service'
import { hashSessionToken } from '../auth/tokens'
import { NotFoundError, UnauthorizedError } from '../common/errors'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { sessions, users } from '../database/schema'

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async updateProfile(userId: string, input: UpdateProfileRequest): Promise<PublicUser> {
    const [updated] = await this.db
      .update(users)
      .set({ name: input.name })
      .where(eq(users.id, userId))
      .returning()

    if (!updated) throw new NotFoundError('User not found')

    return toPublicUser(updated)
  }

  /**
   * Requires the current password, so a stolen session cannot lock the owner
   * out, and revokes every other session, which is the actual remedy once one
   * has been stolen. The caller's own session survives — logging somebody out
   * of the request they are making is not security, it is an annoyance.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordRequest,
    currentToken: string,
  ): Promise<void> {
    const rows = await this.db.select().from(users).where(eq(users.id, userId)).limit(1)
    const user = rows[0]

    if (!user) throw new NotFoundError('User not found')

    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new UnauthorizedError('Current password is incorrect')
    }

    const passwordHash = await hashPassword(input.newPassword)

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId))

      await tx
        .delete(sessions)
        .where(
          and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashSessionToken(currentToken))),
        )
    })
  }
}
