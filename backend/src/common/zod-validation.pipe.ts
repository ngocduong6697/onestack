import { Injectable, type PipeTransform } from '@nestjs/common'
import type { ZodSchema } from 'zod'
import { ValidationError } from './errors'

/**
 * CLAUDE.md rule 6 — every API must have validation — with one implementation
 * rather than one per controller. Handing a schema to the pipe is the only way
 * a body reaches a handler, and what comes out is typed.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

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
