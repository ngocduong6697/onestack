import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  createLedgerEntryRequestSchema,
  listLedgerQuerySchema,
  seriesQuerySchema,
  type AnalyticsSummary,
  type CreateLedgerEntryRequest,
  type LedgerEntry,
  type LedgerPage,
  type ListLedgerQuery,
  type PublicUser,
  type Series,
  type SeriesQuery,
  type Workspace,
} from '@onestack/shared'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { RequirePermission } from '../orgs/current-org.decorator'
import { CurrentWorkspace } from '../orgs/current-workspace.decorator'
import { OrgGuard } from '../orgs/org.guard'
import { WorkspaceGuard } from '../orgs/workspace.guard'
import { AnalyticsService } from './analytics.service'

@Controller('orgs/:orgId/workspaces/:workspaceId')
@UseGuards(SessionGuard, OrgGuard, WorkspaceGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('analytics/summary')
  @RequirePermission('analytics:read')
  summary(@CurrentWorkspace() workspace: Workspace): Promise<AnalyticsSummary> {
    return this.analytics.summary(workspace.id)
  }

  @Get('analytics/series')
  @RequirePermission('analytics:read')
  series(
    @CurrentWorkspace() workspace: Workspace,
    @Query(new ZodValidationPipe(seriesQuerySchema)) query: SeriesQuery,
  ): Promise<Series> {
    return this.analytics.series(workspace.id, query)
  }

  /** Idempotent within a day; also reachable from a scheduled workflow. */
  @Post('analytics/snapshot')
  @RequirePermission('analytics:write')
  @HttpCode(200)
  async snapshot(@CurrentWorkspace() workspace: Workspace): Promise<{ capturedOn: string }> {
    const row = await this.analytics.snapshot(workspace.id)

    return { capturedOn: row.capturedOn }
  }

  @Post('ledger')
  @RequirePermission('analytics:write')
  addEntry(
    @CurrentWorkspace() workspace: Workspace,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createLedgerEntryRequestSchema)) body: CreateLedgerEntryRequest,
  ): Promise<LedgerEntry> {
    return this.analytics.addLedgerEntry(workspace.id, body, user.id)
  }

  @Get('ledger')
  @RequirePermission('analytics:read')
  listEntries(
    @CurrentWorkspace() workspace: Workspace,
    @Query(new ZodValidationPipe(listLedgerQuerySchema)) query: ListLedgerQuery,
  ): Promise<LedgerPage> {
    return this.analytics.listLedger(workspace.id, query)
  }

  @Delete('ledger/:entryId')
  @RequirePermission('analytics:write')
  @HttpCode(204)
  deleteEntry(
    @CurrentWorkspace() workspace: Workspace,
    @Param('entryId') entryId: string,
  ): Promise<void> {
    return this.analytics.deleteLedgerEntry(workspace.id, entryId)
  }
}
