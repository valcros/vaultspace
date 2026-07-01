/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  serverExternalPackages: ['bullmq', 'ioredis', 'nodemailer'],
  // Standalone output for Docker
  output: 'standalone',
  // Security headers are set in middleware.ts instead of here
  // This allows dynamic X-Frame-Options based on route (SAMEORIGIN for preview, DENY for others)
};

module.exports = nextConfig;
