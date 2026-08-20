import { cookies } from 'next/headers'

/**
 * The API's address is a server-side fact. It is deliberately not
 * `NEXT_PUBLIC_`: the browser never addresses the API, so publishing where it
 * lives would only widen what an attacker can see.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000'

export function apiUrl(path: string): string {
  // Refuse to construct anything outside the configured base, so a path that
  // came from a request cannot redirect this fetch somewhere else.
  const url = new URL(path.startsWith('/') ? path : `/${path}`, API_URL)

  if (url.origin !== new URL(API_URL).origin) {
    throw new Error('Refusing to call outside the configured API')
  }

  return url.toString()
}

export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

/**
 * Calls the API from a server component, forwarding the session cookie from
 * the incoming request. The token stays on the server: it is never serialised
 * into the page or handed to client JavaScript.
 */
export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const jar = await cookies()

  const response = await fetch(apiUrl(path), {
    headers: { cookie: jar.toString() },
    // Per-session data. Caching it would show one person another's numbers.
    cache: 'no-store',
  })

  return readResult<T>(response)
}

export async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const text = await response.text()
  let body: unknown = null

  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? ((body as { error: { message?: string } }).error?.message ?? 'Something went wrong')
        : 'Something went wrong'

    return { ok: false, status: response.status, data: null, error: message }
  }

  return { ok: true, status: response.status, data: body as T, error: null }
}
