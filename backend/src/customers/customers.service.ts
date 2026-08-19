import { Inject, Injectable } from '@nestjs/common'
import type {
  CreateCustomerRequest,
  CreateNoteRequest,
  Customer,
  CustomerNote,
  CustomerPage,
  ListCustomersQuery,
  UpdateCustomerRequest,
} from '@onestack/shared'
import { and, desc, eq, gt, ilike, or, sql, type SQL } from 'drizzle-orm'
import { ConflictError, NotFoundError } from '../common/errors'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import {
  customerNotes,
  customers,
  type CustomerNoteRow,
  type CustomerRow,
} from '../database/schema'
import { containsPattern } from './search'

/** Regardless of what was asked for. */
const MAX_LIMIT = 100

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    email: row.email,
    company: row.company,
    phone: row.phone,
    stage: row.stage,
    valueCents: row.valueCents,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toNote(row: CustomerNoteRow): CustomerNote {
  return {
    id: row.id,
    customerId: row.customerId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class CustomersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(workspaceId: string, input: CreateCustomerRequest): Promise<Customer> {
    try {
      const [created] = await this.db
        .insert(customers)
        .values({
          workspaceId,
          name: input.name,
          email: input.email ?? null,
          company: input.company ?? null,
          phone: input.phone ?? null,
          stage: input.stage,
          valueCents: input.valueCents,
          // Created straight into active counts as converting.
          convertedAt: input.stage === 'active' ? new Date() : null,
        })
        .returning()

      return toCustomer(created!)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A customer with that email already exists in this workspace')
      }
      throw error
    }
  }

  /**
   * Keyset pagination: `where id > cursor order by id`. UUIDv7 sorts by
   * creation time, so this needs no extra column, and page one thousand costs
   * what page one costs.
   */
  async list(workspaceId: string, query: ListCustomersQuery): Promise<CustomerPage> {
    const limit = Math.min(query.limit, MAX_LIMIT)
    const conditions: (SQL | undefined)[] = [eq(customers.workspaceId, workspaceId)]

    if (query.stage) conditions.push(eq(customers.stage, query.stage))

    if (query.q) {
      // Escaped, so a search for '%' finds a percent sign rather than everything.
      const pattern = containsPattern(query.q)

      conditions.push(
        or(
          ilike(customers.name, pattern),
          ilike(sql`${customers.email}::text`, pattern),
          ilike(customers.company, pattern),
        ),
      )
    }

    // The cursor is filtered by workspace like everything else, so one from
    // another tenant simply selects nothing.
    if (query.cursor) conditions.push(gt(customers.id, query.cursor))

    const rows = await this.db
      .select()
      .from(customers)
      .where(and(...conditions))
      .orderBy(customers.id)
      // One extra row answers "is there a next page" without a second query.
      .limit(limit + 1)

    const items = rows.slice(0, limit).map(toCustomer)
    const nextCursor = rows.length > limit ? (items.at(-1)?.id ?? null) : null

    return { items, nextCursor }
  }

  async get(workspaceId: string, customerId: string): Promise<Customer> {
    return toCustomer(await this.row(workspaceId, customerId))
  }

  async update(
    workspaceId: string,
    customerId: string,
    input: UpdateCustomerRequest,
  ): Promise<Customer> {
    const existing = await this.row(workspaceId, customerId)

    const becomingActive = input.stage === 'active' && existing.stage !== 'active'

    try {
      const [updated] = await this.db
        .update(customers)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email ?? null } : {}),
          ...(input.company !== undefined ? { company: input.company ?? null } : {}),
          ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
          ...(input.stage !== undefined ? { stage: input.stage } : {}),
          ...(input.valueCents !== undefined ? { valueCents: input.valueCents } : {}),
          // Stamped the first time only. Somebody who churns and returns kept
          // the date they first became a customer, which is what it means.
          ...(becomingActive && !existing.convertedAt ? { convertedAt: new Date() } : {}),
        })
        .where(and(eq(customers.id, customerId), eq(customers.workspaceId, workspaceId)))
        .returning()

      return toCustomer(updated!)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A customer with that email already exists in this workspace')
      }
      throw error
    }
  }

  async remove(workspaceId: string, customerId: string): Promise<void> {
    const deleted = await this.db
      .delete(customers)
      .where(and(eq(customers.id, customerId), eq(customers.workspaceId, workspaceId)))
      .returning()

    if (deleted.length === 0) throw new NotFoundError('Customer not found')
  }

  async addNote(
    workspaceId: string,
    customerId: string,
    authorId: string,
    input: CreateNoteRequest,
  ): Promise<CustomerNote> {
    // Proves the customer is in this workspace before attaching anything.
    await this.row(workspaceId, customerId)

    const [created] = await this.db
      .insert(customerNotes)
      .values({ customerId, authorId, body: input.body })
      .returning()

    return toNote(created!)
  }

  async listNotes(workspaceId: string, customerId: string): Promise<CustomerNote[]> {
    await this.row(workspaceId, customerId)

    const rows = await this.db
      .select()
      .from(customerNotes)
      .where(eq(customerNotes.customerId, customerId))
      .orderBy(desc(customerNotes.id))

    return rows.map(toNote)
  }

  /** Every read filters on the workspace, never on the id alone. */
  private async row(workspaceId: string, customerId: string): Promise<CustomerRow> {
    const rows = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.workspaceId, workspaceId)))
      .limit(1)

    const row = rows[0]

    if (!row) throw new NotFoundError('Customer not found')

    return row
  }
}

/** 23505 is Postgres for unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
