import { z } from 'zod'

export const ROLE_VALUES = ['member', 'admin', 'owner'] as const

export const roleSchema = z.enum(ROLE_VALUES)

export type Role = z.infer<typeof roleSchema>

const nameSchema = z.string().trim().min(1, 'Name is required').max(100)

export const createOrganizationRequestSchema = z.object({ name: nameSchema })

// A patch with no fields would be a silent no-op; require at least one.
export const updateOrganizationRequestSchema = z
  .object({ name: nameSchema.optional() })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update')

export const createWorkspaceRequestSchema = z.object({ name: nameSchema })

export const updateWorkspaceRequestSchema = z
  .object({ name: nameSchema.optional() })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update')

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
})

/** What `GET /orgs` returns: the organization plus the caller's standing in it. */
export const membershipSummarySchema = organizationSchema.extend({
  role: roleSchema,
})

export const workspaceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
})

export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>
export type Organization = z.infer<typeof organizationSchema>
export type MembershipSummary = z.infer<typeof membershipSummarySchema>
export type Workspace = z.infer<typeof workspaceSchema>
