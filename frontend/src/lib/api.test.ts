import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

const { apiUrl, readResult } = await import('./api')

describe('apiUrl', () => {
  it('builds a URL against the configured API', () => {
    expect(apiUrl('/orgs')).toBe('http://localhost:4000/orgs')
  })

  it('tolerates a missing leading slash', () => {
    expect(apiUrl('orgs')).toBe('http://localhost:4000/orgs')
  })

  it('keeps a query string', () => {
    expect(apiUrl('/orgs?limit=5')).toBe('http://localhost:4000/orgs?limit=5')
  })

  /**
   * The path can come from a request, so the invariant that matters is not
   * "it throws" but "it never points anywhere else". A protocol-relative path
   * escapes and is refused; an absolute one is flattened into a harmless path
   * by the leading-slash rule. Both are asserted as the same property.
   */
  it.each([
    ['//evil.test/steal'],
    ['https://evil.test/steal'],
    ['/../../orgs'],
    ['/orgs/../../../etc/passwd'],
  ])('never builds a URL outside the API for %s', (path) => {
    let built: string | null = null

    try {
      built = apiUrl(path)
    } catch {
      // Refusing outright is also an acceptable outcome.
      return
    }

    expect(new URL(built).origin).toBe('http://localhost:4000')
  })

  it('refuses a protocol-relative path outright', () => {
    expect(() => apiUrl('//evil.test/steal')).toThrow(/outside the configured API/)
  })
})

describe('readResult', () => {
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('reads a successful body', async () => {
    const result = await readResult<{ id: string }>(jsonResponse(200, { id: 'x' }))

    expect(result).toEqual({ ok: true, status: 200, data: { id: 'x' }, error: null })
  })

  it('surfaces the API error message', async () => {
    const result = await readResult(
      jsonResponse(401, { error: { code: 'unauthorized', message: 'Invalid email or password' } }),
    )

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Invalid email or password')
  })

  it('falls back when the body is not the shape it expected', async () => {
    const result = await readResult(new Response('not json', { status: 500 }))

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Something went wrong')
  })

  it('handles an empty body', async () => {
    const result = await readResult(new Response(null, { status: 204 }))

    expect(result).toEqual({ ok: true, status: 204, data: null, error: null })
  })
})
