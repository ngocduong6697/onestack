import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq, lt, lte, or, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { jobs, type JobRow } from '../database/schema'

/** How long a claim is trusted before the worker is presumed dead. */
export const LOCK_TIMEOUT_MS = 5 * 60 * 1000

const BASE_BACKOFF_MS = 30_000

/**
 * Exponential, so a provider having a bad minute is not hammered: 30s, 2m, 8m.
 * Deterministic rather than jittered — with one worker there is nothing to
 * spread out, and a predictable delay is easier to reason about in a test.
 */
export function backoffMs(attempts: number): number {
  return BASE_BACKOFF_MS * 4 ** Math.max(0, attempts - 1)
}

@Injectable()
export class JobQueue {
  private readonly logger = new Logger(JobQueue.name)

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async enqueue(workspaceId: string, workflowId: string, runAt = new Date()): Promise<JobRow> {
    const [job] = await this.db.insert(jobs).values({ workspaceId, workflowId, runAt }).returning()

    return job!
  }

  /**
   * Claims one job.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes this safe: a second worker running
   * the same statement steps over the locked row instead of waiting for it, so
   * two workers never take the same job. Without it, the choice is serialising
   * every worker behind one lock, or double-processing — and double-processing
   * a paid AI call means paying twice.
   *
   * A job left `running` with a stale lock is reclaimed: its worker died.
   */
  async claim(now = new Date()): Promise<JobRow | null> {
    const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MS)

    // Timestamps go in as ISO strings with an explicit cast: a raw fragment
    // is not the typed query builder, and a Date reaches the driver unconverted.
    const at = now.toISOString()
    const stale = staleBefore.toISOString()

    const claimed = await this.db.execute(sql`
      update ${jobs}
         set status = 'running',
             locked_at = ${at}::timestamptz,
             attempts = ${jobs.attempts} + 1
       where ${jobs.id} = (
             select ${jobs.id}
               from ${jobs}
              where (${jobs.status} = 'queued' and ${jobs.runAt} <= ${at}::timestamptz)
                 or (${jobs.status} = 'running' and ${jobs.lockedAt} < ${stale}::timestamptz)
              order by ${jobs.runAt}
              limit 1
              for update skip locked
             )
      returning ${jobs.id}
    `)

    const claimedId = (claimed as unknown as { id: string }[])[0]?.id

    if (!claimedId) return null

    /**
     * Re-read through the query builder rather than casting the raw result.
     * A raw `returning *` hands back the database's snake_case columns, so
     * `maxAttempts` arrives as undefined — and `attempts >= undefined` is
     * false, which quietly turns "give up after three tries" into "retry
     * forever". The extra select is cheap; being wrong about that is not.
     */
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, claimedId)).limit(1)

    return row ?? null
  }

  async succeed(jobId: string): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: 'succeeded', lockedAt: null })
      .where(eq(jobs.id, jobId))
  }

  /**
   * Retries with backoff until the attempts run out, then leaves the job
   * `dead` — a terminal state the claim query does not look at, so a job that
   * cannot succeed stops consuming the worker.
   */
  async fail(job: JobRow, error: string, now = new Date()): Promise<'retrying' | 'dead'> {
    const exhausted = job.attempts >= job.maxAttempts

    await this.db
      .update(jobs)
      .set({
        status: exhausted ? 'dead' : 'queued',
        lockedAt: null,
        lastError: error.slice(0, 1000),
        runAt: exhausted ? job.runAt : new Date(now.getTime() + backoffMs(job.attempts)),
      })
      .where(eq(jobs.id, job.id))

    if (exhausted) {
      this.logger.warn(`Job ${job.id} is dead after ${job.attempts} attempts: ${error}`)
    }

    return exhausted ? 'dead' : 'retrying'
  }

  /** How many jobs are waiting — used by tests and, later, by monitoring. */
  async queuedCount(now = new Date()): Promise<number> {
    const rows = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, 'queued'), lte(jobs.runAt, now)),
          and(
            eq(jobs.status, 'running'),
            lt(jobs.lockedAt, new Date(now.getTime() - LOCK_TIMEOUT_MS)),
          ),
        ),
      )

    return rows.length
  }
}
