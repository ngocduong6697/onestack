import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import {
  createInviteRequestSchema,
  type CreateInviteRequest,
  type CreatedInvitation,
  type Invitation,
  type PublicUser,
} from '@onestack/shared'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { CurrentOrg, RequirePermission, type OrgContext } from './current-org.decorator'
import { InvitationsService } from './invitations.service'
import { OrgGuard } from './org.guard'

@Controller('orgs/:orgId/invites')
@UseGuards(SessionGuard, OrgGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @RequirePermission('invite:create')
  create(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createInviteRequestSchema)) body: CreateInviteRequest,
  ): Promise<CreatedInvitation> {
    return this.invitations.create(org.organization.id, body, {
      userId: user.id,
      role: org.role,
      label: user.name,
    })
  }

  @Get()
  @RequirePermission('invite:read')
  list(@CurrentOrg() org: OrgContext): Promise<Invitation[]> {
    return this.invitations.list(org.organization.id)
  }

  @Delete(':invitationId')
  @RequirePermission('invite:revoke')
  @HttpCode(204)
  revoke(
    @CurrentOrg() org: OrgContext,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    return this.invitations.revoke(org.organization.id, invitationId)
  }
}
