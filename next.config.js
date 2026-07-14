/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Allow large document uploads through middleware. Without this, Next buffers
  // the request body to a low default (~10MB) for any route the middleware runs
  // on, truncating larger uploads and breaking multipart parsing. Match the app's
  // MAX_FILE_SIZE_BYTES so uploads are bounded only by the document size limit.
  middlewareClientMaxBodySize: '500mb',
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
