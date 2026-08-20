import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { and, eq, isNotNull, lte } from 'drizzle-orm'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { workflows } from '../database/schema'
import { JobQueue } from './queue'
import { WorkflowRunner } from './runner'
import { nextRunFor } from './schedule'

const IDLE_SLEEP_MS = 1000
const SCHEDULER_TICK_MS = 60_000

/**
 * Polls the queue and ticks the scheduler, inside the API process.
 *
 * Started explicitly rather than on module init: every end-to-end test boots
 * the application, and a worker that starts itself would have every suite
 * quietly running background work against the test database.
 */
@Injectable()
export class AutomationWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(AutomationWorker.name)
  private running = false
  private loop: Promise<void> | null = null
  private scheduler: NodeJS.Timeout | null = null

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: JobQueue,
    private readonly runner: WorkflowRunner,
  ) {}

  start(): void {
    if (this.running) return

    this.running = true
    this.loop = this.poll()
    this.scheduler = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger.error(`Scheduler tick failed: ${String(error)}`)
      })
    }, SCHEDULER_TICK_MS)

    this.logger.log('Automation worker started')
  }

  async stop(): Promise<void> {
    this.running = false

    if (this.scheduler) clearInterval(this.scheduler)

    await this.loop
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop()
  }

  /** One unit of work. Exposed so a test can drive it without a timer. */
  async workOnce(): Promise<boolean> {
    const job = await this.queue.claim()

    if (!job) return false

    const [workflow] = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, job.workflowId))
      .limit(1)

    if (!workflow) {
      await this.queue.fail(job, 'The workflow no longer exists')
      return true
    }

    try {
      const run = await this.runner.run(workflow, job.id, null)

      // A run that finished with a failed step is a failed job: it should be
      // retried, and it should not report success.
      if (run.status === 'failed') {
        await this.queue.fail(job, run.error ?? 'A step failed')
      } else {
        await this.queue.succeed(job.id)
      }
    } catch (error) {
      await this.queue.fail(job, error instanceof Error ? error.message : String(error))
    }

    return true
  }

  /** Enqueues every schedule that has come due, and advances it. */
  async tick(now = new Date()): Promise<number> {
    const due = await this.db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.enabled, true),
          eq(workflows.triggerType, 'schedule'),
          isNotNull(workflows.nextRunAt),
          lte(workflows.nextRunAt, now),
        ),
      )

    for (const workflow of due) {
      await this.queue.enqueue(workflow.workspaceId, workflow.id, now)

      // Advanced immediately, so a slow run cannot cause a second enqueue.
      await this.db
        .update(workflows)
        .set({ nextRunAt: nextRunFor(workflow, now) })
        .where(eq(workflows.id, workflow.id))
    }

    return due.length
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const worked = await this.workOnce()

        if (!worked) await sleep(IDLE_SLEEP_MS)
      } catch (error) {
        this.logger.error(`Worker loop error: ${String(error)}`)
        await sleep(IDLE_SLEEP_MS)
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
