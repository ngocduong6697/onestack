import { Inject, Injectable } from '@nestjs/common'
import type {
  CreatePriceRequest,
  CreateProductRequest,
  ListProductsQuery,
  Product,
  ProductPage,
  ProductPrice,
  ProductWithPrices,
  UpdateProductRequest,
} from '@onestack/shared'
import { and, asc, desc, eq, gt, ilike, or, sql, type SQL } from 'drizzle-orm'
import { ConflictError, NotFoundError } from '../common/errors'
import { cappedLimit, toPage } from '../common/pagination'
import { isUniqueViolation } from '../common/postgres-errors'
import { containsPattern } from '../customers/search'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { productPrices, products, type ProductPriceRow, type ProductRow } from '../database/schema'

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    sku: row.sku,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toPrice(row: ProductPriceRow): ProductPrice {
  return {
    id: row.id,
    productId: row.productId,
    amountCents: row.amountCents,
    currency: row.currency,
    interval: row.interval,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class ProductsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(workspaceId: string, input: CreateProductRequest): Promise<Product> {
    try {
      const [created] = await this.db
        .insert(products)
        .values({
          workspaceId,
          name: input.name,
          sku: input.sku ?? null,
          description: input.description ?? null,
        })
        .returning()

      return toProduct(created!)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A product with that SKU already exists in this workspace')
      }
      throw error
    }
  }

  /** Keyset pagination, identical in shape to customers. */
  async list(workspaceId: string, query: ListProductsQuery): Promise<ProductPage> {
    const limit = cappedLimit(query.limit)
    const conditions: (SQL | undefined)[] = [eq(products.workspaceId, workspaceId)]

    if (query.status) conditions.push(eq(products.status, query.status))

    if (query.q) {
      const pattern = containsPattern(query.q)

      conditions.push(
        or(
          ilike(products.name, pattern),
          ilike(products.sku, pattern),
          ilike(products.description, pattern),
        ),
      )
    }

    if (query.cursor) conditions.push(gt(products.id, query.cursor))

    const rows = await this.db
      .select()
      .from(products)
      .where(and(...conditions))
      .orderBy(products.id)
      .limit(limit + 1)

    return toPage(rows, limit, toProduct)
  }

  /** The only view that embeds prices — the list deliberately does not. */
  async get(workspaceId: string, productId: string): Promise<ProductWithPrices> {
    const product = await this.row(workspaceId, productId)
    const prices = await this.db
      .select()
      .from(productPrices)
      .where(eq(productPrices.productId, productId))
      .orderBy(desc(productPrices.id))

    return { ...toProduct(product), prices: prices.map(toPrice) }
  }

  async update(
    workspaceId: string,
    productId: string,
    input: UpdateProductRequest,
  ): Promise<Product> {
    await this.row(workspaceId, productId)

    try {
      const [updated] = await this.db
        .update(products)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.sku !== undefined ? { sku: input.sku ?? null } : {}),
          ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        })
        .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
        .returning()

      return toProduct(updated!)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A product with that SKU already exists in this workspace')
      }
      throw error
    }
  }

  /**
   * Only while nothing has been priced. Once a price exists the product may
   * have been sold, and deleting it would leave TASK-008's subscriptions
   * pointing at nothing.
   */
  async remove(workspaceId: string, productId: string): Promise<void> {
    await this.row(workspaceId, productId)

    const prices = await this.db
      .select({ id: productPrices.id })
      .from(productPrices)
      .where(eq(productPrices.productId, productId))
      .limit(1)

    if (prices.length > 0) {
      throw new ConflictError('This product has prices and cannot be deleted. Archive it instead.')
    }

    await this.db
      .delete(products)
      .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
  }

  /**
   * Idempotent, and deliberately does not touch the prices: they must stay
   * readable so a historic subscription still resolves to what was agreed.
   */
  async setStatus(
    workspaceId: string,
    productId: string,
    status: 'active' | 'archived',
  ): Promise<Product> {
    await this.row(workspaceId, productId)

    const [updated] = await this.db
      .update(products)
      .set({ status })
      .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
      .returning()

    return toProduct(updated!)
  }

  async addPrice(
    workspaceId: string,
    productId: string,
    input: CreatePriceRequest,
  ): Promise<ProductPrice> {
    await this.row(workspaceId, productId)

    const [created] = await this.db
      .insert(productPrices)
      .values({
        productId,
        amountCents: input.amountCents,
        currency: input.currency,
        interval: input.interval,
      })
      .returning()

    return toPrice(created!)
  }

  async listPrices(
    workspaceId: string,
    productId: string,
    activeOnly?: boolean,
  ): Promise<ProductPrice[]> {
    await this.row(workspaceId, productId)

    const conditions: (SQL | undefined)[] = [eq(productPrices.productId, productId)]

    if (activeOnly !== undefined) conditions.push(eq(productPrices.active, activeOnly))

    const rows = await this.db
      .select()
      .from(productPrices)
      .where(and(...conditions))
      .orderBy(asc(productPrices.id))

    return rows.map(toPrice)
  }

  /**
   * The only mutation a price ever receives, and only in one direction. There
   * is no route to change an amount: raising a price means adding a new one.
   */
  async archivePrice(
    workspaceId: string,
    productId: string,
    priceId: string,
  ): Promise<ProductPrice> {
    await this.row(workspaceId, productId)

    const [updated] = await this.db
      .update(productPrices)
      .set({ active: false })
      .where(and(eq(productPrices.id, priceId), eq(productPrices.productId, productId)))
      .returning()

    if (!updated) throw new NotFoundError('Price not found')

    return toPrice(updated)
  }

  /** Every read filters on the workspace, never on the id alone. */
  private async row(workspaceId: string, productId: string): Promise<ProductRow> {
    const rows = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
      .limit(1)

    const row = rows[0]

    if (!row) throw new NotFoundError('Product not found')

    return row
  }
}
