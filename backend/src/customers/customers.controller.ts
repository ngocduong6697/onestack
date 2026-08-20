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
  createCustomerRequestSchema,
  createNoteRequestSchema,
  listCustomersQuerySchema,
  updateCustomerRequestSchema,
  type CreateCustomerRequest,
  type CreateNoteRequest,
  type Customer,
  type CustomerNote,
  type CustomerPage,
  type ListCustomersQuery,
  type PublicUser,
  type UpdateCustomerRequest,
  type Workspace,
} from '@onestack/shared'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { CurrentOrg, RequirePermission, type OrgContext } from '../orgs/current-org.decorator'
import { CurrentWorkspace } from '../orgs/current-workspace.decorator'
import { OrgGuard } from '../orgs/org.guard'
import { WorkspaceGuard } from '../orgs/workspace.guard'
import { CustomersService } from './customers.service'

/**
 * Guard order matters: the session identifies the caller, OrgGuard admits them
 * to the organization, and only then does WorkspaceGuard prove the workspace
 * is inside it.
 */
@Controller('orgs/:orgId/workspaces/:workspaceId/customers')
@UseGuards(SessionGuard, OrgGuard, WorkspaceGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @RequirePermission('customer:write')
  create(
    @CurrentWorkspace() workspace: Workspace,
    @Body(new ZodValidationPipe(createCustomerRequestSchema)) body: CreateCustomerRequest,
  ): Promise<Customer> {
    return this.customers.create(workspace.id, body)
  }

  @Get()
  @RequirePermission('customer:read')
  list(
    @CurrentWorkspace() workspace: Workspace,
    @Query(new ZodValidationPipe(listCustomersQuerySchema)) query: ListCustomersQuery,
  ): Promise<CustomerPage> {
    return this.customers.list(workspace.id, query)
  }

  @Get(':customerId')
  @RequirePermission('customer:read')
  get(
    @CurrentWorkspace() workspace: Workspace,
    @Param('customerId') customerId: string,
  ): Promise<Customer> {
    return this.customers.get(workspace.id, customerId)
  }

  @Patch(':customerId')
  @RequirePermission('customer:write')
  update(
    @CurrentWorkspace() workspace: Workspace,
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(updateCustomerRequestSchema)) body: UpdateCustomerRequest,
  ): Promise<Customer> {
    return this.customers.update(workspace.id, customerId, body)
  }

  @Delete(':customerId')
  @RequirePermission('customer:write')
  @HttpCode(204)
  remove(
    @CurrentWorkspace() workspace: Workspace,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: PublicUser,
    @Param('customerId') customerId: string,
  ): Promise<void> {
    return this.customers.remove(workspace.id, customerId, {
      userId: user.id,
      label: user.name,
      organizationId: org.organization.id,
    })
  }

  @Post(':customerId/notes')
  @RequirePermission('customer:write')
  addNote(
    @CurrentWorkspace() workspace: Workspace,
    @CurrentUser() user: PublicUser,
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(createNoteRequestSchema)) body: CreateNoteRequest,
  ): Promise<CustomerNote> {
    return this.customers.addNote(workspace.id, customerId, user.id, body)
  }

  @Get(':customerId/notes')
  @RequirePermission('customer:read')
  listNotes(
    @CurrentWorkspace() workspace: Workspace,
    @Param('customerId') customerId: string,
  ): Promise<CustomerNote[]> {
    return this.customers.listNotes(workspace.id, customerId)
  }
}
