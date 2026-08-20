import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import {
  cancelSubscriptionRequestSchema,
  changePriceRequestSchema,
  createSubscriptionRequestSchema,
  listSubscriptionsQuerySchema,
  type CancelSubscriptionRequest,
  type ChangePriceRequest,
  type CreateSubscriptionRequest,
  type ListSubscriptionsQuery,
  type Subscription,
  type SubscriptionPage,
  type SubscriptionSummary,
  type Workspace,
} from '@onestack/shared'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { RequirePermission } from '../orgs/current-org.decorator'
import { CurrentWorkspace } from '../orgs/current-workspace.decorator'
import { OrgGuard } from '../orgs/org.guard'
import { WorkspaceGuard } from '../orgs/workspace.guard'
import { SubscriptionsService } from './subscriptions.service'

@Controller('orgs/:orgId/workspaces/:workspaceId/subscriptions')
@UseGuards(SessionGuard, OrgGuard, WorkspaceGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @RequirePermission('subscription:write')
  create(
    @CurrentWorkspace() workspace: Workspace,
    @Body(new ZodValidationPipe(createSubscriptionRequestSchema)) body: CreateSubscriptionRequest,
  ): Promise<Subscription> {
    return this.subscriptions.create(workspace.id, body)
  }

  @Get()
  @RequirePermission('subscription:read')
  list(
    @CurrentWorkspace() workspace: Workspace,
    @Query(new ZodValidationPipe(listSubscriptionsQuerySchema)) query: ListSubscriptionsQuery,
  ): Promise<SubscriptionPage> {
    return this.subscriptions.list(workspace.id, query)
  }

  /**
   * Declared before the `:id` route deliberately. Nest matches in declaration
   * order, so with these the other way round every request for the summary
   * would look up a subscription whose id is the word "summary".
   */
  @Get('summary')
  @RequirePermission('subscription:read')
  summary(@CurrentWorkspace() workspace: Workspace): Promise<SubscriptionSummary> {
    return this.subscriptions.summary(workspace.id)
  }

  @Get(':subscriptionId')
  @RequirePermission('subscription:read')
  get(
    @CurrentWorkspace() workspace: Workspace,
    @Param('subscriptionId') subscriptionId: string,
  ): Promise<Subscription> {
    return this.subscriptions.get(workspace.id, subscriptionId)
  }

  @Patch(':subscriptionId')
  @RequirePermission('subscription:write')
  changePrice(
    @CurrentWorkspace() workspace: Workspace,
    @Param('subscriptionId') subscriptionId: string,
    @Body(new ZodValidationPipe(changePriceRequestSchema)) body: ChangePriceRequest,
  ): Promise<Subscription> {
    return this.subscriptions.changePrice(workspace.id, subscriptionId, body.priceId)
  }

  @Post(':subscriptionId/cancel')
  @RequirePermission('subscription:write')
  cancel(
    @CurrentWorkspace() workspace: Workspace,
    @Param('subscriptionId') subscriptionId: string,
    @Body(new ZodValidationPipe(cancelSubscriptionRequestSchema)) body: CancelSubscriptionRequest,
  ): Promise<Subscription> {
    return this.subscriptions.cancel(workspace.id, subscriptionId, body.immediately)
  }

  @Post(':subscriptionId/resume')
  @RequirePermission('subscription:write')
  resume(
    @CurrentWorkspace() workspace: Workspace,
    @Param('subscriptionId') subscriptionId: string,
  ): Promise<Subscription> {
    return this.subscriptions.resume(workspace.id, subscriptionId)
  }

  @Post(':subscriptionId/renew')
  @RequirePermission('subscription:write')
  renew(
    @CurrentWorkspace() workspace: Workspace,
    @Param('subscriptionId') subscriptionId: string,
  ): Promise<Subscription> {
    return this.subscriptions.renew(workspace.id, subscriptionId)
  }
}
