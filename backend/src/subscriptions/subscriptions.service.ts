import { Inject, Injectable } from '@nestjs/common'
import type {
  CreateSubscriptionRequest,
  ListSubscriptionsQuery,
  Subscription,
  SubscriptionPage,
  SubscriptionSummary,
} from '@onestack/shared'
import { and, count, eq, gt, inArray, type SQL } from 'drizzle-orm'
import { ConflictError, NotFoundError } from '../common/errors'
import { cappedLimit, toPage } from '../common/pagination'
import { isUniqueViolation } from '../common/postgres-errors'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import {
  customers,
  productPrices,
  products,
  subscriptions,
  type ProductPriceRow,
  type SubscriptionRow,
} from '../database/schema'
import { calculateMrr, EARNING_STATUSES } from './mrr'
import { initialPeriod, nextPeriodEnd } from './periods'

const DAY_MS = 24 * 60 * 60 * 1000

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    customerId: row.customerId,
    priceId: row.priceId,
    status: row.status,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class SubscriptionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(workspaceId: string, input: CreateSubscriptionRequest): Promise<Subscription> {
    // Both sides are re-checked against this workspace, so an id from another
    // tenant is not found rather than a foreign key error.
    await this.customerIn(workspaceId, input.customerId)
    const price = await this.priceIn(workspaceId, input.priceId)

    const now = new Date()
    const period = initialPeriod(now, price.interval)

    try {
      const [created] = await this.db
        .insert(subscriptions)
        .values({
          workspaceId,
          customerId: input.customerId,
          priceId: input.priceId,
          status: input.trialDays ? 'trialing' : 'active',
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          trialEndsAt: input.trialDays ? new Date(now.getTime() + input.trialDays * DAY_MS) : null,
        })
        .returning()

      return toSubscription(created!)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('That customer already has a live subscription to this price')
      }
      throw error
    }
  }

  async list(workspaceId: string, query: ListSubscriptionsQuery): Promise<SubscriptionPage> {
    const limit = cappedLimit(query.limit)
    const conditions: (SQL | undefined)[] = [eq(subscriptions.workspaceId, workspaceId)]

    if (query.status) conditions.push(eq(subscriptions.status, query.status))
    if (query.customerId) conditions.push(eq(subscriptions.customerId, query.customerId))
    if (query.cursor) conditions.push(gt(subscriptions.id, query.cursor))

    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(and(...conditions))
      .orderBy(subscriptions.id)
      .limit(limit + 1)

    return toPage(rows, limit, toSubscription)
  }

  async get(workspaceId: string, id: string): Promise<Subscription> {
    return toSubscription(await this.row(workspaceId, id))
  }

  /**
   * Changes what the customer pays from now on. Nothing is recalculated
   * backwards — the money already moved for this period is TASK-013's
   * business, and pretending otherwise here would be a guess.
   */
  async changePrice(workspaceId: string, id: string, priceId: string): Promise<Subscription> {
    const existing = await this.row(workspaceId, id)

    if (existing.status === 'canceled') {
      throw new ConflictError('A canceled subscription cannot change price')
    }

    await this.priceIn(workspaceId, priceId)

    try {
      const [updated] = await this.db
        .update(subscriptions)
        .set({ priceId })
        .where(and(eq(subscriptions.id, id), eq(subscriptions.workspaceId, workspaceId)))
        .returning()

      return toSubscription(updated!)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('That customer already has a live subscription to this price')
      }
      throw error
    }
  }

  async cancel(workspaceId: string, id: string, immediately: boolean): Promise<Subscription> {
    const existing = await this.row(workspaceId, id)

    if (existing.status === 'canceled') {
      throw new ConflictError('This subscription is already canceled')
    }

    const now = new Date()

    const [updated] = await this.db
      .update(subscriptions)
      .set(
        immediately
          ? { status: 'canceled', canceledAt: now, endedAt: now, cancelAtPeriodEnd: false }
          : // Status stays as it was: they keep what they paid for until the
            // period runs out, and may still change their mind.
            { cancelAtPeriodEnd: true, canceledAt: now },
      )
      .where(and(eq(subscriptions.id, id), eq(subscriptions.workspaceId, workspaceId)))
      .returning()

    return toSubscription(updated!)
  }

  async resume(workspaceId: string, id: string): Promise<Subscription> {
    const existing = await this.row(workspaceId, id)

    if (existing.status === 'canceled') {
      throw new ConflictError('This subscription has already ended and cannot be resumed')
    }

    if (!existing.cancelAtPeriodEnd) {
      throw new ConflictError('This subscription is not scheduled to cancel')
    }

    const [updated] = await this.db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: false, canceledAt: null })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.workspaceId, workspaceId)))
      .returning()

    return toSubscription(updated!)
  }

  /**
   * Advances the period by one interval. TASK-011 will call this on a
   * schedule; it is an endpoint rather than a timer so that it can be tested
   * and replayed deliberately.
   */
  async renew(workspaceId: string, id: string): Promise<Subscription> {
    const existing = await this.row(workspaceId, id)

    if (existing.status === 'canceled') {
      throw new ConflictError('A canceled subscription cannot be renewed')
    }

    if (!existing.currentPeriodEnd) {
      throw new ConflictError('A one-off subscription has no period to renew')
    }

    const now = new Date()

    // A renewal is also where a scheduled cancellation takes effect. Extending
    // a subscription somebody asked to end would be the wrong answer.
    if (existing.cancelAtPeriodEnd) {
      const [ended] = await this.db
        .update(subscriptions)
        .set({ status: 'canceled', endedAt: now, canceledAt: existing.canceledAt ?? now })
        .where(and(eq(subscriptions.id, id), eq(subscriptions.workspaceId, workspaceId)))
        .returning()

      return toSubscription(ended!)
    }

    const price = await this.priceRow(existing.priceId)

    // From the previous end, not from now: a late renewal must not shorten the
    // period the customer paid for.
    const start = existing.currentPeriodEnd
    const end = nextPeriodEnd(start, price.interval)

    const [renewed] = await this.db
      .update(subscriptions)
      .set({
        currentPeriodStart: start,
        currentPeriodEnd: end,
        // A trial that has been renewed through is over.
        status: existing.status === 'trialing' ? 'active' : existing.status,
      })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.workspaceId, workspaceId)))
      .returning()

    return toSubscription(renewed!)
  }

  async summary(workspaceId: string): Promise<SubscriptionSummary> {
    const earning = await this.db
      .select({
        amountCents: productPrices.amountCents,
        currency: productPrices.currency,
        interval: productPrices.interval,
      })
      .from(subscriptions)
      .innerJoin(productPrices, eq(productPrices.id, subscriptions.priceId))
      .where(
        and(
          eq(subscriptions.workspaceId, workspaceId),
          inArray(subscriptions.status, EARNING_STATUSES),
        ),
      )

    const grouped = await this.db
      .select({ status: subscriptions.status, total: count() })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .groupBy(subscriptions.status)

    const countsByStatus = Object.fromEntries(
      grouped.map((row) => [row.status, row.total]),
    ) as SubscriptionSummary['countsByStatus']

    return {
      mrr: calculateMrr(earning),
      countsByStatus,
      activeCount: countsByStatus.active ?? 0,
    }
  }

  private async row(workspaceId: string, id: string): Promise<SubscriptionRow> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.workspaceId, workspaceId)))
      .limit(1)

    const row = rows[0]

    if (!row) throw new NotFoundError('Subscription not found')

    return row
  }

  private async customerIn(workspaceId: string, customerId: string): Promise<void> {
    const rows = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.workspaceId, workspaceId)))
      .limit(1)

    if (rows.length === 0) throw new NotFoundError('Customer not found')
  }

  /** A price is reached through its product, which is what carries the workspace. */
  private async priceIn(workspaceId: string, priceId: string): Promise<ProductPriceRow> {
    const rows = await this.db
      .select({ price: productPrices })
      .from(productPrices)
      .innerJoin(products, eq(products.id, productPrices.productId))
      .where(and(eq(productPrices.id, priceId), eq(products.workspaceId, workspaceId)))
      .limit(1)

    const row = rows[0]

    if (!row) throw new NotFoundError('Price not found')

    return row.price
  }

  private async priceRow(priceId: string): Promise<ProductPriceRow> {
    const rows = await this.db
      .select()
      .from(productPrices)
      .where(eq(productPrices.id, priceId))
      .limit(1)

    const row = rows[0]

    // The restrict foreign key makes this unreachable, which is the point.
    if (!row) throw new NotFoundError('Price not found')

    return row
  }
}
