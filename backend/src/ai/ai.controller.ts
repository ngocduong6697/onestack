import { Body, Controller, Get, Query, UseGuards } from '@nestjs/common'
import {
  completionRequestSchema,
  listAiRequestsQuerySchema,
  usageQuerySchema,
  type AiModelDto,
  type AiRequestPage,
  type CompletionRequestBody,
  type CompletionResponse,
  type ListAiRequestsQuery,
  type PublicUser,
  type UsageQuery,
  type UsageSummary,
  type Workspace,
} from '@onestack/shared'
import { Post } from '@nestjs/common'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { RequirePermission } from '../orgs/current-org.decorator'
import { OrgGuard } from '../orgs/org.guard'
import { WorkspaceGuard } from '../orgs/workspace.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentWorkspace } from '../orgs/current-workspace.decorator'
import { AiService } from './ai.service'
import { AiUsageService } from './usage.service'

/**
 * Workspace-scoped like everything else, so a prompt cannot cross a tenant
 * boundary and TASK-010 has a workspace to attribute the spend to.
 */
@Controller('orgs/:orgId/workspaces/:workspaceId/ai')
@UseGuards(SessionGuard, OrgGuard, WorkspaceGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly usage: AiUsageService,
  ) {}

  @Get('models')
  @RequirePermission('ai:read')
  models(): AiModelDto[] {
    return this.ai.listModels()
  }

  @Post('complete')
  @RequirePermission('ai:invoke')
  complete(
    @CurrentWorkspace() workspace: Workspace,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(completionRequestSchema)) body: CompletionRequestBody,
  ): Promise<CompletionResponse> {
    return this.ai.complete(body, { workspaceId: workspace.id, userId: user.id })
  }

  @Get('usage')
  @RequirePermission('ai:read')
  usageSummary(
    @CurrentWorkspace() workspace: Workspace,
    @Query(new ZodValidationPipe(usageQuerySchema)) query: UsageQuery,
  ): Promise<UsageSummary> {
    return this.usage.summary(workspace.id, query)
  }

  @Get('requests')
  @RequirePermission('ai:read')
  requests(
    @CurrentWorkspace() workspace: Workspace,
    @Query(new ZodValidationPipe(listAiRequestsQuerySchema)) query: ListAiRequestsQuery,
  ): Promise<AiRequestPage> {
    return this.usage.list(workspace.id, query)
  }
}
