import { Body, Controller, Get, UseGuards } from '@nestjs/common'
import {
  completionRequestSchema,
  type AiModelDto,
  type CompletionRequestBody,
  type CompletionResponse,
} from '@onestack/shared'
import { Post } from '@nestjs/common'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { RequirePermission } from '../orgs/current-org.decorator'
import { OrgGuard } from '../orgs/org.guard'
import { WorkspaceGuard } from '../orgs/workspace.guard'
import { AiService } from './ai.service'

/**
 * Workspace-scoped like everything else, so a prompt cannot cross a tenant
 * boundary and TASK-010 has a workspace to attribute the spend to.
 */
@Controller('orgs/:orgId/workspaces/:workspaceId/ai')
@UseGuards(SessionGuard, OrgGuard, WorkspaceGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('models')
  @RequirePermission('ai:read')
  models(): AiModelDto[] {
    return this.ai.listModels()
  }

  @Post('complete')
  @RequirePermission('ai:invoke')
  complete(
    @Body(new ZodValidationPipe(completionRequestSchema)) body: CompletionRequestBody,
  ): Promise<CompletionResponse> {
    return this.ai.complete(body)
  }
}
