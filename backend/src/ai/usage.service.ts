import { Inject, Injectable, Logger } from '@nestjs/common'
import type {
  AiRequestDto,
  AiRequestPage,
  ListAiRequestsQuery,
  UsageQuery,
  UsageSummary,
} from '@onestack/shared'
import { and, count, desc, eq, gte, lte, sql, sum, type SQL } from 'drizzle-orm'
import { cappedLimit, toPage } from '../common/pagination'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { aiRequests, type AiRequestRow } from '../database/schema'
import type { TokenUsage } from './cost'

const MICRO_USD_PER_CENT = 10_000

/** Everything one row needs, assembled by the caller around the vendor call. */
export interface UsageRecord {
  workspaceId: string
  userId: string | null
  provider: string
  model: string
  status: 'succeeded' | 'failed'
  usage: TokenUsage
  costMicroUsd: number
  durationMs: number
  errorCode?: string
  stopReason?: string
}

function toDto(row: AiRequestRow): AiRequestDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    provider: row.provider,
    model: row.model,
    status: row.status,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    costMicroUsd: row.costMicroUsd,
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    stopReason: row.stopReason,
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name)

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Writes the record, and never throws.
   *
   * The answer has already been generated and paid for by the time this runs.
   * Losing it because bookkeeping failed would be the worse of the two
   * outcomes, so a failure here is logged loudly and swallowed.
   */
  async record(entry: UsageRecord): Promise<void> {
    try {
      await this.db.insert(aiRequests).values({
        workspaceId: entry.workspaceId,
        userId: entry.userId,
        provider: entry.provider,
        model: entry.model,
        status: entry.status,
        inputTokens: entry.usage.inputTokens,
        outputTokens: entry.usage.outputTokens,
        cacheReadTokens: entry.usage.cacheReadTokens ?? 0,
        cacheWriteTokens: entry.usage.cacheWriteTokens ?? 0,
        costMicroUsd: entry.costMicroUsd,
        durationMs: entry.durationMs,
        errorCode: entry.errorCode ?? null,
        stopReason: entry.stopReason ?? null,
      })
    } catch (error) {
      this.logger.error(
        `Failed to record AI usage for ${entry.provider}/${entry.model}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Totals straight from the rows, so they cannot drift from them. */
  async summary(workspaceId: string, query: UsageQuery): Promise<UsageSummary> {
    const conditions: (SQL | undefined)[] = [eq(aiRequests.workspaceId, workspaceId)]

    if (query.from) conditions.push(gte(aiRequests.createdAt, new Date(query.from)))
    if (query.to) conditions.push(lte(aiRequests.createdAt, new Date(query.to)))

    const rows = await this.db
      .select({
        provider: aiRequests.provider,
        model: aiRequests.model,
        requests: count(),
        failed: sql<number>`count(*) filter (where ${aiRequests.status} = 'failed')::int`,
        inputTokens: sum(aiRequests.inputTokens),
        outputTokens: sum(aiRequests.outputTokens),
        costMicroUsd: sum(aiRequests.costMicroUsd),
      })
      .from(aiRequests)
      .where(and(...conditions))
      .groupBy(aiRequests.provider, aiRequests.model)
      .orderBy(desc(sum(aiRequests.costMicroUsd)))

    // Postgres returns sums as strings to preserve bigint precision; parse
    // them once here rather than letting a string reach the arithmetic.
    const byModel = rows.map((row) => ({
      provider: row.provider as UsageSummary['byModel'][number]['provider'],
      model: row.model,
      requests: Number(row.requests),
      failed: Number(row.failed),
      inputTokens: Number(row.inputTokens ?? 0),
      outputTokens: Number(row.outputTokens ?? 0),
      costMicroUsd: Number(row.costMicroUsd ?? 0),
    }))

    const totals = byModel.reduce(
      (running, line) => ({
        requests: running.requests + line.requests,
        failed: running.failed + line.failed,
        inputTokens: running.inputTokens + line.inputTokens,
        outputTokens: running.outputTokens + line.outputTokens,
        costMicroUsd: running.costMicroUsd + line.costMicroUsd,
      }),
      { requests: 0, failed: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 },
    )

    return {
      totals: {
        ...totals,
        costCents: Math.round(totals.costMicroUsd / MICRO_USD_PER_CENT),
      },
      byModel,
    }
  }

  async list(workspaceId: string, query: ListAiRequestsQuery): Promise<AiRequestPage> {
    const limit = cappedLimit(query.limit)
    const conditions: (SQL | undefined)[] = [eq(aiRequests.workspaceId, workspaceId)]

    if (query.status) conditions.push(eq(aiRequests.status, query.status))
    if (query.model) conditions.push(eq(aiRequests.model, query.model))
    if (query.cursor) conditions.push(sql`${aiRequests.id} > ${query.cursor}`)

    const rows = await this.db
      .select()
      .from(aiRequests)
      .where(and(...conditions))
      .orderBy(aiRequests.id)
      .limit(limit + 1)

    return toPage(rows, limit, toDto)
  }
}
