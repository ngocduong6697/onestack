import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIE = 'onestack_session'

/**
 * Keeps signed-out visitors on /login and signed-in ones off it.
 *
 * This only checks that a cookie is *present* — whether it is valid is the
 * API's business, and asking it here would mean a round trip on every asset
 * request. A stale cookie gets as far as a page, which then redirects.
 */
export function middleware(request: NextRequest) {
  const signedIn = Boolean(request.cookies.get(SESSION_COOKIE)?.value)
  const onLogin = request.nextUrl.pathname === '/login'

  if (!signedIn && !onLogin) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (signedIn && onLogin) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // Everything except the proxy, Next's own assets and static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
