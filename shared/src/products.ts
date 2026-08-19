import { z } from 'zod'

export const PRODUCT_STATUS_VALUES = ['active', 'archived'] as const
export const PRICE_INTERVAL_VALUES = ['one_time', 'month', 'year'] as const

export const productStatusSchema = z.enum(PRODUCT_STATUS_VALUES)
export const priceIntervalSchema = z.enum(PRICE_INTERVAL_VALUES)

export type ProductStatus = z.infer<typeof productStatusSchema>
export type PriceInterval = z.infer<typeof priceIntervalSchema>

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish()

export const createProductRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  sku: optionalText(64),
  description: optionalText(2000),
})

export const updateProductRequestSchema = createProductRequestSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update')

/**
 * ISO 4217 is three letters. Uppercased here so 'usd' and 'USD' cannot become
 * two different currencies in the same catalogue.
 */
export const currencySchema = z
  .string()
  .trim()
  .length(3, 'Currency must be a three-letter ISO 4217 code')
  .regex(/^[A-Za-z]{3}$/, 'Currency must be a three-letter ISO 4217 code')
  .transform((value) => value.toUpperCase())

export const createPriceRequestSchema = z.object({
  // Zero is legitimate — free plans exist. Negative is not.
  amountCents: z.number().int().min(0).max(2_000_000_000),
  currency: currencySchema,
  interval: priceIntervalSchema,
})

export const listProductsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: productStatusSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const productPriceSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  amountCents: z.number().int(),
  currency: z.string(),
  interval: priceIntervalSchema,
  active: z.boolean(),
  createdAt: z.string(),
})

export const productSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  status: productStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** The single-product view carries its prices; the list view does not. */
export const productWithPricesSchema = productSchema.extend({
  prices: z.array(productPriceSchema),
})

export const productPageSchema = z.object({
  items: z.array(productSchema),
  nextCursor: z.string().uuid().nullable(),
})

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>
export type CreatePriceRequest = z.infer<typeof createPriceRequestSchema>
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>
export type Product = z.infer<typeof productSchema>
export type ProductPrice = z.infer<typeof productPriceSchema>
export type ProductWithPrices = z.infer<typeof productWithPricesSchema>
export type ProductPage = z.infer<typeof productPageSchema>
