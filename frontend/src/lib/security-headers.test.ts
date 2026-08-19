import { describe, expect, it } from 'vitest'
import { apiOrigin, securityHeaders } from './security-headers'

const csp = (apiUrl: string | undefined, isDevelopment = false) =>
  securityHeaders({ apiUrl, isDevelopment }).find(
    (header) => header.key === 'Content-Security-Policy',
  )!.value

const directive = (value: string, name: string) =>
  value.split('; ').find((entry) => entry.startsWith(name))

describe('apiOrigin', () => {
  it('keeps only the origin, dropping any path', () => {
    expect(apiOrigin('https://api.onestack.test/v1/health')).toBe('https://api.onestack.test')
  })

  it.each([undefined, '', 'not a url'])('falls back to null for %o', (value) => {
    expect(apiOrigin(value)).toBeNull()
  })
})

describe('securityHeaders', () => {
  /**
   * The bug this guards: with connect-src locked to 'self', the first fetch to
   * the API from the browser is blocked and the failure looks like a network
   * error, not a policy one.
   */
  it('lets the browser reach the API origin', () => {
    expect(directive(csp('https://api.onestack.test'), 'connect-src')).toBe(
      "connect-src 'self' https://api.onestack.test",
    )
  })

  it('stays same-origin when the API url is missing or malformed', () => {
    expect(directive(csp(undefined), 'connect-src')).toBe("connect-src 'self'")
    expect(directive(csp('not a url'), 'connect-src')).toBe("connect-src 'self'")
  })

  it('allows unsafe-eval in development only', () => {
    expect(directive(csp(undefined, true), 'script-src')).toContain("'unsafe-eval'")
    expect(directive(csp(undefined, false), 'script-src')).not.toContain("'unsafe-eval'")
  })

  it('refuses to be framed', () => {
    const headers = securityHeaders({ apiUrl: undefined, isDevelopment: false })

    expect(headers.find((header) => header.key === 'X-Frame-Options')?.value).toBe('DENY')
    expect(directive(csp(undefined), 'frame-ancestors')).toBe("frame-ancestors 'none'")
  })
})
