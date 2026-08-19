import type { CookieOptions } from 'express'
import type { Env } from '../config/env'

export const SESSION_COOKIE = 'onestack_session'

/**
 * httpOnly so XSS cannot read the token; SameSite=Lax so a cross-site form
 * post cannot ride the session; Secure everywhere except local development,
 * where there is no TLS to be secure over.
 */
export function sessionCookieOptions(env: Env, expiresAt?: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  }
}
