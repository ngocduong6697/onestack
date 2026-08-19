import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 256 bits. Long enough that guessing is not a threat model. */
const TOKEN_BYTES = 32

export function createSessionToken(): string {
  // randomBytes, never Math.random: this value is the credential.
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * SHA-256 rather than argon2, deliberately. The token is already 256 random
 * bits, so there is no guessable structure for a slow hash to protect — and
 * this runs on every authenticated request, where argon2 would cost 50ms.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison, for the places a digest is compared in memory. */
export function digestsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')

  if (a.length !== b.length || a.length === 0) return false

  return timingSafeEqual(a, b)
}
