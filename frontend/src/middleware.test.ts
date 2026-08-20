import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

const request = (path: string, signedIn: boolean) => {
  const req = new NextRequest(new URL(`http://localhost:3000${path}`))

  if (signedIn) req.cookies.set('onestack_session', 'a-token')

  return req
}

describe('middleware', () => {
  it('sends a signed-out visitor to the login page', () => {
    const response = middleware(request('/', false))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
  })

  it('leaves a signed-out visitor on the login page', () => {
    const response = middleware(request('/login', false))

    expect(response.headers.get('location')).toBeNull()
  })

  it('sends a signed-in visitor away from the login page', () => {
    const response = middleware(request('/login', true))

    expect(response.headers.get('location')).toMatch(/localhost:3000\/$/)
  })

  it('lets a signed-in visitor through to the dashboard', () => {
    const response = middleware(request('/', true))

    expect(response.headers.get('location')).toBeNull()
  })

  it('keeps the rest of the URL when redirecting', () => {
    const response = middleware(request('/somewhere', false))

    expect(response.headers.get('location')).toBe('http://localhost:3000/login')
  })

  /**
   * Presence only. Whether the cookie is valid is the API's business, and
   * asking it here would mean a round trip on every request.
   */
  it('treats an empty cookie as signed out', () => {
    const req = new NextRequest(new URL('http://localhost:3000/'))
    req.cookies.set('onestack_session', '')

    expect(middleware(req).headers.get('location')).toContain('/login')
  })
})
