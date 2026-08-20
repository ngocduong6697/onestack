import { Inject, Injectable, Logger } from '@nestjs/common'
import type {
  CreateInvoiceRequest,
  Invoice,
  InvoiceDetail,
  InvoicePage,
  ListInvoicesQuery,
  RecordPaymentRequest,
  SweepResult,
} from '@onestack/shared'
import { and, asc, desc, eq, isNotNull, lt, sql, type SQL } from 'drizzle-orm'
import { AUDIT_ACTIONS } from '../audit/actions'
import { AuditService } from '../audit/audit.service'
import { ConflictError, NotFoundError } from '../common/errors'
import { cappedLimit, toPage } from '../common/pagination'
import { isUniqueViolation } from '../common/postgres-errors'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import {
  customers,
  invoiceLines,
  invoices,
  ledgerEntries,
  payments,
  subscriptions,
  type InvoiceRow,
  type SubscriptionRow,
} from '../database/schema'
import { applyPayment, assertTransition, invoiceNumber, sequenceOf } from './invoice-state'

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

const DAY_MS = 24 * 60 * 60 * 1000

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    customerId: row.customerId,
    subscriptionId: row.subscriptionId,
    number: row.number,
    status: row.status,
    currency: row.currency,
    subtotalMicroUsd: row.subtotalMicroUsd,
    totalMicroUsd: row.totalMicroUsd,
    amountPaidMicroUsd: row.amountPaidMicroUsd,
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name)

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async createDraft(workspaceId: string, input: CreateInvoiceRequest): Promise<InvoiceDetail> {
    const belongs = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.workspaceId, workspaceId)))
      .limit(1)

    if (belongs.length === 0) throw new NotFoundError('Customer not found')

    const total = input.lines.reduce(
      (running, line) => running + line.quantity * line.unitMicroUsd,
      0,
    )

    const invoice = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(invoices)
        .values({
          workspaceId,
          customerId: input.customerId,
          currency: input.currency.toUpperCase(),
          subtotalMicroUsd: total,
          totalMicroUsd: total,
          dueAt: new Date(Date.now() + input.dueInDays * DAY_MS),
        })
        .returning()

      await tx.insert(invoiceLines).values(
        input.lines.map((line) => ({
          invoiceId: created!.id,
          description: line.description,
          quantity: line.quantity,
          unitMicroUsd: line.unitMicroUsd,
          amountMicroUsd: line.quantity * line.unitMicroUsd,
        })),
      )

      return created!
    })

    return this.detail(workspaceId, invoice.id)
  }

  /**
   * Draft to open, allocating the number.
   *
   * The number is read and written inside one transaction so two concurrent
   * issues cannot take the same one — and the unique index is the backstop if
   * they somehow race anyway.
   */
  async issue(
    workspaceId: string,
    invoiceId: string,
    actor?: { userId: string; label: string; organizationId: string },
  ): Promise<InvoiceDetail> {
    const existing = await this.row(workspaceId, invoiceId)

    assertTransition(existing.status, 'open')

    const year = new Date().getUTCFullYear()

    await this.db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ number: invoices.number })
        .from(invoices)
        .where(and(eq(invoices.workspaceId, workspaceId), isNotNull(invoices.number)))
        .orderBy(desc(invoices.number))
        .limit(1)

      const next = invoiceNumber(year, sequenceOf(latest?.number ?? null, year) + 1)

      await tx
        .update(invoices)
        .set({ status: 'open', number: next, issuedAt: new Date() })
        .where(eq(invoices.id, invoiceId))
    })

    const issued = await this.detail(workspaceId, invoiceId)

    if (actor) {
      await this.audit.record({
        organizationId: actor.organizationId,
        workspaceId,
        actor: { userId: actor.userId, label: actor.label },
        action: AUDIT_ACTIONS.invoiceIssued,
        resourceType: 'invoice',
        resourceId: invoiceId,
        changes: { number: issued.number, total: issued.totalMicroUsd },
      })
    }

    return issued
  }

  async recordPayment(
    workspaceId: string,
    invoiceId: string,
    input: RecordPaymentRequest,
    userId: string,
    actor?: { label: string; organizationId: string },
  ): Promise<InvoiceDetail> {
    const existing = await this.row(workspaceId, invoiceId)

    if (existing.status !== 'open' && existing.status !== 'uncollectible') {
      throw new ConflictError(`A ${existing.status} invoice cannot take a payment`)
    }

    const result = applyPayment({
      totalMicroUsd: existing.totalMicroUsd,
      alreadyPaidMicroUsd: existing.amountPaidMicroUsd,
      amountMicroUsd: input.amountMicroUsd,
    })

    await this.db.transaction(async (tx) => {
      await tx.insert(payments).values({
        workspaceId,
        invoiceId,
        amountMicroUsd: input.amountMicroUsd,
        method: input.method,
        reference: input.reference ?? null,
        receivedOn: input.receivedOn,
        recordedBy: userId,
      })

      await tx
        .update(invoices)
        .set({
          amountPaidMicroUsd: result.amountPaidMicroUsd,
          ...(result.settled ? { status: 'paid' as const, paidAt: new Date() } : {}),
        })
        .where(eq(invoices.id, invoiceId))

      if (result.settled) {
        // Settled money becomes revenue the dashboard can see. Written once,
        // when the invoice settles, not on every partial payment.
        await tx.insert(ledgerEntries).values({
          workspaceId,
          entryDate: input.receivedOn,
          kind: 'revenue',
          category: 'invoice',
          amountMicroUsd: existing.totalMicroUsd,
          note: existing.number ? `Invoice ${existing.number}` : 'Invoice',
          createdBy: userId,
        })

        // Paying clears a dunning flag the sweep may have set.
        if (existing.subscriptionId) {
          await tx
            .update(subscriptions)
            .set({ status: 'active' })
            .where(
              and(
                eq(subscriptions.id, existing.subscriptionId),
                eq(subscriptions.status, 'past_due'),
              ),
            )
        }
      }
    })

    if (actor) {
      await this.audit.record({
        organizationId: actor.organizationId,
        workspaceId,
        actor: { userId, label: actor.label },
        action: AUDIT_ACTIONS.invoicePaid,
        resourceType: 'invoice',
        resourceId: invoiceId,
        changes: { amount: input.amountMicroUsd, settled: result.settled },
      })
    }

    return this.detail(workspaceId, invoiceId)
  }

  async void(
    workspaceId: string,
    invoiceId: string,
    actor?: { userId: string; label: string; organizationId: string },
  ): Promise<InvoiceDetail> {
    const existing = await this.row(workspaceId, invoiceId)

    assertTransition(existing.status, 'void')

    await this.db
      .update(invoices)
      .set({ status: 'void', voidedAt: new Date() })
      .where(eq(invoices.id, invoiceId))

    if (actor) {
      await this.audit.record({
        organizationId: actor.organizationId,
        workspaceId,
        actor: { userId: actor.userId, label: actor.label },
        action: AUDIT_ACTIONS.invoiceVoided,
        resourceType: 'invoice',
        resourceId: invoiceId,
        changes: { from: existing.status },
      })
    }

    return this.detail(workspaceId, invoiceId)
  }

  /**
   * Issues the invoice for a period that has just begun.
   *
   * Called from the renew path. The partial unique index on
   * `(subscription_id, period_start)` is what makes it safe to call twice:
   * the second attempt collides and is treated as "already billed".
   */
  async invoiceForPeriod(
    subscription: SubscriptionRow,
    line: { description: string; unitMicroUsd: number; currency: string },
    executor: Executor,
  ): Promise<InvoiceRow | null> {
    if (!subscription.currentPeriodStart) return null

    try {
      const [created] = await executor
        .insert(invoices)
        .values({
          workspaceId: subscription.workspaceId,
          customerId: subscription.customerId,
          subscriptionId: subscription.id,
          status: 'open',
          currency: line.currency,
          subtotalMicroUsd: line.unitMicroUsd,
          totalMicroUsd: line.unitMicroUsd,
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
          issuedAt: new Date(),
          dueAt: new Date(Date.now() + 30 * DAY_MS),
          number: null,
        })
        .returning()

      await executor.insert(invoiceLines).values({
        invoiceId: created!.id,
        description: line.description,
        quantity: 1,
        unitMicroUsd: line.unitMicroUsd,
        amountMicroUsd: line.unitMicroUsd,
      })

      return created!
    } catch (error) {
      // Already billed for this period — which is the point of the index.
      if (isUniqueViolation(error)) return null
      throw error
    }
  }

  /**
   * Marks overdue invoices and moves their subscriptions to `past_due` — the
   * status TASK-008 defined and nothing has ever set until now. Idempotent:
   * running it twice changes nothing the first run did not.
   */
  async sweep(workspaceId: string, now = new Date()): Promise<SweepResult> {
    const overdue = await this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.workspaceId, workspaceId),
          eq(invoices.status, 'open'),
          isNotNull(invoices.dueAt),
          lt(invoices.dueAt, now),
        ),
      )

    let markedPastDue = 0

    for (const invoice of overdue) {
      if (!invoice.subscriptionId) continue

      const updated = await this.db
        .update(subscriptions)
        .set({ status: 'past_due' })
        .where(
          and(eq(subscriptions.id, invoice.subscriptionId), eq(subscriptions.status, 'active')),
        )
        .returning()

      markedPastDue += updated.length
    }

    return { markedPastDue, restored: 0 }
  }

  async list(workspaceId: string, query: ListInvoicesQuery): Promise<InvoicePage> {
    const limit = cappedLimit(query.limit)
    const conditions: (SQL | undefined)[] = [eq(invoices.workspaceId, workspaceId)]

    if (query.status) conditions.push(eq(invoices.status, query.status))
    if (query.customerId) conditions.push(eq(invoices.customerId, query.customerId))
    if (query.cursor) conditions.push(sql`${invoices.id} > ${query.cursor}`)

    const rows = await this.db
      .select()
      .from(invoices)
      .where(and(...conditions))
      .orderBy(invoices.id)
      .limit(limit + 1)

    return toPage(rows, limit, toInvoice)
  }

  async detail(workspaceId: string, invoiceId: string): Promise<InvoiceDetail> {
    const invoice = await this.row(workspaceId, invoiceId)

    const [lines, received] = await Promise.all([
      this.db
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, invoiceId))
        .orderBy(asc(invoiceLines.id)),
      this.db
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, invoiceId))
        .orderBy(asc(payments.id)),
    ])

    return {
      ...toInvoice(invoice),
      lines: lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitMicroUsd: line.unitMicroUsd,
        amountMicroUsd: line.amountMicroUsd,
      })),
      payments: received.map((payment) => ({
        id: payment.id,
        amountMicroUsd: payment.amountMicroUsd,
        method: payment.method,
        reference: payment.reference,
        receivedOn: payment.receivedOn,
      })),
    }
  }

  private async row(workspaceId: string, invoiceId: string): Promise<InvoiceRow> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
      .limit(1)

    const row = rows[0]

    if (!row) throw new NotFoundError('Invoice not found')

    return row
  }
}
