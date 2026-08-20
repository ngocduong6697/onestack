import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  createWorkflowRequestSchema,
  updateWorkflowRequestSchema,
  type CreateWorkflowRequest,
  type PublicUser,
  type RunPage,
  type RunWithSteps,
  type UpdateWorkflowRequest,
  type Workflow,
  type Workspace,
} from '@onestack/shared'
import { z } from 'zod'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { RequirePermission } from '../orgs/current-org.decorator'
import { CurrentWorkspace } from '../orgs/current-workspace.decorator'
import { OrgGuard } from '../orgs/org.guard'
import { WorkspaceGuard } from '../orgs/workspace.guard'
import { WorkflowsService } from './workflows.service'

const runsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

@Controller('orgs/:orgId/workspaces/:workspaceId/workflows')
@UseGuards(SessionGuard, OrgGuard, WorkspaceGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Post()
  @RequirePermission('workflow:write')
  create(
    @CurrentWorkspace() workspace: Workspace,
    @Body(new ZodValidationPipe(createWorkflowRequestSchema)) body: CreateWorkflowRequest,
  ): Promise<Workflow> {
    return this.workflows.create(workspace.id, body)
  }

  @Get()
  @RequirePermission('workflow:read')
  list(@CurrentWorkspace() workspace: Workspace): Promise<Workflow[]> {
    return this.workflows.list(workspace.id)
  }

  /**
   * Before the `:workflowId` route: a run id is not a workflow id, and with
   * these the other way round every request here would look one up.
   */
  @Get('runs/:runId')
  @RequirePermission('workflow:read')
  run(
    @CurrentWorkspace() workspace: Workspace,
    @Param('runId') runId: string,
  ): Promise<RunWithSteps> {
    return this.workflows.getRun(workspace.id, runId)
  }

  @Get(':workflowId')
  @RequirePermission('workflow:read')
  get(
    @CurrentWorkspace() workspace: Workspace,
    @Param('workflowId') workflowId: string,
  ): Promise<Workflow> {
    return this.workflows.get(workspace.id, workflowId)
  }

  @Patch(':workflowId')
  @RequirePermission('workflow:write')
  update(
    @CurrentWorkspace() workspace: Workspace,
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(updateWorkflowRequestSchema)) body: UpdateWorkflowRequest,
  ): Promise<Workflow> {
    return this.workflows.update(workspace.id, workflowId, body)
  }

  @Delete(':workflowId')
  @RequirePermission('workflow:write')
  @HttpCode(204)
  remove(
    @CurrentWorkspace() workspace: Workspace,
    @Param('workflowId') workflowId: string,
  ): Promise<void> {
    return this.workflows.remove(workspace.id, workflowId)
  }

  @Post(':workflowId/run')
  @RequirePermission('workflow:run')
  runNow(
    @CurrentWorkspace() workspace: Workspace,
    @CurrentUser() user: PublicUser,
    @Param('workflowId') workflowId: string,
  ): Promise<RunWithSteps> {
    return this.workflows.runNow(workspace.id, workflowId, user.id)
  }

  @Get(':workflowId/runs')
  @RequirePermission('workflow:read')
  listRuns(
    @CurrentWorkspace() workspace: Workspace,
    @Param('workflowId') workflowId: string,
    @Query(new ZodValidationPipe(runsQuerySchema)) query: { cursor?: string; limit: number },
  ): Promise<RunPage> {
    return this.workflows.listRuns(workspace.id, workflowId, query.cursor, query.limit)
  }
}
