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
        headers: securityHeaders({ isDevelopment: process.env.NODE_ENV !== 'production' }),
      },
    ]
  },
}

export default nextConfig
