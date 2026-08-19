import { z } from 'zod'
import { emailSchema, passwordSchema } from './auth'
import { roleSchema } from './orgs'

export const updateProfileRequestSchema = z
  .object({ name: z.string().trim().min(1, 'Name is required').max(100).optional() })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update')

export const changePasswordRequestSchema = z.object({
  // Not passwordSchema: an existing password that predates the policy must
  // still be accepted as proof of identity.
  currentPassword: z.string().min(1, 'Current password is required').max(200),
  newPassword: passwordSchema,
})

export const memberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  joinedAt: z.string(),
})

export const createInviteRequestSchema = z.object({
  email: emailSchema,
  role: roleSchema.default('member'),
})

export const updateMemberRequestSchema = z.object({ role: roleSchema })

/** What listing returns. The token is absent by construction. */
export const invitationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  email: z.string(),
  role: roleSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
})

/** Creation only, and only once: the token is never readable again. */
export const createdInvitationSchema = invitationSchema.extend({ token: z.string() })

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>
export type Member = z.infer<typeof memberSchema>
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>
export type Invitation = z.infer<typeof invitationSchema>
export type CreatedInvitation = z.infer<typeof createdInvitationSchema>
