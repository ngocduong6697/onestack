import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { up } from '../database/migrate'
import * as schema from '../database/schema'
import { jobs, organizations, workflows, workspaces } from '../database/schema'
import { backoffMs, JobQueue, LOCK_TIMEOUT_MS } from './queue'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('the job queue against a real database', () => {
  const sql = postgres(url ?? '', { max: 4, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  const queue = new JobQueue(db)

  let workspaceId: string
  let workflowId: string

  beforeAll(async () => {
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await sql.unsafe('truncate table jobs, workflows, workspaces, organizations cascade')

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Test', slug: `test-${Date.now()}` })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ organizationId: org!.id, name: 'General', slug: 'general' })
      .returning()
    const [workflow] = await db
      .insert(workflows)
      .values({ workspaceId: workspace!.id, name: 'Test', steps: [] })
      .returning()

    workspaceId = workspace!.id
    workflowId = workflow!.id
  })

  describe('claiming', () => {
    it('claims a due job and marks it running', async () => {
      await queue.enqueue(workspaceId, workflowId)

      const claimed = await queue.claim()

      expect(claimed).not.toBeNull()
      expect(claimed?.status).toBe('running')
      expect(claimed?.attempts).toBe(1)
      // toBeNull() alone would pass on undefined, which is how the snake_case
      // mapping bug hid here in the first place.
      expect(claimed?.lockedAt).toBeInstanceOf(Date)
      expect(claimed?.maxAttempts).toBe(3)
    })

    it('claims nothing when the queue is empty', async () => {
      expect(await queue.claim()).toBeNull()
    })

    it('does not claim a job scheduled for later', async () => {
      await queue.enqueue(workspaceId, workflowId, new Date(Date.now() + 60_000))

      expect(await queue.claim()).toBeNull()
    })

    it('takes the oldest due job first', async () => {
      const older = await queue.enqueue(workspaceId, workflowId, new Date(Date.now() - 10_000))
      await queue.enqueue(workspaceId, workflowId, new Date(Date.now() - 1_000))

      expect((await queue.claim())?.id).toBe(older.id)
    })

    /**
     * The property the whole design rests on. Two real connections, two real
     * transactions, at the same time — because reasoning about SKIP LOCKED is
     * not evidence, and getting it wrong means paying for an AI call twice.
     */
    it('never hands the same job to two workers at once', async () => {
      await queue.enqueue(workspaceId, workflowId)

      const [first, second] = await Promise.all([queue.claim(), queue.claim()])
      const claimedIds = [first?.id, second?.id].filter(Boolean)

      expect(claimedIds).toHaveLength(1)
    })

    it('hands out each of several jobs exactly once under concurrency', async () => {
      for (let i = 0; i < 8; i += 1) await queue.enqueue(workspaceId, workflowId)

      const claims = await Promise.all(Array.from({ length: 8 }, () => queue.claim()))
      const ids = claims.filter(Boolean).map((job) => job!.id)

      expect(ids).toHaveLength(8)
      expect(new Set(ids).size).toBe(8)
    })

    it('leaves nothing claimable once every job is taken', async () => {
      await queue.enqueue(workspaceId, workflowId)
      await queue.claim()

      expect(await queue.claim()).toBeNull()
    })
  })

  describe('a worker that dies holding a job', () => {
    it('reclaims the job once its lock has aged out', async () => {
      const job = await queue.enqueue(workspaceId, workflowId)
      await queue.claim()

      // The worker vanished; its lock is older than the timeout.
      await db
        .update(jobs)
        .set({ lockedAt: new Date(Date.now() - LOCK_TIMEOUT_MS - 1000) })
        .where(eq(jobs.id, job.id))

      const reclaimed = await queue.claim()

      expect(reclaimed?.id).toBe(job.id)
      expect(reclaimed?.attempts).toBe(2)
    })

    it('leaves a freshly claimed job alone', async () => {
      await queue.enqueue(workspaceId, workflowId)
      await queue.claim()

      expect(await queue.claim()).toBeNull()
    })
  })

  describe('failure and retry', () => {
    it('requeues with backoff and does not run again immediately', async () => {
      await queue.enqueue(workspaceId, workflowId)
      const claimed = await queue.claim()

      expect(await queue.fail(claimed!, 'provider exploded')).toBe('retrying')
      expect(await queue.claim()).toBeNull()
    })

    it('grows the delay with each attempt', () => {
      expect(backoffMs(1)).toBe(30_000)
      expect(backoffMs(2)).toBe(120_000)
      expect(backoffMs(3)).toBe(480_000)
    })

    it('goes dead after the last attempt and stays dead', async () => {
      const job = await queue.enqueue(workspaceId, workflowId)
      await db.update(jobs).set({ maxAttempts: 2 }).where(eq(jobs.id, job.id))

      const first = await queue.claim()
      await queue.fail(first!, 'first failure')
      await db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, job.id))

      const second = await queue.claim()
      expect(await queue.fail(second!, 'second failure')).toBe('dead')

      const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id))
      expect(row?.status).toBe('dead')

      // A dead job must not be picked up again, ever.
      await db
        .update(jobs)
        .set({ runAt: new Date(Date.now() - 60_000) })
        .where(eq(jobs.id, job.id))
      expect(await queue.claim()).toBeNull()
    })

    it('records the error, truncated', async () => {
      await queue.enqueue(workspaceId, workflowId)
      const claimed = await queue.claim()

      await queue.fail(claimed!, 'x'.repeat(5000))

      const [row] = await db.select().from(jobs).where(eq(jobs.id, claimed!.id))
      expect(row?.lastError).toHaveLength(1000)
    })
  })

  describe('succeeding', () => {
    it('is terminal and releases the lock', async () => {
      await queue.enqueue(workspaceId, workflowId)
      const claimed = await queue.claim()

      await queue.succeed(claimed!.id)

      const [row] = await db.select().from(jobs).where(eq(jobs.id, claimed!.id))
      expect(row?.status).toBe('succeeded')
      expect(row?.lockedAt).toBeNull()
      expect(await queue.claim()).toBeNull()
    })
  })
})
