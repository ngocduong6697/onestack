import { describe, expect, it } from 'vitest'
import { securityHeaders } from './security-headers'

const csp = (isDevelopment = false) =>
  securityHeaders({ isDevelopment }).find((header) => header.key === 'Content-Security-Policy')!
    .value

const directive = (value: string, name: string) =>
  value.split('; ').find((entry) => entry.startsWith(name))

describe('securityHeaders', () => {
  /**
   * TASK-015 moved every browser request behind this app's own /api proxy, so
   * there is no second origin to allow. Asserted exactly, so re-widening the
   * policy has to be a deliberate edit to this test.
   */
  it('allows connections to this origin only', () => {
    expect(directive(csp(), 'connect-src')).toBe("connect-src 'self'")
  })

  it('names no external host in any directive', () => {
    expect(csp()).not.toMatch(/https?:\/\/[^\s;]+/)
  })

  it('allows unsafe-eval in development only', () => {
    expect(directive(csp(true), 'script-src')).toContain("'unsafe-eval'")
    expect(directive(csp(false), 'script-src')).not.toContain("'unsafe-eval'")
  })

  it('refuses to be framed', () => {
    const headers = securityHeaders({ isDevelopment: false })

    expect(headers.find((header) => header.key === 'X-Frame-Options')?.value).toBe('DENY')
    expect(directive(csp(), 'frame-ancestors')).toBe("frame-ancestors 'none'")
  })
})
