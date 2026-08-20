import { NextResponse, type NextRequest } from 'next/server'
import { apiUrl } from '@/lib/api'

/**
 * The one place the browser's requests reach the API.
 *
 * Everything the browser sends goes to this app's own origin, so the session
 * cookie lives on one origin, CSP stays `connect-src 'self'`, and there is no
 * CORS to configure. In production this is what nginx would do; here it keeps
 * development and production the same shape.
 */

/**
 * Forwarded deliberately, rather than passing everything through. A client
 * that could set arbitrary headers on an internal request could smuggle one
 * the API trusts.
 */
const FORWARD_TO_API = ['content-type', 'cookie', 'user-agent', 'accept']
const FORWARD_TO_BROWSER = ['content-type', 'set-cookie']

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const target = apiUrl(`/${path.join('/')}${request.nextUrl.search}`)

  const headers = new Headers()
  for (const name of FORWARD_TO_API) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  const response = await fetch(target, {
    method: request.method,
    headers,
    // GET and HEAD have no body; passing one is a runtime error.
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
    redirect: 'manual',
  })

  const out = new NextResponse(await response.text(), { status: response.status })

  for (const name of FORWARD_TO_BROWSER) {
    // getSetCookie keeps multiple cookies separate; get() would join them.
    if (name === 'set-cookie') {
      for (const cookie of response.headers.getSetCookie()) {
        out.headers.append('set-cookie', cookie)
      }
      continue
    }

    const value = response.headers.get(name)
    if (value) out.headers.set(name, value)
  }

  return out
}

type Context = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path)
}

export async function POST(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path)
}

export async function PATCH(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path)
}

export async function DELETE(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path)
}
