import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common'
import {
  createInvoiceRequestSchema,
  listInvoicesQuerySchema,
  recordPaymentRequestSchema,
  type CreateInvoiceRequest,
  type InvoiceDetail,
  type InvoicePage,
  type ListInvoicesQuery,
  type PublicUser,
  type RecordPaymentRequest,
  type SweepResult,
  type Workspace,
} from '@onestack/shared'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { CurrentOrg, RequirePermission, type OrgContext } from '../orgs/current-org.decorator'
import { CurrentWorkspace } from '../orgs/current-workspace.decorator'
import { OrgGuard } from '../orgs/org.guard'
import { WorkspaceGuard } from '../orgs/workspace.guard'
import { BillingService } from './billing.service'

@Controller('orgs/:orgId/workspaces/:workspaceId')
@UseGuards(SessionGuard, OrgGuard, WorkspaceGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('invoices')
  @RequirePermission('invoice:write')
  create(
    @CurrentWorkspace() workspace: Workspace,
    @Body(new ZodValidationPipe(createInvoiceRequestSchema)) body: CreateInvoiceRequest,
  ): Promise<InvoiceDetail> {
    return this.billing.createDraft(workspace.id, body)
  }

  @Get('invoices')
  @RequirePermission('invoice:read')
  list(
    @CurrentWorkspace() workspace: Workspace,
    @Query(new ZodValidationPipe(listInvoicesQuerySchema)) query: ListInvoicesQuery,
  ): Promise<InvoicePage> {
    return this.billing.list(workspace.id, query)
  }

  @Get('invoices/:invoiceId')
  @RequirePermission('invoice:read')
  get(
    @CurrentWorkspace() workspace: Workspace,
    @Param('invoiceId') invoiceId: string,
  ): Promise<InvoiceDetail> {
    return this.billing.detail(workspace.id, invoiceId)
  }

  @Post('invoices/:invoiceId/issue')
  @RequirePermission('invoice:write')
  @HttpCode(200)
  issue(
    @CurrentWorkspace() workspace: Workspace,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: PublicUser,
    @Param('invoiceId') invoiceId: string,
  ): Promise<InvoiceDetail> {
    return this.billing.issue(workspace.id, invoiceId, {
      userId: user.id,
      label: user.name,
      organizationId: org.organization.id,
    })
  }

  @Post('invoices/:invoiceId/pay')
  @RequirePermission('invoice:write')
  @HttpCode(200)
  pay(
    @CurrentWorkspace() workspace: Workspace,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: PublicUser,
    @Param('invoiceId') invoiceId: string,
    @Body(new ZodValidationPipe(recordPaymentRequestSchema)) body: RecordPaymentRequest,
  ): Promise<InvoiceDetail> {
    return this.billing.recordPayment(workspace.id, invoiceId, body, user.id, {
      label: user.name,
      organizationId: org.organization.id,
    })
  }

  @Post('invoices/:invoiceId/void')
  @RequirePermission('invoice:write')
  @HttpCode(200)
  void(
    @CurrentWorkspace() workspace: Workspace,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: PublicUser,
    @Param('invoiceId') invoiceId: string,
  ): Promise<InvoiceDetail> {
    return this.billing.void(workspace.id, invoiceId, {
      userId: user.id,
      label: user.name,
      organizationId: org.organization.id,
    })
  }

  @Post('billing/sweep')
  @RequirePermission('invoice:write')
  @HttpCode(200)
  sweep(@CurrentWorkspace() workspace: Workspace): Promise<SweepResult> {
    return this.billing.sweep(workspace.id)
  }
}
