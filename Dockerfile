# === Build stage ===
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and Prisma schema first
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install dependencies (postinstall will run prisma generate)
RUN npm ci

# Copy source code
COPY . .

# Build Next.js app
RUN npm run build

# === Runtime stage ===
FROM node:20-alpine AS runner
WORKDIR /app

# Install dumb-init and OpenSSL 1.1 compatibility for Prisma
RUN apk add --no-cache dumb-init curl openssl1.1-compat

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built app from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Create storage directories
RUN mkdir -p storage uploads && chown -R nextjs:nodejs storage uploads

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Run with dumb-init to handle signals
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
