# === Build stage ===
FROM node:20-slim AS builder
WORKDIR /app

# Pass --build-arg DEPLOYMENT_MODE=standalone for self-hosted installs.
# Default is azure (fail-closed); do not change the default here.
ARG DEPLOYMENT_MODE=azure
ENV DEPLOYMENT_MODE=${DEPLOYMENT_MODE}

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy package files and Prisma schema first
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install dependencies (postinstall will run prisma generate)
RUN npm ci

# Copy source code
COPY . .

# Release identifier from the CI/CD pipeline (the deploy git SHA), surfaced in
# the app's About page via next.config.js. Empty for local/dev builds.
ARG APP_RELEASE=
ENV APP_RELEASE=${APP_RELEASE}

# Build Next.js app
RUN npm run build

# === Runtime stage ===
FROM node:20-slim AS runner
WORKDIR /app

# Install dumb-init, curl, OpenSSL for Prisma, PostgreSQL client for RLS,
# and fonts for Sharp SVG text rendering in thumbnails
RUN apt-get update && apt-get install -y \
    dumb-init curl openssl postgresql-client fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Deployment mode (can be overridden at runtime)
ARG DEPLOYMENT_MODE=azure
ENV DEPLOYMENT_MODE=${DEPLOYMENT_MODE}

# Create non-root user
RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid nodejs nextjs

# Copy built app from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin

# The entrypoint runs `node scripts/run-prisma-migrate-deploy.mjs` for migrations,
# which imports the sibling scripts/migration-startup-gucs.mjs. Neither is part of
# the Next standalone trace, so copy ONLY those two modules. Backup, restore,
# RLS-fix, certificate, setup, and diagnostic tooling must NOT ship in the
# production web runtime image.
COPY --from=builder /app/scripts/run-prisma-migrate-deploy.mjs ./scripts/run-prisma-migrate-deploy.mjs
COPY --from=builder /app/scripts/migration-startup-gucs.mjs ./scripts/migration-startup-gucs.mjs

# Narrow runtime-image assertion (build time only; starts no migrations and needs
# no database): the two entrypoint migration modules exist and scripts/ contains
# ONLY them.
RUN test -f scripts/run-prisma-migrate-deploy.mjs \
  && test -f scripts/migration-startup-gucs.mjs \
  && [ "$(ls -1 scripts | wc -l)" -eq 2 ]

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create storage directories
RUN mkdir -p storage uploads && chown -R nextjs:nodejs storage uploads

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Run with dumb-init to handle signals, using entrypoint for migrations
ENTRYPOINT ["/usr/bin/dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "server.js"]
