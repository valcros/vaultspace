/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Enable instrumentation for Azure-only runtime guard
  experimental: {
    instrumentationHook: true,
    serverActions: {
      bodySizeLimit: '500mb',
    },
    serverComponentsExternalPackages: ['bullmq', 'ioredis', 'nodemailer'],
  },
  // Standalone output for Docker
  output: 'standalone',
  // Headers for security
  // Note: Preview routes override X-Frame-Options to SAMEORIGIN in their route handlers
  // to allow iframe embedding for document preview dialogs
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
