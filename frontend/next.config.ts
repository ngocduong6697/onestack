import type { NextConfig } from 'next'
import { securityHeaders } from './src/lib/security-headers'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keeps the runtime image to the server bundle instead of the whole tree.
  output: 'standalone',
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({
          // Read at build time, which is also when NEXT_PUBLIC_API_URL is
          // inlined into the client bundle.
          apiUrl: process.env.NEXT_PUBLIC_API_URL,
          isDevelopment: process.env.NODE_ENV !== 'production',
        }),
      },
    ]
  },
}

export default nextConfig
