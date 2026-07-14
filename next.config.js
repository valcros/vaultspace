/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
    // Allow large document uploads. Next buffers the request body to a low
    // default (~10MB) for any route the middleware runs on, which truncates
    // larger uploads and breaks multipart parsing. Match MAX_FILE_SIZE_BYTES
    // (500MB). Only proxyClientMaxBodySize may be set (its deprecated alias
    // middlewareClientMaxBodySize cannot be set at the same time).
    proxyClientMaxBodySize: '500mb',
  },
  serverExternalPackages: ['bullmq', 'ioredis', 'nodemailer'],
  // Standalone output for Docker
  output: 'standalone',
  // Security headers are set in middleware.ts instead of here
  // This allows dynamic X-Frame-Options based on route (SAMEORIGIN for preview, DENY for others)
};

module.exports = nextConfig;
