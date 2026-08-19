import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import type { PublicUser } from '@onestack/shared'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionGuard } from '../auth/session.guard'
import { InvitationsService } from './invitations.service'

/**
 * Outside /orgs/:orgId on purpose: the token is what names the organization,
 * and someone accepting an invitation is by definition not yet a member, so
 * OrgGuard would refuse them.
 */
@Controller('invites')
@UseGuards(SessionGuard)
export class AcceptInviteController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post(':token/accept')
  @HttpCode(200)
  accept(
    @Param('token') token: string,
    @CurrentUser() user: PublicUser,
  ): Promise<{ organizationId: string; role: string }> {
    return this.invitations.accept(token, user.id)
  }
}
