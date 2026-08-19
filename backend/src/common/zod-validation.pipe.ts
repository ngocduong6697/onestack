import { Injectable, type PipeTransform } from '@nestjs/common'
import type { ZodType, ZodTypeDef } from 'zod'
import { ValidationError } from './errors'

/**
 * CLAUDE.md rule 6 — every API must have validation — with one implementation
 * rather than one per controller. Handing a schema to the pipe is the only way
 * a body reaches a handler, and what comes out is typed.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  /**
   * The input side is `unknown` on purpose. A schema that transforms — coercing
   * a query string to a number, uppercasing a currency — has a different input
   * type from its output, and ZodSchema<T> would require them to match.
   */
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value)

    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ')

      throw new ValidationError(detail)
    }

    return result.data
  }
}
