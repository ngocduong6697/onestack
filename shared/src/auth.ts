import { z } from 'zod'

/**
 * The wire shapes for authentication. They live in shared so the API validates
 * exactly what the client was built against — one definition, per rule 3.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(320)
  .email('Must be a valid email address')

/**
 * Twelve is the floor. The ceiling matters too: argon2 will happily spend
 * seconds hashing a megabyte of input, which makes an unbounded password field
 * a denial-of-service vector.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password must be at most 200 characters')

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, 'Name is required').max(100),
})

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Not passwordSchema: an old password that no longer meets the policy should
  // fail as "wrong credentials", not as a validation error that says so.
  password: z.string().min(1, 'Password is required').max(200),
})

export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>

/**
 * The only user shape allowed to cross the wire. password_hash is absent by
 * construction rather than by remembering to delete it.
 */
export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.string(),
})

export type PublicUser = z.infer<typeof publicUserSchema>
