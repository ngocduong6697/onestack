import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_PROVIDERS_TOKEN } from '../ai/providers.factory'
import type { AiProvider } from '../ai/provider'
import { THROTTLER_GUARD } from '../common/throttler'
import { AppModule } from '../app.module'
import { SESSION_COOKIE } from '../auth/session-cookie'
import { up } from '../database/migrate'
import * as schema from '../database/schema'
import { auditEvents, users } from '../database/schema'
import { AUDIT_ACTIONS } from './actions'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('the audit log', () => {
  let app: INestApplication
  const sql = postgres(url ?? '', { max: 2, onnotice: () => undefined })
  const db = drizzle(sql, { schema })
  const http = () => request(app.getHttpServer())

  const stub = {
    name: 'anthropic' as const,
    complete: vi.fn().mockResolvedValue({
      text: 'answer',
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    }),
    stream: vi.fn(),
  } as unknown as AiProvider

  const signUp = async (email: string, name: string) => {
    const response = await http()
      .post('/auth/register')
      .send({ email, password: 'a sufficiently long password', name })
    expect(response.status).toBe(201)

    const header = response.headers['set-cookie'] as unknown as string[]
    const cookie = header.find((entry) => entry.startsWith(SESSION_COOKIE))!
    const orgs = await http().get('/orgs').set('Cookie', cookie)
    expect(orgs.status).toBe(200)
    expect(orgs.body.length).toBeGreaterThan(0)

    const org = orgs.body[0]
    const spaces = await http().get(`/orgs/${org.id}/workspaces`).set('Cookie', cookie)
    expect(spaces.status).toBe(200)

    return {
      cookie,
      userId: response.body.id as string,
      org,
      base: `/orgs/${org.id}/workspaces/${spaces.body[0].id}`,
      auditUrl: `/orgs/${org.id}/audit`,
    }
  }

  type Ctx = Awaited<ReturnType<typeof signUp>>

  const eventsFor = async (action: string) =>
    (await db.select().from(auditEvents)).filter((row) => row.action === action)

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    await sql.unsafe('drop schema public cascade; create schema public;')
    await up(sql)

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Rate limiting has its own test file; here it would only fail this
      // suite as the request count grows.
      .overrideProvider(THROTTLER_GUARD)
      .useValue({ canActivate: () => true })
      .overrideProvider(AI_PROVIDERS_TOKEN)
      .useValue(new Map([['anthropic', stub]]))
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    await app.listen(0)
  })

  afterAll(async () => {
    await app.close()
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await sql.unsafe(
      'truncate table sessions, audit_events, payments, invoice_lines, invoices, ledger_entries, metric_snapshots, run_steps, runs, jobs, workflows, ai_requests, subscriptions, product_prices, products, customer_notes, customers, invitations, memberships, workspaces, organizations, users cascade',
    )
  })

  describe('identity', () => {
    it('records a registration', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const events = await eventsFor(AUDIT_ACTIONS.authRegistered)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        organizationId: ctx.org.id,
        actorUserId: ctx.userId,
        actorLabel: 'Founder',
        resourceType: 'user',
      })
    })

    it('records a login', async () => {
      await signUp('founder@onestack.test', 'Founder')

      await http()
        .post('/auth/login')
        .send({ email: 'founder@onestack.test', password: 'a sufficiently long password' })

      expect(await eventsFor(AUDIT_ACTIONS.authLogin)).toHaveLength(1)
    })

    /** The log must never become a place secrets end up. */
    it('stores no password, hash or token anywhere', async () => {
      await signUp('founder@onestack.test', 'Founder')
      await http()
        .post('/auth/login')
        .send({ email: 'founder@onestack.test', password: 'a sufficiently long password' })

      const everything = JSON.stringify(await db.select().from(auditEvents))

      expect(everything).not.toContain('a sufficiently long password')
      expect(everything).not.toContain('argon2')
      expect(everything).not.toMatch(/[A-Za-z0-9_-]{43}/) // a session token
    })
  })

  describe('membership', () => {
    const addMember = async (ctx: Ctx, email: string) => {
      const invite = await http()
        .post(`/orgs/${ctx.org.id}/invites`)
        .set('Cookie', ctx.cookie)
        .send({ email, role: 'member' })
      const joiner = await signUp(email, 'Joiner')
      await http().post(`/invites/${invite.body.token}/accept`).set('Cookie', joiner.cookie)

      return joiner
    }

    it('records an invitation and its acceptance, never the token', async () => {
      const ctx = await signUp('owner@onestack.test', 'Owner')
      await addMember(ctx, 'member@onestack.test')

      const created = await eventsFor(AUDIT_ACTIONS.inviteCreated)
      const accepted = await eventsFor(AUDIT_ACTIONS.inviteAccepted)

      expect(created).toHaveLength(1)
      expect(created[0]?.changes).toMatchObject({ email: 'member@onestack.test', role: 'member' })
      expect(JSON.stringify(created[0]?.changes)).not.toMatch(/[A-Za-z0-9_-]{43}/)
      expect(accepted).toHaveLength(1)
    })

    it('records a role change with what it was and what it became', async () => {
      const ctx = await signUp('owner@onestack.test', 'Owner')
      const member = await addMember(ctx, 'member@onestack.test')

      await http()
        .patch(`/orgs/${ctx.org.id}/members/${member.userId}`)
        .set('Cookie', ctx.cookie)
        .send({ role: 'admin' })

      const events = await eventsFor(AUDIT_ACTIONS.memberRoleChanged)
      expect(events[0]).toMatchObject({ actorLabel: 'Owner', resourceId: member.userId })
      expect(events[0]?.changes).toEqual({ from: 'member', to: 'admin' })
    })

    it('records a removal', async () => {
      const ctx = await signUp('owner@onestack.test', 'Owner')
      const member = await addMember(ctx, 'member@onestack.test')

      await http().delete(`/orgs/${ctx.org.id}/members/${member.userId}`).set('Cookie', ctx.cookie)

      expect(await eventsFor(AUDIT_ACTIONS.memberRemoved)).toHaveLength(1)
    })
  })

  describe('money and deletions', () => {
    const aCustomer = async (ctx: Ctx) => {
      const created = await http()
        .post(`${ctx.base}/customers`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Acme', email: 'ap@acme.test' })
      return created.body.id as string
    }

    it('records issuing and paying an invoice', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customerId = await aCustomer(ctx)
      const draft = await http()
        .post(`${ctx.base}/invoices`)
        .set('Cookie', ctx.cookie)
        .send({
          customerId,
          lines: [{ description: 'Work', quantity: 1, unitMicroUsd: 1_000_000 }],
        })
      const open = await http()
        .post(`${ctx.base}/invoices/${draft.body.id}/issue`)
        .set('Cookie', ctx.cookie)
      await http()
        .post(`${ctx.base}/invoices/${open.body.id}/pay`)
        .set('Cookie', ctx.cookie)
        .send({
          amountMicroUsd: 1_000_000,
          method: 'bank_transfer',
          receivedOn: new Date().toISOString().slice(0, 10),
        })

      expect(await eventsFor(AUDIT_ACTIONS.invoiceIssued)).toHaveLength(1)
      expect(await eventsFor(AUDIT_ACTIONS.invoicePaid)).toHaveLength(1)
    })

    it('records what a deleted customer was, so the entry answers something', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const customerId = await aCustomer(ctx)

      await http().delete(`${ctx.base}/customers/${customerId}`).set('Cookie', ctx.cookie)

      const events = await eventsFor(AUDIT_ACTIONS.customerDeleted)
      expect(events[0]?.changes).toMatchObject({ name: 'Acme', email: 'ap@acme.test' })
    })
  })

  describe('things nobody was logged in for', () => {
    /** The reason recording is at the service layer, not an interceptor. */
    it('records a workflow run against the system actor', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      const workflow = await http()
        .post(`${ctx.base}/workflows`)
        .set('Cookie', ctx.cookie)
        .send({ name: 'Nightly', steps: [{ action: 'analytics.snapshot' }] })

      // Straight through the worker, with no HTTP request in sight.
      const { AutomationWorker } = await import('../automation/worker')
      const { JobQueue } = await import('../automation/queue')
      await app.get(JobQueue).enqueue(ctx.org.id ? workflow.body.workspaceId : '', workflow.body.id)
      await app.get(AutomationWorker).workOnce()

      const events = await eventsFor(AUDIT_ACTIONS.workflowRun)
      expect(events).toHaveLength(1)
      expect(events[0]?.actorUserId).toBeNull()
      expect(events[0]?.actorLabel).toBe('system')
    })
  })

  describe('reading the log', () => {
    it('lists events newest last, filterable by action', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      const response = await http()
        .get(`${ctx.auditUrl}?action=${AUDIT_ACTIONS.authRegistered}`)
        .set('Cookie', ctx.cookie)

      expect(response.status).toBe(200)
      expect(response.body.items).toHaveLength(1)
      expect(response.body.items[0].action).toBe('auth.registered')
    })

    /** The log itself is sensitive: it says who removed whom. */
    it('is refused to a member', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')
      await sql.unsafe(`update memberships set role = 'member' where user_id = '${ctx.userId}'`)

      expect((await http().get(ctx.auditUrl).set('Cookie', ctx.cookie)).status).toBe(403)
    })

    it('is invisible to another tenant', async () => {
      const owner = await signUp('owner@onestack.test', 'Owner')
      const outsider = await signUp('outsider@onestack.test', 'Outsider')

      expect((await http().get(owner.auditUrl).set('Cookie', outsider.cookie)).status).toBe(404)
    })

    it('survives the actor being deleted, keeping their name', async () => {
      const ctx = await signUp('founder@onestack.test', 'Founder')

      await db.delete(users).where(eq(users.id, ctx.userId))

      const events = await db.select().from(auditEvents)
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]?.actorUserId).toBeNull()
      expect(events[0]?.actorLabel).toBe('Founder')
    })
  })
})
