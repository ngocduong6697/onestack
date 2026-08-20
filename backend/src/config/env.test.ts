import { describe, expect, it } from 'vitest'
import { loadEnv } from './env'

const base = { DATABASE_URL: 'postgres://user:pw@localhost:5432/db' }

describe('provider keys', () => {
  it('is happy with none of them set', () => {
    const env = loadEnv({ ...base })

    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.GOOGLE_API_KEY).toBeUndefined()
  })

  /**
   * The case that actually bites: `.env.example` ships `ANTHROPIC_API_KEY=`,
   * so anyone who copies it has an empty string, not an absent variable.
   */
  it.each([[''], ['   ']])('treats %o as absent rather than invalid', (value) => {
    const env = loadEnv({ ...base, ANTHROPIC_API_KEY: value })

    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('boots with every key blank, as a fresh .env would have them', () => {
    expect(() =>
      loadEnv({ ...base, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GOOGLE_API_KEY: '' }),
    ).not.toThrow()
  })

  it('keeps a real key', () => {
    expect(loadEnv({ ...base, ANTHROPIC_API_KEY: 'sk-ant-real' }).ANTHROPIC_API_KEY).toBe(
      'sk-ant-real',
    )
  })

  it('still refuses a missing DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/)
  })
})
