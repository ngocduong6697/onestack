/**
 * The site's security headers, kept out of next.config.ts so they can be
 * tested. The API sends its own via helmet; these cover the site.
 */

export function securityHeaders(options: { isDevelopment: boolean }): {
  key: string
  value: string
}[] {
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
        /**
         * Same-origin, and deliberately so. TASK-015 moved every browser
         * request behind this app's own /api proxy, so there is no second
         * origin to allow — and a policy that still named one would be wider
         * than the application needs.
         */
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    },
  ]
}
