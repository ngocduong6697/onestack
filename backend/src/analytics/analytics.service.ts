import { Inject, Injectable } from '@nestjs/common'
import type {
  AnalyticsSummary,
  CreateLedgerEntryRequest,
  LedgerEntry,
  LedgerPage,
  ListLedgerQuery,
  Series,
  SeriesQuery,
} from '@onestack/shared'
import { and, asc, count, eq, gte, inArray, lte, sql, sum, type SQL } from 'drizzle-orm'
import { NotFoundError } from '../common/errors'
import { cappedLimit, toPage } from '../common/pagination'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import {
  aiRequests,
  customers,
  ledgerEntries,
  metricSnapshots,
  productPrices,
  subscriptions,
  type LedgerEntryRow,
  type MetricSnapshotRow,
} from '../database/schema'
import { calculateMrr, EARNING_STATUSES } from '../subscriptions/mrr'
import { profitOf, windowDays } from './metrics'

function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    entryDate: row.entryDate,
    kind: row.kind,
    category: row.category,
    amountMicroUsd: row.amountMicroUsd,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }
}

function today(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * MRR from the same rule the subscriptions summary uses — normalising a
   * yearly price to a twelfth, ignoring one-off prices — by calling the same
   * function rather than writing the rule out a second time.
   *
   * Reported in a single figure here because a dashboard needs one number;
   * where a workspace bills in more than one currency, this sums them, which
   * is noted as a limitation rather than hidden.
   */
  private async mrrMicroUsd(workspaceId: string): Promise<number> {
    const lines = await this.db
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

    // calculateMrr works in cents; the rest of analytics is micro-dollars.
    return calculateMrr(lines).reduce((total, line) => total + line.amountCents * 10_000, 0)
  }

  async summary(workspaceId: string, now = new Date()): Promise<AnalyticsSummary> {
    const monthStart = `${today(now).slice(0, 7)}-01`

    const [mrrMicroUsd, counts, aiCost, ledger] = await Promise.all([
      this.mrrMicroUsd(workspaceId),
      this.customerCounts(workspaceId),
      this.aiCostThisMonth(workspaceId, monthStart),
      this.ledgerTotals(workspaceId, monthStart, today(now)),
    ])

    const activeSubscriptions = await this.activeSubscriptionCount(workspaceId)

    // Revenue is recurring plus anything recorded as one-off this month.
    const revenueMicroUsd = mrrMicroUsd + ledger.revenue
    const profit = profitOf({
      revenueMicroUsd,
      aiCostMicroUsd: aiCost,
      recordedCostMicroUsd: ledger.cost,
    })

    return {
      mrrMicroUsd,
      customers: counts.total,
      activeCustomers: counts.active,
      activeSubscriptions,
      aiCostMicroUsd: aiCost,
      recordedCostMicroUsd: ledger.cost,
      recordedRevenueMicroUsd: ledger.revenue,
      ...profit,
    }
  }

  /** Straight from the snapshots — the whole reason they are written. */
  async series(workspaceId: string, query: SeriesQuery, now = new Date()): Promise<Series> {
    const dates = windowDays(query.days, now)
    const first = dates[0]!
    const last = dates.at(-1)!

    const rows = await this.db
      .select()
      .from(metricSnapshots)
      .where(
        and(
          eq(metricSnapshots.workspaceId, workspaceId),
          gte(metricSnapshots.capturedOn, first),
          lte(metricSnapshots.capturedOn, last),
        ),
      )
      .orderBy(asc(metricSnapshots.capturedOn))

    const byDate = new Map(rows.map((row) => [row.capturedOn, row]))

    // Only days that were captured appear. A day with no snapshot is a gap in
    // the record, and inventing a value for it would be a lie.
    const points = dates
      .filter((date) => byDate.has(date))
      .map((date) => ({ date, value: valueOf(byDate.get(date)!, query.metric) }))

    return { metric: query.metric, points }
  }

  /**
   * Captures today. Idempotent by the unique index on (workspace, day): a
   * second run corrects the row rather than adding one.
   */
  async snapshot(workspaceId: string, now = new Date()): Promise<MetricSnapshotRow> {
    const summary = await this.summary(workspaceId, now)
    const capturedOn = today(now)

    const [row] = await this.db
      .insert(metricSnapshots)
      .values({
        workspaceId,
        capturedOn,
        mrrMicroUsd: summary.mrrMicroUsd,
        customers: summary.customers,
        activeCustomers: summary.activeCustomers,
        activeSubscriptions: summary.activeSubscriptions,
        aiCostMicroUsd: summary.aiCostMicroUsd,
        recordedCostMicroUsd: summary.recordedCostMicroUsd,
        recordedRevenueMicroUsd: summary.recordedRevenueMicroUsd,
      })
      .onConflictDoUpdate({
        target: [metricSnapshots.workspaceId, metricSnapshots.capturedOn],
        set: {
          mrrMicroUsd: summary.mrrMicroUsd,
          customers: summary.customers,
          activeCustomers: summary.activeCustomers,
          activeSubscriptions: summary.activeSubscriptions,
          aiCostMicroUsd: summary.aiCostMicroUsd,
          recordedCostMicroUsd: summary.recordedCostMicroUsd,
          recordedRevenueMicroUsd: summary.recordedRevenueMicroUsd,
          updatedAt: new Date(),
        },
      })
      .returning()

    return row!
  }

  async addLedgerEntry(
    workspaceId: string,
    input: CreateLedgerEntryRequest,
    userId: string,
  ): Promise<LedgerEntry> {
    const [created] = await this.db
      .insert(ledgerEntries)
      .values({
        workspaceId,
        entryDate: input.entryDate,
        kind: input.kind,
        category: input.category,
        amountMicroUsd: input.amountMicroUsd,
        note: input.note ?? null,
        createdBy: userId,
      })
      .returning()

    return toLedgerEntry(created!)
  }

  async listLedger(workspaceId: string, query: ListLedgerQuery): Promise<LedgerPage> {
    const limit = cappedLimit(query.limit)
    const conditions: (SQL | undefined)[] = [eq(ledgerEntries.workspaceId, workspaceId)]

    if (query.from) conditions.push(gte(ledgerEntries.entryDate, query.from))
    if (query.to) conditions.push(lte(ledgerEntries.entryDate, query.to))
    if (query.kind) conditions.push(eq(ledgerEntries.kind, query.kind))
    if (query.cursor) conditions.push(sql`${ledgerEntries.id} > ${query.cursor}`)

    const rows = await this.db
      .select()
      .from(ledgerEntries)
      .where(and(...conditions))
      .orderBy(ledgerEntries.id)
      .limit(limit + 1)

    return toPage(rows, limit, toLedgerEntry)
  }

  /** Deletable, not editable: a reported figure should not be rewritten. */
  async deleteLedgerEntry(workspaceId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(ledgerEntries)
      .where(and(eq(ledgerEntries.id, id), eq(ledgerEntries.workspaceId, workspaceId)))
      .returning()

    if (deleted.length === 0) throw new NotFoundError('Ledger entry not found')
  }

  private async customerCounts(workspaceId: string): Promise<{ total: number; active: number }> {
    const rows = await this.db
      .select({ stage: customers.stage, total: count() })
      .from(customers)
      .where(eq(customers.workspaceId, workspaceId))
      .groupBy(customers.stage)

    const total = rows.reduce((running, row) => running + Number(row.total), 0)
    const active = rows
      .filter((row) => row.stage === 'active')
      .reduce((running, row) => running + Number(row.total), 0)

    return { total, active }
  }

  private async activeSubscriptionCount(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ total: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, workspaceId),
          inArray(subscriptions.status, EARNING_STATUSES),
        ),
      )

    return Number(rows[0]?.total ?? 0)
  }

  private async aiCostThisMonth(workspaceId: string, monthStart: string): Promise<number> {
    const rows = await this.db
      .select({ total: sum(aiRequests.costMicroUsd) })
      .from(aiRequests)
      .where(
        and(
          eq(aiRequests.workspaceId, workspaceId),
          gte(aiRequests.createdAt, new Date(`${monthStart}T00:00:00.000Z`)),
        ),
      )

    return Number(rows[0]?.total ?? 0)
  }

  private async ledgerTotals(
    workspaceId: string,
    from: string,
    to: string,
  ): Promise<{ cost: number; revenue: number }> {
    const rows = await this.db
      .select({ kind: ledgerEntries.kind, total: sum(ledgerEntries.amountMicroUsd) })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.workspaceId, workspaceId),
          gte(ledgerEntries.entryDate, from),
          lte(ledgerEntries.entryDate, to),
        ),
      )
      .groupBy(ledgerEntries.kind)

    const of = (kind: string) => Number(rows.find((row) => row.kind === kind)?.total ?? 0)

    return { cost: of('cost'), revenue: of('revenue') }
  }
}

function valueOf(row: MetricSnapshotRow, metric: SeriesQuery['metric']): number {
  switch (metric) {
    case 'mrr':
      return row.mrrMicroUsd
    case 'customers':
      return row.customers
    case 'activeSubscriptions':
      return row.activeSubscriptions
    case 'aiCost':
      return row.aiCostMicroUsd
    case 'grossProfit':
      return (
        row.mrrMicroUsd +
        row.recordedRevenueMicroUsd -
        row.aiCostMicroUsd -
        row.recordedCostMicroUsd
      )
  }
}
