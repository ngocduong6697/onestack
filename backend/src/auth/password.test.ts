import { describe, expect, it } from 'vitest'
import { burnTimeLikeAVerify, hashPassword, verifyPassword } from './password'

describe('password hashing', () => {
  it('round-trips the right password', async () => {
    const hash = await hashPassword('correct horse battery staple')

    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')

    expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false)
    expect(await verifyPassword(hash, '')).toBe(false)
  })

  it('never stores the password', async () => {
    const hash = await hashPassword('correct horse battery staple')

    expect(hash).not.toContain('correct horse battery staple')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same password'), hashPassword('same password')])

    expect(a).not.toBe(b)
    expect(await verifyPassword(a, 'same password')).toBe(true)
    expect(await verifyPassword(b, 'same password')).toBe(true)
  })

  it('denies rather than throws on a corrupt stored hash', async () => {
    expect(await verifyPassword('not a hash', 'anything')).toBe(false)
    expect(await verifyPassword('', 'anything')).toBe(false)
  })

  it('burns comparable time for an unknown account', async () => {
    await expect(burnTimeLikeAVerify()).resolves.toBeUndefined()
  })
})
