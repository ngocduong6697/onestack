/**
 * The site's security headers, kept out of next.config.ts so they can be
 * tested. The API sends its own via helmet; these cover the site.
 */

/** Extracts the origin the browser is allowed to call, ignoring a bad value. */
export function apiOrigin(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null

  try {
    return new URL(rawUrl).origin
  } catch {
    // A malformed value degrades to same-origin. Emitting a broken directive
    // would make the browser reject the whole policy, which is worse.
    return null
  }
}

export function securityHeaders(options: {
  apiUrl: string | undefined
  isDevelopment: boolean
}): { key: string; value: string }[] {
  const origin = apiOrigin(options.apiUrl)

  return [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    },
    {
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        // Next injects an inline bootstrap script, so 'unsafe-inline' stays
        // until a nonce is threaded through. 'unsafe-eval' is development-only
        // and not optional there: the dev bundler wraps modules in eval().
        `script-src 'self' 'unsafe-inline'${options.isDevelopment ? " 'unsafe-eval'" : ''}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        // The browser calls the API on another origin; CSP has to name it.
        `connect-src 'self'${origin ? ` ${origin}` : ''}`,
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    },
  ]
}
