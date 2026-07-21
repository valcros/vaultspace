// package.json is the single source of truth for the app version. next.config
// runs in a CommonJS context, so require is the correct, deterministic way to
// read it (independent of whether the build was invoked via an npm script).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('./package.json');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Surface the build/release identity to the app (e.g. Settings > About) so the
  // version is never hand-maintained. APP_VERSION is the single source of truth
  // in package.json; APP_RELEASE is injected by the CI/CD pipeline (the deploy
  // git SHA) via a Docker build arg, and is empty for local/dev builds. Both are
  // inlined at build time, so they are safe to read from client components.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_APP_RELEASE: process.env.APP_RELEASE || '',
  },
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
  serverExternalPackages: ['bullmq', 'ioredis', 'nodemailer', 'sharp'],
  // Standalone output for Docker
  output: 'standalone',
  // Security headers are set in middleware.ts instead of here
  // This allows dynamic X-Frame-Options based on route (SAMEORIGIN for preview, DENY for others)
};

module.exports = nextConfig;
