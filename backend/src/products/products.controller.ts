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
  createPriceRequestSchema,
  createProductRequestSchema,
  listProductsQuerySchema,
  updateProductRequestSchema,
  type CreatePriceRequest,
  type CreateProductRequest,
  type ListProductsQuery,
  type Product,
  type ProductPage,
  type ProductPrice,
  type ProductWithPrices,
  type UpdateProductRequest,
  type Workspace,
} from '@onestack/shared'
import { z } from 'zod'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { RequirePermission } from '../orgs/current-org.decorator'
import { CurrentWorkspace } from '../orgs/current-workspace.decorator'
import { OrgGuard } from '../orgs/org.guard'
import { WorkspaceGuard } from '../orgs/workspace.guard'
import { ProductsService } from './products.service'

const listPricesQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
})

@Controller('orgs/:orgId/workspaces/:workspaceId/products')
@UseGuards(SessionGuard, OrgGuard, WorkspaceGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @RequirePermission('product:write')
  create(
    @CurrentWorkspace() workspace: Workspace,
    @Body(new ZodValidationPipe(createProductRequestSchema)) body: CreateProductRequest,
  ): Promise<Product> {
    return this.products.create(workspace.id, body)
  }

  @Get()
  @RequirePermission('product:read')
  list(
    @CurrentWorkspace() workspace: Workspace,
    @Query(new ZodValidationPipe(listProductsQuerySchema)) query: ListProductsQuery,
  ): Promise<ProductPage> {
    return this.products.list(workspace.id, query)
  }

  @Get(':productId')
  @RequirePermission('product:read')
  get(
    @CurrentWorkspace() workspace: Workspace,
    @Param('productId') productId: string,
  ): Promise<ProductWithPrices> {
    return this.products.get(workspace.id, productId)
  }

  /**
   * Name, SKU and description only. There is deliberately no path from here to
   * a price's amount — that is what immutability means in practice.
   */
  @Patch(':productId')
  @RequirePermission('product:write')
  update(
    @CurrentWorkspace() workspace: Workspace,
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(updateProductRequestSchema)) body: UpdateProductRequest,
  ): Promise<Product> {
    return this.products.update(workspace.id, productId, body)
  }

  @Delete(':productId')
  @RequirePermission('product:write')
  @HttpCode(204)
  remove(
    @CurrentWorkspace() workspace: Workspace,
    @Param('productId') productId: string,
  ): Promise<void> {
    return this.products.remove(workspace.id, productId)
  }

  @Post(':productId/archive')
  @RequirePermission('product:write')
  archive(
    @CurrentWorkspace() workspace: Workspace,
    @Param('productId') productId: string,
  ): Promise<Product> {
    return this.products.setStatus(workspace.id, productId, 'archived')
  }

  @Post(':productId/unarchive')
  @RequirePermission('product:write')
  unarchive(
    @CurrentWorkspace() workspace: Workspace,
    @Param('productId') productId: string,
  ): Promise<Product> {
    return this.products.setStatus(workspace.id, productId, 'active')
  }

  @Post(':productId/prices')
  @RequirePermission('product:write')
  addPrice(
    @CurrentWorkspace() workspace: Workspace,
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(createPriceRequestSchema)) body: CreatePriceRequest,
  ): Promise<ProductPrice> {
    return this.products.addPrice(workspace.id, productId, body)
  }

  @Get(':productId/prices')
  @RequirePermission('product:read')
  listPrices(
    @CurrentWorkspace() workspace: Workspace,
    @Param('productId') productId: string,
    @Query(new ZodValidationPipe(listPricesQuerySchema)) query: { active?: boolean },
  ): Promise<ProductPrice[]> {
    return this.products.listPrices(workspace.id, productId, query.active)
  }

  @Post(':productId/prices/:priceId/archive')
  @RequirePermission('product:write')
  archivePrice(
    @CurrentWorkspace() workspace: Workspace,
    @Param('productId') productId: string,
    @Param('priceId') priceId: string,
  ): Promise<ProductPrice> {
    return this.products.archivePrice(workspace.id, productId, priceId)
  }
}
