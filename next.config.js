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
  // Security headers are set in middleware.ts instead of here
  // This allows dynamic X-Frame-Options based on route (SAMEORIGIN for preview, DENY for others)
};

module.exports = nextConfig;
