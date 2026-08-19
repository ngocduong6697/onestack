import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ValidationError } from './errors'
import { ZodValidationPipe } from './zod-validation.pipe'

const schema = z.object({ email: z.string().email(), age: z.number().int().min(0) })

describe('ZodValidationPipe', () => {
  it('returns parsed, typed data', () => {
    const pipe = new ZodValidationPipe(schema)

    expect(pipe.transform({ email: 'a@b.test', age: 3 })).toEqual({ email: 'a@b.test', age: 3 })
  })

  it('raises a ValidationError, which the filter maps to 422', () => {
    const pipe = new ZodValidationPipe(schema)

    expect(() => pipe.transform({ email: 'nope', age: 3 })).toThrow(ValidationError)
  })

  it('names every offending field', () => {
    const pipe = new ZodValidationPipe(schema)

    expect(() => pipe.transform({ email: 'nope', age: -1 })).toThrow(/email.*age/s)
  })

  it('rejects a body that is not an object at all', () => {
    const pipe = new ZodValidationPipe(schema)

    expect(() => pipe.transform(undefined)).toThrow(ValidationError)
    expect(() => pipe.transform('a string')).toThrow(ValidationError)
  })
})
