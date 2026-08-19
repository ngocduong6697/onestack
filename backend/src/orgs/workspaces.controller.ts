import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  createWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type Workspace,
} from '@onestack/shared'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { CurrentOrg, RequireRole, type OrgContext } from './current-org.decorator'
import { OrgGuard } from './org.guard'
import { OrgsService } from './orgs.service'

/**
 * Every route here takes the organization from the guard's context, never from
 * the body or from the workspace id, so a workspace belonging to another
 * tenant is simply not found.
 */
@Controller('orgs/:orgId/workspaces')
@UseGuards(SessionGuard, OrgGuard)
export class WorkspacesController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  list(@CurrentOrg() org: OrgContext): Promise<Workspace[]> {
    return this.orgs.listWorkspaces(org.organization.id)
  }

  @Post()
  @RequireRole('admin')
  create(
    @CurrentOrg() org: OrgContext,
    @Body(new ZodValidationPipe(createWorkspaceRequestSchema)) body: CreateWorkspaceRequest,
  ): Promise<Workspace> {
    return this.orgs.createWorkspace(org.organization.id, body)
  }

  @Patch(':workspaceId')
  @RequireRole('admin')
  update(
    @CurrentOrg() org: OrgContext,
    @Param('workspaceId') workspaceId: string,
    @Body(new ZodValidationPipe(updateWorkspaceRequestSchema)) body: UpdateWorkspaceRequest,
  ): Promise<Workspace> {
    return this.orgs.updateWorkspace(org.organization.id, workspaceId, body)
  }

  @Delete(':workspaceId')
  @RequireRole('admin')
  @HttpCode(204)
  remove(@CurrentOrg() org: OrgContext, @Param('workspaceId') workspaceId: string): Promise<void> {
    return this.orgs.deleteWorkspace(org.organization.id, workspaceId)
  }
}
