import { Body, Controller, Delete, Get, HttpCode, Param, Patch, UseGuards } from '@nestjs/common'
import {
  updateMemberRequestSchema,
  type Member,
  type PublicUser,
  type UpdateMemberRequest,
} from '@onestack/shared'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { ForbiddenError } from '../common/errors'
import { CurrentOrg, RequirePermission, type OrgContext } from './current-org.decorator'
import { can } from './permissions'
import { MembersService } from './members.service'
import { OrgGuard } from './org.guard'

@Controller('orgs/:orgId/members')
@UseGuards(SessionGuard, OrgGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('member:read')
  list(@CurrentOrg() org: OrgContext): Promise<Member[]> {
    return this.members.list(org.organization.id)
  }

  @Patch(':userId')
  @RequirePermission('member:update')
  update(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: PublicUser,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(updateMemberRequestSchema)) body: UpdateMemberRequest,
  ): Promise<Member> {
    return this.members.updateRole(org.organization.id, userId, body.role, {
      userId: user.id,
      role: org.role,
      label: user.name,
    })
  }

  /**
   * Removal and leaving are the same operation. The permission covers removing
   * somebody else; the service allows a member to remove only themselves.
   */
  @Delete(':userId')
  @HttpCode(204)
  remove(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: PublicUser,
    @Param('userId') userId: string,
  ): Promise<void> {
    if (userId !== user.id && !can(org.role, 'member:remove')) {
      throw new ForbiddenError('This action requires the member:remove permission')
    }

    return this.members.remove(org.organization.id, userId, {
      userId: user.id,
      role: org.role,
      label: user.name,
    })
  }
}
