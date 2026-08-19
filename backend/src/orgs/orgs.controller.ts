import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import {
  createOrganizationRequestSchema,
  updateOrganizationRequestSchema,
  type CreateOrganizationRequest,
  type MembershipSummary,
  type Organization,
  type PublicUser,
  type UpdateOrganizationRequest,
} from '@onestack/shared'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { CurrentOrg, RequireRole, type OrgContext } from './current-org.decorator'
import { OrgGuard } from './org.guard'
import { OrgsService } from './orgs.service'

@Controller('orgs')
@UseGuards(SessionGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post()
  create(
    // Scoped to the body deliberately: @UsePipes would also run @CurrentUser()
    // through this schema and hand the handler a stripped object.
    @Body(new ZodValidationPipe(createOrganizationRequestSchema)) body: CreateOrganizationRequest,
    @CurrentUser() user: PublicUser,
  ): Promise<Organization> {
    return this.orgs.create(body, user.id)
  }

  @Get()
  list(@CurrentUser() user: PublicUser): Promise<MembershipSummary[]> {
    return this.orgs.listForUser(user.id)
  }

  @Get(':orgId')
  @UseGuards(OrgGuard)
  get(@CurrentOrg() org: OrgContext): Organization {
    // The guard already loaded it; re-fetching would only add a query.
    return org.organization
  }

  @Patch(':orgId')
  @UseGuards(OrgGuard)
  @RequireRole('admin')
  update(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(updateOrganizationRequestSchema)) body: UpdateOrganizationRequest,
  ): Promise<Organization> {
    return this.orgs.update(orgId, body)
  }
}
