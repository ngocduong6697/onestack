import { afterEach, describe, expect, it } from 'vitest'
import { providersFromEnv } from './providers.factory'

/**
 * Which providers exist depends entirely on which keys are set, and coverage
 * showed only a quarter of those branches were exercised.
 */
const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY'] as const

const original = { ...process.env }

afterEach(() => {
  process.env = { ...original }
})

function withKeys(keys: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, keys)
  process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/db'
}

describe('providersFromEnv', () => {
  it('builds nothing when no key is set', () => {
    withKeys({})

    expect([...providersFromEnv().keys()]).toEqual([])
  })

  it.each([
    ['ANTHROPIC_API_KEY', 'anthropic'],
    ['OPENAI_API_KEY', 'openai'],
    ['GOOGLE_API_KEY', 'google'],
  ] as const)('builds %s alone as %s', (key, provider) => {
    withKeys({ [key]: 'a-key' })

    expect([...providersFromEnv().keys()]).toEqual([provider])
  })

  it('builds all three when all three are set', () => {
    withKeys({
      ANTHROPIC_API_KEY: 'a',
      OPENAI_API_KEY: 'b',
      GOOGLE_API_KEY: 'c',
    })

    expect([...providersFromEnv().keys()].sort()).toEqual(['anthropic', 'google', 'openai'])
  })

  /** The bug TASK-012 found live: `.env` files are written as `KEY=`. */
  it('treats an empty key as absent', () => {
    withKeys({ ANTHROPIC_API_KEY: '', OPENAI_API_KEY: 'real' })

    expect([...providersFromEnv().keys()]).toEqual(['openai'])
  })
})
