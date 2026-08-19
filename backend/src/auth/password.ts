import { hash, verify } from '@node-rs/argon2'

/**
 * OWASP's minimum argon2id parameters. Deliberately slow: only register and
 * login pay this cost, never an authenticated request.
 */
const OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS)
}

/**
 * Returns false rather than throwing on a malformed stored hash: a corrupt row
 * should deny access, not turn a login into a 500 that says the row is corrupt.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, OPTIONS)
  } catch {
    return false
  }
}

/**
 * A hash of a value nobody can log in with, used to spend the same CPU time on
 * an unknown email as on a real one. Without it, "no such account" returns in
 * a millisecond and "wrong password" in fifty, which is an account enumeration
 * oracle any script can read.
 */
let dummyHash: string | null = null

export async function burnTimeLikeAVerify(): Promise<void> {
  dummyHash ??= await hashPassword('a password nobody has, used only for timing')
  await verifyPassword(dummyHash, 'not the password')
}
