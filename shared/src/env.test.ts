import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { csvSchema, parseEnv, portSchema } from './env'

describe('portSchema', () => {
  it('coerces a string port', () => {
    expect(portSchema.parse('4000')).toBe(4000)
  })

  it.each(['0', '70000', 'not-a-port'])('rejects %s', (value) => {
    expect(() => portSchema.parse(value)).toThrow()
  })
})

describe('csvSchema', () => {
  it('splits and trims, dropping empties', () => {
    expect(csvSchema.parse('http://a.test, http://b.test,')).toEqual([
      'http://a.test',
      'http://b.test',
    ])
  })
})

describe('parseEnv', () => {
  const schema = z.object({ API_PORT: portSchema, DATABASE_URL: z.string().url() })

  it('returns typed values for a valid environment', () => {
    const env = parseEnv(schema, {
      API_PORT: '4000',
      DATABASE_URL: 'postgres://user:pw@localhost:5432/db',
    })

    expect(env).toEqual({ API_PORT: 4000, DATABASE_URL: 'postgres://user:pw@localhost:5432/db' })
  })

  it('names every offending variable', () => {
    expect(() => parseEnv(schema, { API_PORT: '99999', DATABASE_URL: 'nope' })).toThrow(
      /API_PORT[\s\S]*DATABASE_URL/,
    )
  })
})
