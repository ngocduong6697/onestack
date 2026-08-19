import { describe, expect, it } from 'vitest'
import { createSessionToken, digestsMatch, hashSessionToken } from './tokens'

describe('session tokens', () => {
  it('carries 256 bits of entropy', () => {
    // 32 bytes, base64url encoded, unpadded.
    expect(Buffer.from(createSessionToken(), 'base64url')).toHaveLength(32)
  })

  it('is distinct across a burst', () => {
    const tokens = new Set(Array.from({ length: 1000 }, createSessionToken))

    expect(tokens.size).toBe(1000)
  })

  it('is url-safe, so it survives a cookie unescaped', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(createSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  /** The point of the design: the database holds nothing presentable. */
  it('stores a digest, never the token', () => {
    const token = createSessionToken()
    const digest = hashSessionToken(token)

    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).not.toBe(token)
    expect(digest).not.toContain(token)
  })

  it('is deterministic, so a cookie can be looked up', () => {
    const token = createSessionToken()

    expect(hashSessionToken(token)).toBe(hashSessionToken(token))
  })

  describe('digestsMatch', () => {
    it('matches equal digests and rejects different ones', () => {
      const digest = hashSessionToken('a')

      expect(digestsMatch(digest, hashSessionToken('a'))).toBe(true)
      expect(digestsMatch(digest, hashSessionToken('b'))).toBe(false)
    })

    it('rejects empty and malformed input instead of matching it', () => {
      expect(digestsMatch('', '')).toBe(false)
      expect(digestsMatch('abc', 'abcd')).toBe(false)
    })
  })
})
