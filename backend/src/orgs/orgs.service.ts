import { Inject, Injectable } from '@nestjs/common'
import type {
  CreateOrganizationRequest,
  CreateWorkspaceRequest,
  MembershipSummary,
  Organization,
  UpdateOrganizationRequest,
  UpdateWorkspaceRequest,
  Workspace,
} from '@onestack/shared'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../common/errors'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import {
  memberships,
  organizations,
  workspaces,
  type OrganizationRow,
  type WorkspaceRow,
} from '../database/schema'
import type { Role } from './roles'
import { uniqueSlug } from './slug'

/** A transaction or the pool — anything the queries below can run on. */
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export function toOrganization(row: OrganizationRow): Organization {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.createdAt.toISOString() }
}

export function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class OrgsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Creates an organization with its first workspace and the caller as owner.
   * One transaction: a half-created tenant is worse than a failed request.
   */
  async create(
    input: CreateOrganizationRequest,
    ownerId: string,
    executor: Executor = this.db,
  ): Promise<Organization> {
    const run = async (tx: Executor): Promise<Organization> => {
      const slug = await this.freeOrganizationSlug(input.name, tx)

      const [organization] = await tx
        .insert(organizations)
        .values({ name: input.name, slug })
        .returning()

      await tx
        .insert(memberships)
        .values({ organizationId: organization!.id, userId: ownerId, role: 'owner' })

      await tx
        .insert(workspaces)
        .values({ organizationId: organization!.id, name: 'General', slug: 'general' })

      return toOrganization(organization!)
    }

    // Already inside one when register calls this; do not nest.
    return executor === this.db ? this.db.transaction((tx) => run(tx)) : run(executor)
  }

  /** The organizations a person belongs to, with the role they hold in each. */
  async listForUser(userId: string): Promise<MembershipSummary[]> {
    const rows = await this.db
      .select({ organization: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, userId))

    return rows.map((row) => ({ ...toOrganization(row.organization), role: row.role }))
  }

  /** Membership and role in one lookup, or null. The guard's only question. */
  async membershipOf(
    organizationId: string,
    userId: string,
  ): Promise<{ organization: Organization; role: Role } | null> {
    const rows = await this.db
      .select({ organization: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
      .limit(1)

    const row = rows[0]

    return row ? { organization: toOrganization(row.organization), role: row.role } : null
  }

  async update(organizationId: string, input: UpdateOrganizationRequest): Promise<Organization> {
    const [updated] = await this.db
      .update(organizations)
      .set({ name: input.name })
      .where(eq(organizations.id, organizationId))
      .returning()

    if (!updated) throw new NotFoundError('Organization not found')

    return toOrganization(updated)
  }

  async listWorkspaces(organizationId: string): Promise<Workspace[]> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.organizationId, organizationId))

    return rows.map(toWorkspace)
  }

  async createWorkspace(organizationId: string, input: CreateWorkspaceRequest): Promise<Workspace> {
    const slug = await this.freeWorkspaceSlug(organizationId, input.name)

    const [created] = await this.db
      .insert(workspaces)
      .values({ organizationId, name: input.name, slug })
      .returning()

    return toWorkspace(created!)
  }

  /**
   * Every workspace query is filtered by organization as well as id. An id
   * from another tenant therefore finds nothing, rather than finding a row the
   * caller may not have.
   */
  async updateWorkspace(
    organizationId: string,
    workspaceId: string,
    input: UpdateWorkspaceRequest,
  ): Promise<Workspace> {
    const [updated] = await this.db
      .update(workspaces)
      .set({ name: input.name })
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .returning()

    if (!updated) throw new NotFoundError('Workspace not found')

    return toWorkspace(updated)
  }

  async deleteWorkspace(organizationId: string, workspaceId: string): Promise<void> {
    const deleted = await this.db
      .delete(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .returning()

    if (deleted.length === 0) throw new NotFoundError('Workspace not found')
  }

  private async freeOrganizationSlug(name: string, executor: Executor): Promise<string> {
    const rows = await executor.select({ slug: organizations.slug }).from(organizations)

    return uniqueSlug(name, new Set(rows.map((row) => row.slug)))
  }

  private async freeWorkspaceSlug(organizationId: string, name: string): Promise<string> {
    const rows = await this.db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.organizationId, organizationId))

    return uniqueSlug(name, new Set(rows.map((row) => row.slug)))
  }
}
