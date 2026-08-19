import { z } from 'zod'

export const CUSTOMER_STAGE_VALUES = ['lead', 'qualified', 'active', 'churned'] as const

export const customerStageSchema = z.enum(CUSTOMER_STAGE_VALUES)

export type CustomerStage = z.infer<typeof customerStageSchema>

/** Blank strings mean "not given"; storing '' and null as different is a trap. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish()

export const createCustomerRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().email('Must be a valid email address').max(320).nullish(),
  company: optionalText(200),
  phone: optionalText(50),
  stage: customerStageSchema.default('lead'),
  /** Minor units, so 12.34 is 1234. Non-negative and bounded well inside int4. */
  valueCents: z.number().int().min(0).max(2_000_000_000).default(0),
})

export const updateCustomerRequestSchema = createCustomerRequestSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update')

export const listCustomersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  stage: customerStageSchema.optional(),
  cursor: z.string().uuid().optional(),
  // Capped here as well as in the service, so an absurd limit is a 422 rather
  // than a silent clamp.
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const createNoteRequestSchema = z.object({
  body: z.string().trim().min(1, 'A note cannot be empty').max(5000),
})

export const customerSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  company: z.string().nullable(),
  phone: z.string().nullable(),
  stage: customerStageSchema,
  valueCents: z.number().int(),
  convertedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const customerNoteSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  authorId: z.string().uuid().nullable(),
  body: z.string(),
  createdAt: z.string(),
})

export const customerPageSchema = z.object({
  items: z.array(customerSchema),
  /** The id to pass as `cursor` for the next page, or null at the end. */
  nextCursor: z.string().uuid().nullable(),
})

export type CreateCustomerRequest = z.infer<typeof createCustomerRequestSchema>
export type UpdateCustomerRequest = z.infer<typeof updateCustomerRequestSchema>
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>
export type Customer = z.infer<typeof customerSchema>
export type CustomerNote = z.infer<typeof customerNoteSchema>
export type CustomerPage = z.infer<typeof customerPageSchema>
