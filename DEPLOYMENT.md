# VaultSpace Deployment Guide (F155)

**Table of Contents**

- [Overview](#overview)
- [Deployment Stages](#deployment-stages)
- [Docker Configuration](#docker-configuration)
- [Environment Variables](#environment-variables)
- [Worker and Queue Model](#worker-and-queue-model)
- [Networking and Security](#networking-and-security)
- [Azure Reference Architecture](#azure-reference-architecture)
- [Backup and Recovery](#backup-and-recovery)
- [Monitoring and Observability](#monitoring-and-observability)
- [Upgrade Strategy](#upgrade-strategy)
- [Troubleshooting](#troubleshooting)
- [Appendix A: Non-Azure Reference Configurations](#appendix-a-non-azure-reference-configurations) _(unsupported)_

---

## Overview

VaultSpace supports two deployment modes:

- **Azure Mode** (default): Full Azure infrastructure with all features enabled
- **Standalone Mode**: Self-hosted deployment with flexible infrastructure choices

VaultSpace deployment philosophy prioritizes **security by default** and **scalability when needed**. The platform supports:

- **Azure Deployment**: Azure Container Apps (dev/staging) or AKS (production)
- **Standalone Deployment**: Self-hosted with PostgreSQL, Redis (optional), S3-compatible or local storage

### Key Principles

1. **Flexible infrastructure** - Deploy on Azure or self-hosted infrastructure
2. **Stateless application layer** - Multiple app instances can run behind a load balancer with zero coordination
3. **Background workers** - Heavy lifting (preview generation, virus scanning, exports) runs in dedicated worker processes
4. **Private infrastructure** - Database, Redis, and workers are never publicly exposed
5. **Standard container practices** - Multi-stage Dockerfiles, secrets via environment variables, health checks
6. **Graceful degradation** - Missing optional services degrade features without blocking core functionality

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for system design details.

---

## Deployment Stages

### 1. Development / Staging (Azure Container Apps)

**Use case:** Integration testing, staging environment, cloud-native evaluation.

**Recommended: Azure Container Apps** (simple, cost-effective, not yet production-grade AKS)

**Components:**

- Azure Container Apps (stateless app tier)
- Azure Container Apps Jobs or dedicated worker containers
- Azure Database for PostgreSQL Flexible Server
- Azure Cache for Redis
- Azure Blob Storage
- Azure Front Door or Application Gateway (TLS termination)

**Why Container Apps for dev/test?**

- Dramatically simpler than AKS
- Managed scaling (easier CPU/memory tuning than pods)
- Lower operational overhead
- Pay-as-you-go pricing ($0.05/vCPU-hour)
- Easy to graduate to AKS later

**Sizing guidance:**

- **App tier:** 1-2 vCPU, 2GB memory (auto-scale 2–4 replicas)
- **Database:** B_Standard_B2s (2 vCPU, 4GB) — auto-scale storage
- **Redis:** Basic tier, 1GB
- **Storage:** Standard LRS, lifecycle to cool after 30 days

**Typical monthly cost (dev):** $150–300 USD

---

### 3. Production

**Use case:** Mission-critical deployments requiring high availability and complex scaling.

**Recommended: Azure Kubernetes Service (AKS)** or equivalent (AWS EKS, GCP GKE).

**Components:**

- Kubernetes cluster (3+ nodes for HA)
- Separate app pool (stateless Web tier)
- Separate worker pools (by workload: general, preview, scan)
- Managed PostgreSQL with automated backups
- Managed Redis (Premium for HA)
- Private Blob Storage with lifecycle policies
- Application load balancer (ALB / Azure Load Balancer)
- Azure Front Door for DDoS protection and TLS
- Network policies restricting inter-pod traffic
- OpenTelemetry collection to centralized logging

**Sizing guidance:**

- **App tier:** 2–4 nodes, 4+ vCPU each, 16GB+ memory per node
- **Preview worker pool:** 2–8 nodes (CPU-optimized), auto-scaled on job queue depth
- **General worker pool:** 1–4 nodes
- **Database:** Production tier with read replicas for analytics
- **Redis:** Premium tier (6GB+) for HA and persistence
- **Storage:** Premium LRS with geo-redundancy option

**Typical monthly cost (production):** $2,000–5,000+ USD depending on usage.

---

## Standalone Deployment Mode

VaultSpace supports self-hosted deployment via `DEPLOYMENT_MODE=standalone`. This mode allows flexible infrastructure choices while maintaining security standards.

### Enabling Standalone Mode

Set the environment variable:

```bash
DEPLOYMENT_MODE=standalone
```

Without this variable, VaultSpace defaults to Azure mode and enforces Azure service requirements.

### Infrastructure Requirements

| Component             | Required    | Options                                | Notes                                           |
| --------------------- | ----------- | -------------------------------------- | ----------------------------------------------- |
| PostgreSQL 15+        | Yes         | Any provider                           | Azure, AWS RDS, self-hosted                     |
| Redis                 | Recommended | Any provider                           | Required for async features (jobs, previews)    |
| S3-compatible storage | Option A    | MinIO, Backblaze B2, DO Spaces, AWS S3 | Full production support                         |
| Local filesystem      | Option B    | Docker volume, NFS                     | Single-node only, manual backups                |
| Gotenberg             | Recommended | Container sidecar                      | Required for Office document previews           |
| ClamAV                | Optional    | Container sidecar                      | Uploads proceed without scanning if unavailable |
| SMTP                  | Yes         | Any provider                           | Required for notifications                      |

### Capabilities Matrix

Standalone mode uses a capabilities system to gracefully handle missing services:

| Capability                 | Requires          | Behavior When Unavailable                   |
| -------------------------- | ----------------- | ------------------------------------------- |
| `canQueueJobs`             | Redis             | Async operations return 503                 |
| `canGenerateAsyncPreviews` | Redis + Gotenberg | Preview endpoint returns 503                |
| `canGenerateSyncPreviews`  | Sharp (bundled)   | Always available for images                 |
| `canRunVirusScanning`      | Redis + ClamAV    | Uploads proceed, documents marked unscanned |
| `canSendAsyncEmail`        | Redis             | Falls back to sync email                    |
| `canSendSyncEmail`         | SMTP              | Always available if SMTP configured         |
| `canRunScheduledReports`   | Redis             | Scheduled reports return 503                |
| `canRunBulkExport`         | Redis             | Bulk export returns 503                     |

### Health Check Response

The `/api/health` endpoint reports deployment status:

```json
{
  "status": "healthy",
  "mode": "standalone",
  "capabilities": {
    "canQueueJobs": true,
    "canGenerateAsyncPreviews": true,
    "canRunVirusScanning": false,
    "canSendAsyncEmail": true,
    "canSendSyncEmail": true
  },
  "degraded": ["canRunVirusScanning"]
}
```

Degraded capabilities do not fail the health check. Only infrastructure failures (database, storage) result in unhealthy status.

### Standalone with Full Features

For production standalone deployments with all features:

```bash
# Core
DEPLOYMENT_MODE=standalone
DATABASE_URL=postgresql://user:pass@postgres:5432/vaultspace
REDIS_URL=redis://:password@redis:6379

# Storage (S3-compatible)
STORAGE_PROVIDER=s3
STORAGE_BUCKET=vaultspace
STORAGE_ENDPOINT=https://minio.example.com
STORAGE_KEY_ID=your-access-key
STORAGE_SECRET_KEY=your-secret-key

# Preview generation
PREVIEW_PROVIDER=gotenberg
GOTENBERG_URL=http://gotenberg:3000

# Virus scanning
SCAN_PROVIDER=clamav
CLAMAV_HOST=clamav
CLAMAV_PORT=3310

# Email
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASSWORD=your-password
```

### Standalone Minimal (Development/Testing)

For development or small deployments without async features:

```bash
DEPLOYMENT_MODE=standalone
DATABASE_URL=postgresql://user:pass@localhost:5432/vaultspace

# Local filesystem storage
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=./storage

# No Redis - async features unavailable
# Email - sync only
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
```

**Limitations without Redis:**

- Preview generation unavailable (returns 503)
- Virus scanning unavailable (uploads proceed unscanned)
- Bulk exports unavailable (returns 503)
- Scheduled reports unavailable (returns 503)
- Email sent synchronously (may timeout on slow SMTP)

### Security Considerations

**Virus scanning unavailable:**

- Documents are stored with `scanned: false` in the database
- Admin warning displayed in Settings > Security page
- One-time notification to tenant owner when creating rooms
- Startup log: `[Security] Virus scanning unavailable - uploads will not be scanned`

**Local filesystem storage:**

- Single-node only (no horizontal scaling)
- Manual backup responsibility
- Not suitable for HA deployments
- Signed URLs still enforced for all document access

### Development Scripts

Package.json includes standalone-aware scripts:

```bash
# Development
npm run dev:standalone              # Local dev server
npm run worker:standalone           # Local worker process

# Database (uses local PostgreSQL)
npm run db:migrate:dev              # Create migrations
npm run db:push                     # Push schema changes
npm run db:studio                   # Prisma Studio

# Testing
npm run test:integration:standalone # Integration tests against localhost
```

---

## Docker Configuration

> **Note:** These Dockerfiles are used to build container images for deployment to Azure Container Apps or AKS.
> They are not intended for local execution. Build images locally, push to Azure Container Registry, then deploy to Azure.

### Dockerfile (Application)

Production-ready multi-stage build for the Next.js application:

```dockerfile
# === Build stage ===
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install dependencies with frozen lockfile
RUN npm ci --only=production && npm ci

# Copy source code
COPY . .

# Build Next.js app
RUN npm run build

# === Runtime stage ===
FROM node:20-alpine
WORKDIR /app

# Install dumb-init to handle signals properly
RUN apk add --no-cache dumb-init

# Copy built app from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public

# Create non-root user
RUN addgroup -g 1001 nodejs && adduser -S nextjs -u 1001
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose port
EXPOSE 3000

# Run with dumb-init to handle signals
ENTRYPOINT ["/sbin/dumb-init", "--"]
CMD ["npm", "run", "start"]
```

### Dockerfile (Worker)

Background job worker using the same codebase but different entrypoint:

```dockerfile
# === Build stage (same as app) ===
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm ci

COPY . .
RUN npm run build

# === Runtime stage ===
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache dumb-init
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

RUN addgroup -g 1001 nodejs && adduser -S nextjs -u 1001
USER nextjs

# Set worker type via environment variable
ENV WORKER_TYPE=general

ENTRYPOINT ["/sbin/dumb-init", "--"]
CMD ["npm", "run", "worker"]
```

**Worker types** (passed via `WORKER_TYPE` env var):

- `general` - Email, webhooks, analytics aggregation, cleanup
- `preview` - Document preview generation (CPU-heavy, deserves dedicated scaling)
- `scan` - Virus scanning (I/O-heavy)
- `report` - Binder export, compliance packages, ZIP generation

### Dockerfile (Preview Service - Optional)

If using Gotenberg or LibreOffice in a separate container:

```dockerfile
# Use official Gotenberg image for document preview
FROM gotenberg/gotenberg:8.0

EXPOSE 3000
```

Or for LibreOffice standalone:

```dockerfile
FROM libreoffice/libreoffice:latest

EXPOSE 2002

CMD ["soffice", "--headless", "--accept=socket,host=0.0.0.0,port=2002;urp;", "--norestore", "--nolockcheck"]
```

### Service Dependencies Reference

For Azure Container Apps deployment, VaultSpace requires these services:

| Service      | Azure Service                                 | Purpose                     |
| ------------ | --------------------------------------------- | --------------------------- |
| PostgreSQL   | Azure Database for PostgreSQL Flexible Server | Primary database            |
| Redis        | Azure Cache for Redis                         | Job queue and caching       |
| Blob Storage | Azure Blob Storage                            | Document storage            |
| Gotenberg    | Container Apps sidecar                        | Document preview generation |
| ClamAV       | Container Apps sidecar                        | Virus scanning              |

See [Azure Reference Architecture](#azure-reference-architecture) for deployment patterns and the [Container Apps Deployment](#container-apps-deployment) section for specific Azure CLI commands.

> **Note:** A Docker Compose reference file showing service relationships is available in [Appendix A](#appendix-a-non-azure-reference-configurations) for those migrating from other platforms.

---

## Environment Variables

### Complete Reference

All environment variables used by VaultSpace. Required variables must be set; optional variables have safe defaults.

#### Core Application

| Variable           | Required | Default           | Example                          | Description                                                                                                                      |
| ------------------ | -------- | ----------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOYMENT_MODE`  | No       | `azure`           | `azure` or `standalone`          | Deployment mode. `azure` enforces Azure services; `standalone` allows flexible infrastructure.                                   |
| `NODE_ENV`         | Yes      | `production`      | `production` or `development`    | Runtime environment. Controls logging, bundling, and feature flags.                                                              |
| `APP_URL`          | Yes      | —                 | `https://dataroom.example.com`   | Full public URL of the application. Used in emails, webhooks, and client-side redirects. **Must match domain in cookies/HTTPS.** |
| `APP_NAME`         | No       | `VaultSpace`      | `ACME Data Room`                 | Display name shown in UI and emails.                                                                                             |
| `DEFAULT_ORG_NAME` | No       | `My Organization` | `Acme Corp`                      | Default organization name on first-run. Only used in single-org self-hosted installations.                                       |
| `SESSION_SECRET`   | Yes      | —                 | `your-random-secret-here`        | Secret key for session token HMAC. Generate with `openssl rand -base64 32`. **CRITICAL: use random value in production.**        |
| `LOG_LEVEL`        | No       | `info`            | `info`, `debug`, `warn`, `error` | Logging verbosity. Use `debug` for troubleshooting; `info` for production.                                                       |

#### Database

| Variable             | Required | Default | Example                                   | Description                                                                                                           |
| -------------------- | -------- | ------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Yes      | —       | `postgresql://user:pass@host:5432/dbname` | Full PostgreSQL connection string. Format: `postgresql://[user[:password]@][netloc][:port][/dbname][?param=value...]` |
| `DATABASE_POOL_SIZE` | No       | `10`    | `20`                                      | Maximum number of database connections in the pool. For app tier: 10–20. For workers: 3–5.                            |

#### Redis

| Variable    | Required    | Default | Example                                                 | Description                                                                                                                                                           |
| ----------- | ----------- | ------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL` | Conditional | —       | `rediss://:key@yourserver.redis.cache.windows.net:6380` | Redis connection string. Required in Azure mode. Optional in standalone mode (async features disabled without Redis). Format: `rediss://[:password@]host[:port][/db]` |
| `REDIS_TLS` | No          | `false` | `true`                                                  | Enable TLS for Redis connection. Required if using Azure Cache for Redis with SSL.                                                                                    |

#### Storage

| Variable                     | Required    | Default | Example                                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ----------- | ------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `STORAGE_PROVIDER`           | Yes         | `azure` | `azure`, `s3`, `local`                           | Storage backend. `azure` for Azure Blob Storage, `s3` for S3-compatible (AWS, MinIO, Backblaze), `local` for filesystem (standalone mode only).                                                                                                                                                                                                                                                                                                                                               |     |
| `STORAGE_LOCAL_PATH`         | Conditional | —       | `./storage`                                      | Filesystem path for document storage. Required for `STORAGE_PROVIDER=local`. Only available in standalone mode.                                                                                                                                                                                                                                                                                                                                                                               |
| `STORAGE_BUCKET`             | Conditional | —       | `vaultspace-prod`                                | Bucket/container name. Required for `s3` or `azure`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `STORAGE_REGION`             | Conditional | —       | `us-east-1`                                      | AWS region. Required for `STORAGE_PROVIDER=s3`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `STORAGE_ENDPOINT`           | No          | —       | `https://minio.example.com`                      | Custom S3-compatible endpoint. Use for MinIO, Backblaze B2, DigitalOcean Spaces, etc.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `STORAGE_KEY_ID`             | Conditional | —       | `AKIAIOSFODNN7EXAMPLE`                           | AWS access key ID. Required for `STORAGE_PROVIDER=s3`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `STORAGE_SECRET_KEY`         | Conditional | —       | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`       | AWS secret access key. Required for `STORAGE_PROVIDER=s3`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `AZURE_STORAGE_ACCOUNT_NAME` | Conditional | —       | `myaccount`                                      | Azure storage account name. Required for `STORAGE_PROVIDER=azure`.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `AZURE_STORAGE_ACCOUNT_KEY`  | Conditional | —       | `DefaultEndpointsProtocol=https;AccountName=...` | Azure storage account key or full connection string. Required for `STORAGE_PROVIDER=azure`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `STORAGE_PUBLIC_URLS`        | No          | `false` | `true`                                           | **WARNING: This setting applies ONLY to non-document static assets (logos, branding).** Document blobs MUST NEVER be served via public URLs. Document access is exclusively via signed URLs with 5-minute expiry (previews) or 1-hour expiry (downloads). Setting this to `true` does NOT make documents public. If you need to serve static branding assets from storage without signing, enable this. For all document operations, this setting is ignored and signed URLs are always used. |
| `STORAGE_CLEANUP_DAYS`       | No          | `30`    | `90`                                             | Days before permanent deletion of soft-deleted documents.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

#### Email

| Variable           | Required    | Default                    | Example                        | Description                                                                                          |
| ------------------ | ----------- | -------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `EMAIL_PROVIDER`   | Yes         | `smtp`                     | `smtp`, `sendgrid`, `resend`   | Email backend. `smtp` for on-premises SMTP servers. `sendgrid` or `resend` for third-party services. |
| `SMTP_HOST`        | Conditional | —                          | `smtp.example.com`             | SMTP server hostname. Required for `EMAIL_PROVIDER=smtp`.                                            |
| `SMTP_PORT`        | Conditional | `587`                      | `587` or `465`                 | SMTP port. 587 for TLS; 465 for implicit TLS. Required for `EMAIL_PROVIDER=smtp`.                    |
| `SMTP_USER`        | Conditional | —                          | `noreply@example.com`          | SMTP login username. Required for `EMAIL_PROVIDER=smtp`.                                             |
| `SMTP_PASSWORD`    | Conditional | —                          | `secret-password`              | SMTP login password. Required for `EMAIL_PROVIDER=smtp`.                                             |
| `SMTP_FROM`        | Yes         | `noreply@vaultspace.local` | `noreply@dataroom.example.com` | Sender address for all emails. Must be a real domain for deliverability.                             |
| `SMTP_TLS`         | No          | `true`                     | `true` or `false`              | Require TLS for SMTP. Set `false` only for unencrypted local servers.                                |
| `SENDGRID_API_KEY` | Conditional | —                          | `SG.1234567890abcdefg...`      | SendGrid API key. Required for `EMAIL_PROVIDER=sendgrid`. Generate in SendGrid dashboard.            |
| `RESEND_API_KEY`   | Conditional | —                          | `re_1234567890abcdefg...`      | Resend API key. Required for `EMAIL_PROVIDER=resend`.                                                |

#### Authentication & SSO

| Variable             | Required    | Default                | Example                             | Description                                                                             |
| -------------------- | ----------- | ---------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| `AUTH_PROVIDER`      | No          | `builtin`              | `builtin`, `oidc`, `saml`           | Authentication provider. `builtin` for email/password; `oidc` or `saml` for federation. |
| `OIDC_CLIENT_ID`     | Conditional | —                      | `my-app-id`                         | OpenID Connect client ID. Required for `AUTH_PROVIDER=oidc`.                            |
| `OIDC_CLIENT_SECRET` | Conditional | —                      | `secret-key`                        | OpenID Connect client secret. Required for `AUTH_PROVIDER=oidc`. **Keep secret.**       |
| `OIDC_PROVIDER_URL`  | Conditional | —                      | `https://auth.example.com`          | OpenID Connect provider base URL. Required for `AUTH_PROVIDER=oidc`.                    |
| `OIDC_SCOPES`        | No          | `openid profile email` | `openid profile email groups`       | Space-separated OIDC scopes to request from provider.                                   |
| `SAML_ENTITY_ID`     | Conditional | —                      | `https://dataroom.example.com/saml` | SAML entity ID (service provider). Required for `AUTH_PROVIDER=saml`.                   |
| `SAML_ENTRY_POINT`   | Conditional | —                      | `https://idp.example.com/saml`      | SAML identity provider entry point. Required for `AUTH_PROVIDER=saml`.                  |
| `SAML_CERT`          | Conditional | —                      | `-----BEGIN CERTIFICATE-----...`    | SAML IdP public certificate. Required for `AUTH_PROVIDER=saml`.                         |

#### Encryption

| Variable                       | Required    | Default | Example                          | Description                                                                                                                                                      |
| ------------------------------ | ----------- | ------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_PROVIDER`          | No          | `aes`   | `aes`, `vault`                   | Encryption key provider. `aes` for environment variable; `vault` for HashiCorp Vault.                                                                            |
| `ENCRYPTION_KEY`               | Conditional | —       | `your-base64-encoded-key`        | AES-256 encryption key (base64-encoded). Required for `ENCRYPTION_PROVIDER=aes`. Generate with `openssl rand -base64 32`. **CRITICAL: protect like a password.** |
| `VAULT_ADDR`                   | Conditional | —       | `https://vault.example.com:8200` | HashiCorp Vault server address. Required for `ENCRYPTION_PROVIDER=vault`.                                                                                        |
| `VAULT_TOKEN`                  | Conditional | —       | `s.1234567890abcdefg`            | Vault authentication token. Required for `ENCRYPTION_PROVIDER=vault`. Consider AppRole for production.                                                           |
| `ENCRYPTION_KEY_ROTATION_DAYS` | No          | `365`   | `90`                             | Days before requiring key rotation. Set to `0` to disable rotation reminders.                                                                                    |

#### Preview & Document Conversion

| Variable                       | Required    | Default     | Example                    | Description                                                                                       |
| ------------------------------ | ----------- | ----------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `PREVIEW_PROVIDER`             | Yes         | `gotenberg` | `gotenberg`, `libreoffice` | Document conversion backend. `gotenberg` for containerized service; `libreoffice` for in-process. |
| `GOTENBERG_URL`                | Conditional | —           | `http://gotenberg:3000`    | Gotenberg service URL. Required for `PREVIEW_PROVIDER=gotenberg`.                                 |
| `PREVIEW_TIMEOUT_SECONDS`      | No          | `60`        | `120`                      | Timeout for document conversion jobs. Increase for large/complex documents.                       |
| `PREVIEW_MAX_FILE_SIZE_MB`     | No          | `100`       | `500`                      | Maximum file size to attempt conversion. Files larger are marked unconvertible.                   |
| `PREVIEW_ENABLE_PDF_WATERMARK` | No          | `true`      | `true` or `false`          | Apply watermark overlay to PDF previews at render time.                                           |

#### Virus & Malware Scanning

| Variable               | Required    | Default        | Example               | Description                                                                                                 |
| ---------------------- | ----------- | -------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `SCAN_PROVIDER`        | No          | `clamav`       | `clamav`, `none`      | Virus scanner backend. `clamav` for ClamAV; `none` to disable scanning. **Never use `none` in production.** |
| `CLAMAV_HOST`          | Conditional | —              | `localhost` (sidecar) | ClamAV daemon hostname. Use `localhost` for sidecar container in Azure Container Apps.                      |
| `CLAMAV_PORT`          | Conditional | `3310`         | `3310`                | ClamAV daemon port. Required for `SCAN_PROVIDER=clamav`.                                                    |
| `SCAN_TIMEOUT_SECONDS` | No          | `30`           | `60`                  | Timeout for scan jobs. Increase if scanning is slow.                                                        |
| `SCAN_QUARANTINE_PATH` | No          | `./quarantine` | `/secure/quarantine`  | Local path to store quarantined files. Keep on encrypted storage.                                           |

#### Search Indexing

| Variable              | Required    | Default    | Example                   | Description                                                                                             |
| --------------------- | ----------- | ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SEARCH_PROVIDER`     | No          | `postgres` | `postgres`, `meilisearch` | Search backend. `postgres` uses PostgreSQL full-text search; `meilisearch` for dedicated search engine. |
| `MEILISEARCH_URL`     | Conditional | —          | `http://meilisearch:7700` | Meilisearch server URL. Required for `SEARCH_PROVIDER=meilisearch`.                                     |
| `MEILISEARCH_API_KEY` | Conditional | —          | `tnxUA12b6NqwXwXX...`     | Meilisearch admin API key. Required for `SEARCH_PROVIDER=meilisearch`.                                  |

#### Job Queue & Workers

| Variable                     | Required | Default      | Example           | Description                                                                               |
| ---------------------------- | -------- | ------------ | ----------------- | ----------------------------------------------------------------------------------------- |
| `JOB_QUEUE_ENABLED`          | No       | `true`       | `true` or `false` | Enable background job queue. Set `false` only for testing or single-instance deployments. |
| `JOB_QUEUE_PREFIX`           | No       | `vaultspace` | `dr-prod`         | Prefix for job queue keys in Redis. Allows multiple deployments on same Redis.            |
| `JOB_QUEUE_CONCURRENCY`      | No       | `5`          | `10`              | Number of concurrent jobs per worker process. Tune based on workload.                     |
| `PREVIEW_WORKER_CONCURRENCY` | No       | `2`          | `4`               | Concurrency for preview conversion jobs (CPU-bound, lower is safer).                      |
| `SCAN_WORKER_CONCURRENCY`    | No       | `5`          | `10`              | Concurrency for virus scan jobs (I/O-bound, can be higher).                               |
| `GENERAL_WORKER_CONCURRENCY` | No       | `10`         | `20`              | Concurrency for email, webhooks, cleanup (I/O-bound).                                     |

#### Monitoring & Observability

| Variable              | Required    | Default  | Example                      | Description                                                                              |
| --------------------- | ----------- | -------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `MONITORING_PROVIDER` | No          | `stdout` | `stdout`, `opentelemetry`    | Monitoring backend. `stdout` logs to console; `opentelemetry` to OTEL collector.         |
| `OTEL_ENDPOINT`       | Conditional | —        | `http://otel-collector:4317` | OpenTelemetry collector gRPC endpoint. Required for `MONITORING_PROVIDER=opentelemetry`. |
| `OTEL_HEADERS`        | No          | —        | `authorization=Bearer token` | Optional headers for OTEL collector (e.g., API keys).                                    |
| `METRICS_ENABLED`     | No          | `true`   | `true` or `false`            | Enable Prometheus metrics at `/metrics`.                                                 |
| `TRACE_SAMPLE_RATE`   | No          | `0.1`    | `1.0`                        | Fraction of requests to trace (0.0–1.0). Lower in production to reduce overhead.         |

#### Features & Feature Flags

| Variable             | Required | Default | Example           | Description                                                                   |
| -------------------- | -------- | ------- | ----------------- | ----------------------------------------------------------------------------- |
| `FEATURE_SEARCH`     | No       | `false` | `true` or `false` | Enable full-text search (F011). V1 feature -- disabled by default in MVP.     |
| `FEATURE_WATERMARK`  | No       | `true`  | `true` or `false` | Enable dynamic watermarking (F023).                                           |
| `FEATURE_ANALYTICS`  | No       | `true`  | `true` or `false` | Enable analytics dashboard (F121).                                            |
| `FEATURE_WEBHOOKS`   | No       | `false` | `true` or `false` | Enable webhooks (F058). V1 feature -- disabled by default in MVP.             |
| `FEATURE_ENCRYPTION` | No       | `false` | `true` or `false` | Enable document-level encryption (F120). Requires `ENCRYPTION_KEY` to be set. |
| `FEATURE_LEGAL_HOLD` | No       | `false` | `true` or `false` | Enable legal hold (F157). For compliance-heavy deployments.                   |

### .env.example

Complete template file:

```bash
# ============================================================================
# VaultSpace Environment Configuration
# ============================================================================
# Copy this file to .env and fill in your deployment-specific values.
# All required variables must be set; optional variables have safe defaults.

# ============================================================================
# CORE APPLICATION
# ============================================================================

# Deployment mode: azure (default) or standalone
# - azure: Enforces Azure services, blocks startup if misconfigured
# - standalone: Allows non-Azure services, graceful degradation for missing optional services
DEPLOYMENT_MODE=azure

# Runtime environment: production or development
NODE_ENV=production

# Full public URL (must include protocol and domain, no trailing slash)
APP_URL=https://dataroom.example.com

# Session secret (generate: openssl rand -base64 32)
SESSION_SECRET=your-random-secret-here

# Application display names
APP_NAME=VaultSpace
DEFAULT_ORG_NAME=My Organization

# Logging level: info, debug, warn, error
LOG_LEVEL=info

# ============================================================================
# DATABASE
# ============================================================================

# PostgreSQL connection string
# Format: postgresql://[user[:password]@][host][:port][/dbname]
DATABASE_URL=postgresql://vaultspace:change-me@postgres:5432/vaultspace

# Connection pool size (app: 10-20, workers: 3-5)
DATABASE_POOL_SIZE=10

# ============================================================================
# REDIS
# ============================================================================

# Redis connection string
# Format: redis[s]://[:password@]host[:port][/db]
REDIS_URL=redis://:change-me@redis:6379

# Enable TLS for Redis (required for Azure Cache for Redis with SSL)
REDIS_TLS=false

# ============================================================================
# STORAGE
# ============================================================================

# Storage backend: local, s3, or azure
STORAGE_PROVIDER=local

# For STORAGE_PROVIDER=local: filesystem path
STORAGE_LOCAL_PATH=./storage

# For S3-compatible storage:
# STORAGE_PROVIDER=s3
# STORAGE_BUCKET=my-bucket
# STORAGE_REGION=us-east-1
# STORAGE_KEY_ID=your-access-key
# STORAGE_SECRET_KEY=your-secret-key
# STORAGE_ENDPOINT=https://s3.amazonaws.com  # optional, for non-AWS S3

# For Azure Blob Storage:
# STORAGE_PROVIDER=azure
# STORAGE_BUCKET=vaultspace
# AZURE_STORAGE_ACCOUNT_NAME=myaccount
# AZURE_STORAGE_ACCOUNT_KEY=your-account-key-or-connection-string

# Storage configuration
# WARNING: Only affects static assets (logos, branding). Documents always use signed URLs.
STORAGE_PUBLIC_URLS=false
STORAGE_CLEANUP_DAYS=30

# ============================================================================
# EMAIL
# ============================================================================

# Email backend: smtp, sendgrid, or resend
EMAIL_PROVIDER=smtp

# For SMTP:
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASSWORD=your-smtp-password
SMTP_TLS=true

# For SendGrid:
# EMAIL_PROVIDER=sendgrid
# SENDGRID_API_KEY=SG.your-api-key-here

# For Resend:
# EMAIL_PROVIDER=resend
# RESEND_API_KEY=re_your-api-key-here

# Sender address (must be real domain for deliverability)
SMTP_FROM=noreply@dataroom.example.com

# ============================================================================
# AUTHENTICATION & SSO
# ============================================================================

# Auth provider: builtin, oidc, or saml
AUTH_PROVIDER=builtin

# For OpenID Connect:
# AUTH_PROVIDER=oidc
# OIDC_CLIENT_ID=your-client-id
# OIDC_CLIENT_SECRET=your-client-secret
# OIDC_PROVIDER_URL=https://auth.example.com
# OIDC_SCOPES=openid profile email

# For SAML 2.0:
# AUTH_PROVIDER=saml
# SAML_ENTITY_ID=https://dataroom.example.com/saml
# SAML_ENTRY_POINT=https://idp.example.com/saml
# SAML_CERT=-----BEGIN CERTIFICATE-----\n...

# ============================================================================
# ENCRYPTION
# ============================================================================

# Encryption provider: aes or vault
ENCRYPTION_PROVIDER=aes

# For AES-256 encryption (generate: openssl rand -base64 32):
ENCRYPTION_KEY=your-base64-encoded-aes-key

# For HashiCorp Vault:
# ENCRYPTION_PROVIDER=vault
# VAULT_ADDR=https://vault.example.com:8200
# VAULT_TOKEN=s.your-vault-token

# Key rotation (days, 0 to disable)
ENCRYPTION_KEY_ROTATION_DAYS=365

# ============================================================================
# PREVIEW & DOCUMENT CONVERSION
# ============================================================================

# Preview provider: gotenberg or libreoffice
PREVIEW_PROVIDER=gotenberg

# For Gotenberg (recommended):
GOTENBERG_URL=http://gotenberg:3000

# Preview configuration
PREVIEW_TIMEOUT_SECONDS=60
PREVIEW_MAX_FILE_SIZE_MB=100
PREVIEW_ENABLE_PDF_WATERMARK=true

# ============================================================================
# VIRUS & MALWARE SCANNING
# ============================================================================

# Scan provider: clamav or none (never use 'none' in production)
SCAN_PROVIDER=clamav

# ClamAV configuration:
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
SCAN_TIMEOUT_SECONDS=30
SCAN_QUARANTINE_PATH=./quarantine

# ============================================================================
# SEARCH INDEXING
# ============================================================================

# Search provider: postgres or meilisearch
SEARCH_PROVIDER=postgres

# For Meilisearch:
# SEARCH_PROVIDER=meilisearch
# MEILISEARCH_URL=http://meilisearch:7700
# MEILISEARCH_API_KEY=your-admin-api-key

# ============================================================================
# JOB QUEUE & WORKERS
# ============================================================================

# Enable background job queue (false only for testing)
JOB_QUEUE_ENABLED=true

# Redis prefix for job keys (allows multiple deployments on same Redis)
JOB_QUEUE_PREFIX=vaultspace

# Concurrency settings (tune based on workload)
JOB_QUEUE_CONCURRENCY=5
PREVIEW_WORKER_CONCURRENCY=2
SCAN_WORKER_CONCURRENCY=5
GENERAL_WORKER_CONCURRENCY=10

# ============================================================================
# MONITORING & OBSERVABILITY
# ============================================================================

# Monitoring provider: stdout or opentelemetry
MONITORING_PROVIDER=stdout

# For OpenTelemetry:
# MONITORING_PROVIDER=opentelemetry
# OTEL_ENDPOINT=http://otel-collector:4317
# OTEL_HEADERS=authorization=Bearer your-api-key

# Metrics
METRICS_ENABLED=true
TRACE_SAMPLE_RATE=0.1

# ============================================================================
# FEATURES & FEATURE FLAGS
# ============================================================================

# V1 feature -- disabled by default in MVP
FEATURE_SEARCH=false
FEATURE_WATERMARK=true
FEATURE_ANALYTICS=true
# V1 feature -- disabled by default in MVP
FEATURE_WEBHOOKS=false
FEATURE_ENCRYPTION=false
FEATURE_LEGAL_HOLD=false
```

---

## Worker and Queue Model

VaultSpace uses **dedicated worker processes** for background tasks, separated from the web tier. This enables independent scaling and prevents long-running operations from blocking API requests.

### Architecture

**Web Tier (Stateless)**

- Handles HTTP requests (admin UI, viewer UI, API)
- Queues background jobs
- Delegates heavy lifting to workers

**Worker Tier (Distributed)**

- Consumes jobs from Redis queue
- Organized by workload type
- Scale independently based on queue depth

### Worker Types

> **Azure Deployment:** Deploy workers as separate Azure Container Apps with the `WORKER_TYPE` environment variable.
> The examples below show the container configuration patterns.

#### 1. General Worker (`WORKER_TYPE=general`)

**Responsibilities:**

- Email delivery (notifications, invitations, digests)
- Webhook dispatch
- Cleanup tasks (trash expiry, old events archival)
- Analytics aggregation

**Job Queue:** `vaultspace:queue:general`

**Recommended concurrency:** 10–20 (I/O-bound)

**Scaling:** Add more replicas as email/webhook volume increases. Monitor queue depth via Azure Cache for Redis.

**Azure Container Apps deployment:**

```bash
az containerapp create \
  --name worker-general \
  --resource-group <rg> \
  --environment <env> \
  --image myregistry.azurecr.io/vaultspace:latest \
  --env-vars WORKER_TYPE=general DATABASE_URL=secretref:db-url REDIS_URL=secretref:redis-url \
  --min-replicas 1 --max-replicas 4
```

#### 2. Preview Worker (`WORKER_TYPE=preview`)

**Responsibilities:**

- Document format conversion (DOCX → PDF via LibreOffice/Gotenberg)
- Extract text for search indexing
- Generate page thumbnails
- Apply watermarks at render time

**Job Queue:** `vaultspace:queue:preview` (high priority)

**Recommended concurrency:** 2–4 (CPU-bound; heavy resource usage)

**Scaling:** This is often the first bottleneck. CPU-optimize nodes. Monitor:

- Queue depth: `LLEN vaultspace:queue:preview`
- Conversion time: Watch logs for slow documents
- CPU utilization: Should stay 60–80% under load

**CPU-bound tuning:**

- Reduce concurrency to 1–2 per pod if CPU spikes
- Use large-instance nodes with high single-threaded performance
- Consider Gotenberg auto-scaling if using containerized preview service

**Azure Container Apps deployment:**

```bash
az containerapp create \
  --name worker-preview \
  --resource-group <rg> \
  --environment <env> \
  --image myregistry.azurecr.io/vaultspace:latest \
  --env-vars WORKER_TYPE=preview DATABASE_URL=secretref:db-url REDIS_URL=secretref:redis-url GOTENBERG_URL=http://gotenberg:3000 \
  --cpu 2 --memory 4Gi \
  --min-replicas 1 --max-replicas 8
```

#### 3. Scan Worker (`WORKER_TYPE=scan`)

**Responsibilities:**

- Virus/malware scanning via ClamAV
- Quarantine flagged files
- Update document scan status

**Job Queue:** `vaultspace:queue:scan` (high priority)

**Recommended concurrency:** 5–10 (I/O-bound; talks to ClamAV daemon)

**Scaling:** Separate from preview workers to avoid blocking on slow scans. Monitor:

- Queue depth: `LLEN vaultspace:queue:scan`
- Scan latency: ClamAV response time
- False positive rate: Monitor quarantine logs

**Azure Container Apps deployment:**

```bash
az containerapp create \
  --name worker-scan \
  --resource-group <rg> \
  --environment <env> \
  --image myregistry.azurecr.io/vaultspace:latest \
  --env-vars WORKER_TYPE=scan DATABASE_URL=secretref:db-url REDIS_URL=secretref:redis-url CLAMAV_HOST=clamav \
  --min-replicas 1 --max-replicas 4
```

#### 4. Report Worker (`WORKER_TYPE=report`)

**Responsibilities:**

- Room ZIP exports
- PDF binder generation (F156)
- Compliance export packages (F133)
- Activity report generation (F031)

**Job Queue:** `vaultspace:queue:report` (low priority)

**Recommended concurrency:** 2–4 (I/O + CPU mixed)

**Scaling:** Lower priority; can use spot instances or scale down at night.

**Azure Container Apps deployment:**

```bash
az containerapp create \
  --name worker-report \
  --resource-group <rg> \
  --environment <env> \
  --image myregistry.azurecr.io/vaultspace:latest \
  --env-vars WORKER_TYPE=report DATABASE_URL=secretref:db-url REDIS_URL=secretref:redis-url \
  --min-replicas 0 --max-replicas 2
```

### Queue Definitions

| Queue       | Priority | Job Types          | Processing           | SLA        |
| ----------- | -------- | ------------------ | -------------------- | ---------- |
| `high`      | ⬆️       | Preview, Scan      | 2–4 workers per type | < 5 min    |
| `normal`    | →        | Email, Webhooks    | General worker       | < 15 min   |
| `low`       | ⬇️       | Analytics, Cleanup | Report worker        | < 1 hour   |
| `scheduled` | 🔄       | Retention, Expiry  | Cron via `node-cron` | Exact time |

### Job Flow

**Document upload:**

```
User uploads file
  ↓
App validates, stores original file blob
  ↓
Creates DocumentVersion record in DB
  ↓
Emits DocumentUploaded event (F102)
  ↓
Enqueues job: { jobId, documentId, versionId, type: 'scan' }
  ↓
Scan worker picks up job
  ├─ ClamAV scans file
  ├─ If infected: move to quarantine, emit ScanFailed event
  └─ If clean: emit ScanPassed event, enqueue preview job
  ↓
Preview worker picks up preview job
  ├─ Converts file format (DOCX → PDF, etc.)
  ├─ Extracts text for search (F011)
  ├─ Generates thumbnails
  └─ Emit PreviewGenerated event
  ↓
Document available to viewers
```

### Scaling Guidance

**Phase 1: Single-server (< 100 documents/day)**

- 1 app, 1 general worker, 1 preview worker, 1 scan worker
- Single Redis, single Postgres

**Phase 2: Growth (100–1000 documents/day)**

- 2 app instances behind load balancer
- 2 general workers
- 2–4 preview workers (CPU-bound, first bottleneck)
- 1 scan worker

**Phase 3: Scale (1000+ documents/day)**

- 4+ app instances
- Auto-scaling preview workers (target: queue depth < 10)
- 2–4 general workers
- Separate scan workers

### Monitoring Workers

**Health check endpoint (per worker):**

```bash
curl http://worker:3000/api/health/worker

# Returns:
{
  "status": "healthy",
  "workerType": "preview",
  "queueDepth": 3,
  "activeJobs": 2,
  "errorRate": 0.02,
  "uptime": 3600
}
```

**Key metrics to watch:**

```
vaultspace_queue_depth{type=preview}     # Should stay < 10
vaultspace_job_duration_seconds{type=preview}  # Histogram, P95 < 60s
vaultspace_job_errors_total{type=scan}   # Count by type
vaultspace_worker_uptime_seconds         # Restart detection
```

---

## Networking and Security

### Reverse Proxy / Load Balancing

**Azure Container Apps** handles TLS termination and load balancing automatically:

- TLS certificates: Managed automatically or bring your own via Azure Key Vault
- Load balancing: Built-in with revision-based traffic splitting
- Custom domains: Configure via Azure Portal or CLI

```bash
# Add custom domain to Container App
az containerapp hostname add \
  --name vaultspace-app \
  --resource-group <rg> \
  --hostname dataroom.example.com

# Bind managed certificate
az containerapp hostname bind \
  --name vaultspace-app \
  --resource-group <rg> \
  --hostname dataroom.example.com \
  --environment <env>
```

**For AKS deployments**, use Azure Application Gateway Ingress Controller (AGIC) or nginx-ingress. See [Appendix A](#appendix-a-non-azure-reference-configurations) for nginx/Caddy/Traefik configuration examples if migrating from other platforms.

### Private Network Architecture

**Production setup (NOT publicly exposed):**

```
┌─────────────────────────────────────┐
│   Internet                          │
│   (Users, API clients)              │
└──────────────────┬──────────────────┘
                   │ HTTPS
          ┌────────▼────────┐
          │  Front Door /   │
          │  App Gateway /  │
          │  CDN            │ (TLS termination)
          └────────┬────────┘
                   │ Internal only
    ┌──────────────▼──────────────┐
    │   Container App Env / K8s   │
    │  ┌──────────────────────┐   │
    │  │  Web App (stateless) │   │
    │  └──────────────────────┘   │
    │  ┌──────────────────────┐   │
    │  │  Workers (private)   │   │
    │  └──────────────────────┘   │
    └──────────────┬───────────────┘
                   │ (private network only)
        ┌──────────┬──────────┬──────────┐
        │          │          │          │
   ┌────▼──┐  ┌───▼───┐  ┌──▼────┐  ┌─▼─────┐
   │ Redis │  │Postgres│  │Storage│  │Search │
   │(private)│(private)│ (private) │(private)│
   └────────┘  └───────┘  └────────┘  └───────┘
```

**Network segmentation:**

- Load balancer is only public endpoint
- App tier and workers: private network (no direct internet)
- Database, Redis, storage: private network (no public access)
- All inter-service communication over private subnet
- Storage bucket: private (no public access), signed URLs only

### Rate Limiting

**Azure Front Door / Application Gateway:**

Rate limiting is configured at the Azure infrastructure level:

```bash
# Create WAF policy with rate limiting
az network front-door waf-policy create \
  --name vaultspace-waf \
  --resource-group <rg> \
  --mode Prevention

# Add rate limit rule (100 requests per minute per IP)
az network front-door waf-policy rule create \
  --name RateLimitRule \
  --policy-name vaultspace-waf \
  --resource-group <rg> \
  --rule-type RateLimitRule \
  --rate-limit-threshold 100 \
  --rate-limit-duration-in-minutes 1 \
  --action Block
```

**Per-user (application layer):**

Implemented in application layer via Azure Cache for Redis:

```typescript
// app/lib/rateLimit.ts
const rateLimit = async (userId: string, action: string): Promise<boolean> => {
  const key = `ratelimit:${userId}:${action}`;
  const limit = 100; // per action
  const window = 3600; // per hour

  const count = await redis.incr(key);
  if (count === 1) redis.expire(key, window);

  return count <= limit;
};

// Usage in API route
if (!(await rateLimit(user.id, 'document-download'))) {
  return res.status(429).json({ error: 'Rate limit exceeded' });
}
```

### CORS Configuration

```typescript
// lib/cors.ts
import cors from 'cors';

const allowedOrigins = [
  process.env.APP_URL,
  'https://dataroom.example.com',
  'https://widget.example.com', // for embeds
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

export const handler = cors(corsOptions);
```

### TLS Certificate Management

**Azure Container Apps (managed certificates):**

Azure Container Apps handles TLS automatically for custom domains:

```bash
# Add custom domain with managed certificate
az containerapp hostname add \
  --name vaultspace-app \
  --resource-group <rg> \
  --hostname dataroom.example.com

# Bind managed certificate (auto-renewed)
az containerapp hostname bind \
  --name vaultspace-app \
  --resource-group <rg> \
  --hostname dataroom.example.com \
  --environment cae-vaultspace \
  --validation-method CNAME

# Verify certificate status
az containerapp hostname list \
  --name vaultspace-app \
  --resource-group <rg>
```

**Azure Front Door (recommended for production):**

```bash
# Front Door manages certificates automatically for custom domains
az afd custom-domain create \
  --custom-domain-name vaultspace-domain \
  --profile-name vaultspace-fd \
  --resource-group <rg> \
  --host-name dataroom.example.com \
  --certificate-type ManagedCertificate
```

---

## Azure Reference Architecture

Complete Azure deployment topology for production-grade VaultSpace.

### Resource Group Layout

```
Resource Group: rg-vaultspace-prod

├── Networking
│   ├── Virtual Network (vnet-vaultspace)
│   ├── Subnet: app-tier (10.0.1.0/24)
│   ├── Subnet: data-tier (10.0.2.0/24)
│   └── Network Security Groups (NSGs)

├── Compute
│   ├── Container Apps Environment (cae-vaultspace)
│   ├── Container App: vaultspace-web (2–4 replicas)
│   ├── Container App: vaultspace-worker-general (1–2 replicas)
│   ├── Container App: vaultspace-worker-preview (2–4 replicas, CPU-optimized)
│   └── Container App: vaultspace-worker-scan (1 replica)

├── Data
│   ├── PostgreSQL Flexible Server (postgres-vaultspace)
│   ├── Azure Cache for Redis (redis-vaultspace)
│   └── Storage Account (stavaultspace)
│       ├── Blob Container: documents (private)
│       ├── Blob Container: previews (private)
│       ├── Blob Container: exports (private)
│       └── Blob Container: backups (private)

├── Monitoring & Logging
│   ├── Log Analytics Workspace (law-vaultspace)
│   ├── Application Insights (appinsights-vaultspace)
│   ├── Backup Vault (backup-vaultspace)
│   └── Managed Identity (mi-vaultspace)

├── Security
│   ├── Key Vault (kv-vaultspace) — optional for future key management
│   ├── Front Door (fd-vaultspace) — DDoS protection, TLS
│   └── NSG Rules (deny all inbound except Front Door)

└── Configuration
    └── Container Registry (acrcompany.azurecr.io) — for custom images
```

### Terraform / Bicep Skeleton

**main.tf (Terraform):**

```hcl
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "resource_group_name" {
  default = "rg-vaultspace-prod"
}

variable "location" {
  default = "eastus"
}

variable "environment" {
  default = "prod"
}

# Resource Group
resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
}

# Virtual Network
resource "azurerm_virtual_network" "main" {
  name                = "vnet-vaultspace"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = ["10.0.0.0/16"]
}

# Subnets
resource "azurerm_subnet" "app" {
  name                 = "subnet-app"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_subnet" "data" {
  name                 = "subnet-data"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.2.0/24"]
}

# PostgreSQL Flexible Server
resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "postgres-vaultspace"
  location               = azurerm_resource_group.main.location
  resource_group_name    = azurerm_resource_group.main.name
  administrator_login    = "psqladmin"
  administrator_password = var.db_password  # Set via -var or tfvars
  sku_name               = "B_Standard_B2s"  # Dev: B1s, Prod: B2s or GP_Standard_D2s
  storage_mb             = 65536
  backup_retention_days  = 35
  version                = "15"

  depends_on = [azurerm_resource_group.main]
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name            = "vaultspace"
  server_id       = azurerm_postgresql_flexible_server.main.id
  charset         = "UTF8"
  collation       = "en_US.utf8"
}

# Azure Cache for Redis
resource "azurerm_redis_cache" "main" {
  name                = "redis-vaultspace"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  capacity            = 1
  family              = "C"
  sku_name            = "Standard"  # Dev: Basic, Prod: Standard or Premium
  enable_non_ssl_port = false
  minimum_tls_version = "1.2"
}

# Storage Account
resource "azurerm_storage_account" "main" {
  name                     = "stavaultspace${var.environment}"
  location                 = azurerm_resource_group.main.location
  resource_group_name      = azurerm_resource_group.main.name
  account_tier             = "Standard"
  account_replication_type = "LRS"  # Prod: GRS or GZRS
}

# Storage Containers
resource "azurerm_storage_container" "documents" {
  name                  = "documents"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "previews" {
  name                  = "previews"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "exports" {
  name                  = "exports"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

# Container Apps Environment
resource "azurerm_container_app_environment" "main" {
  name                = "cae-vaultspace"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

# Output connection strings
output "database_url" {
  value       = "postgresql://psqladmin:${var.db_password}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/vaultspace"
  sensitive   = true
}

output "redis_url" {
  value       = "redis://:${azurerm_redis_cache.main.primary_access_key}@${azurerm_redis_cache.main.hostname}:6379"
  sensitive   = true
}

output "storage_account_name" {
  value = azurerm_storage_account.main.name
}
```

### Container Apps Deployment

**web.yaml (Container App for web tier):**

```yaml
apiVersion: microsoft.app/v1
kind: ContainerApp
metadata:
  name: vaultspace-web
spec:
  environmentId: /subscriptions/{sub}/resourceGroups/rg-vaultspace-prod/providers/Microsoft.App/managedEnvironments/cae-vaultspace
  template:
    containers:
      - name: app
        image: myregistry.azurecr.io/vaultspace:latest
        resources:
          cpu: 1
          memory: 2Gi
        env:
          - name: NODE_ENV
            value: production
          - name: APP_URL
            value: https://dataroom.example.com
          - name: SESSION_SECRET
            secretRef: session-secret
          - name: DATABASE_URL
            secretRef: database-url
          - name: REDIS_URL
            secretRef: redis-url
          - name: STORAGE_PROVIDER
            value: azure
          - name: AZURE_STORAGE_ACCOUNT_NAME
            secretRef: storage-account-name
          - name: AZURE_STORAGE_ACCOUNT_KEY
            secretRef: storage-account-key
        ports:
          - containerPort: 3000
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
    replicas: 3
    activeRevisionsMode: Single
  configuration:
    ingress:
      external: true
      targetPort: 3000
      traffic:
        - latestRevision: true
          weight: 100
    secrets:
      - name: session-secret
        value: ${SESSION_SECRET}
      - name: database-url
        value: ${DATABASE_URL}
      - name: redis-url
        value: ${REDIS_URL}
      - name: storage-account-name
        value: ${STORAGE_ACCOUNT_NAME}
      - name: storage-account-key
        value: ${STORAGE_ACCOUNT_KEY}
  workloadProfileName: Consumption
```

### Azure Sizing by Environment

| Resource           | Dev                          | Staging                    | Production                 |
| ------------------ | ---------------------------- | -------------------------- | -------------------------- |
| **Container App**  | 0.25 vCPU, 512MB (1 replica) | 0.5 vCPU, 1GB (2 replicas) | 1 vCPU, 2GB (3–4 replicas) |
| **Preview Worker** | 1 vCPU, 2GB (1 replica)      | 1 vCPU, 2GB (2 replicas)   | 2 vCPU, 4GB (2–4 replicas) |
| **PostgreSQL**     | B_Standard_B1s               | B_Standard_B2s             | Standard_D2s_v3 (32GB)     |
| **Redis**          | Basic 1GB                    | Standard 2.5GB             | Premium 6GB+               |
| **Storage**        | 100GB LRS                    | 500GB LRS                  | 1TB+ GRS                   |
| **Estimated Cost** | $50–100/month                | $300–500/month             | $2,000–5,000+/month        |

---

## Backup and Recovery

### Database Backup Strategy

**Automated backups (PostgreSQL):**

Azure PostgreSQL Flexible Server automatically backs up:

- Daily snapshots (up to 35 days retention)
- Continuous backup (point-in-time recovery)
- Geo-redundant option available

**Manual backups (for critical production):**

```bash
#!/bin/bash
# backup-database.sh

BACKUP_FILE="backup-$(date +%Y%m%d-%H%M%S).sql.gz"
BACKUP_DIR="/backups/database"

pg_dump \
  --host="$DATABASE_HOST" \
  --username="$DATABASE_USER" \
  --dbname="$DATABASE_NAME" \
  --compress=9 \
  --file="$BACKUP_DIR/$BACKUP_FILE"

# Upload to cold storage
az storage blob upload \
  --account-name stavaultspace \
  --container-name backups \
  --file "$BACKUP_DIR/$BACKUP_FILE" \
  --name "database/$BACKUP_FILE"

# Keep local backups for 7 days
find "$BACKUP_DIR" -name "backup-*.sql.gz" -mtime +7 -delete
```

**Retention policy:**

- Daily backups: 35 days (Azure managed)
- Monthly full backup: 1 year (cold storage)
- Point-in-time recovery: 35 days

### Object Storage Backup

**Blob storage lifecycle management (via Terraform):**

```hcl
resource "azurerm_storage_management_policy" "main" {
  storage_account_id = azurerm_storage_account.main.id

  rule {
    name    = "auto-archive"
    enabled = true

    filters {
      blob_types = ["blockBlob"]
    }

    actions {
      base_blob {
        tier_to_cool_after_days_since_modification_greater_than   = 30
        tier_to_archive_after_days_since_modification_greater_than = 90
        delete_after_days_since_modification_greater_than          = 365
      }
    }
  }
}
```

**Cross-region replication (for disaster recovery):**

```hcl
# Geo-redundant storage
account_replication_type = "GRS"  # Copies to secondary region

# Or use azcopy for manual backup
# azcopy copy "https://source.blob.core.windows.net/container/*" \
#   "https://dest.blob.core.windows.net/container/" \
#   --recursive
```

### Point-in-Time Recovery

**Restore database to specific time:**

```bash
# Via Azure CLI
az postgres flexible-server restore \
  --resource-group rg-vaultspace-prod \
  --name postgres-vaultspace-restored \
  --source-server postgres-vaultspace \
  --restore-time "2024-03-14T10:00:00Z"

# Update .env to point to restored DB
export DATABASE_URL=postgresql://psqladmin:...@postgres-vaultspace-restored...
```

### Disaster Recovery Runbook

**If primary region fails:**

1. **Assess:** Check Azure status page and service health
2. **DNS failover:** Update DNS to secondary region (if using geo-replication)
3. **Database:** Restore from geo-replicated backup to alternate region
4. **Storage:** Manually replicate critical containers using azcopy
5. **App deployment:** Re-deploy containers to alternate region
6. **Verification:** Test application health
7. **Communication:** Notify stakeholders of recovery progress

**RTO (Recovery Time Objective):** 4–8 hours
**RPO (Recovery Point Objective):** < 1 hour (via continuous backup)

---

## Monitoring and Observability

### Health Check Endpoints

**Application health:**

```typescript
// app/api/health/route.ts
export async function GET() {
  const checks = {
    app: 'healthy',
    database: await checkDatabase(),
    redis: await checkRedis(),
    storage: await checkStorage(),
  };

  const allHealthy = Object.values(checks).every((c) => c === 'healthy');
  const status = allHealthy ? 200 : 503;

  return new Response(JSON.stringify(checks), { status });
}

async function checkDatabase() {
  try {
    await db.$queryRaw`SELECT 1`;
    return 'healthy';
  } catch {
    return 'unhealthy';
  }
}

async function checkRedis() {
  try {
    await redis.ping();
    return 'healthy';
  } catch {
    return 'unhealthy';
  }
}
```

**Worker health:**

```bash
curl http://worker:3000/api/health/worker
# {
#   "status": "healthy",
#   "workerType": "preview",
#   "queueDepth": 3,
#   "activeJobs": 2,
#   "errorRate": 0.02,
#   "uptime": 3600
# }
```

### Key Metrics

**Application metrics:**

```
# Response time (histogram)
vaultspace_http_request_duration_seconds{method="GET", path="/api/documents", quantile="0.95"}

# Request volume
vaultspace_http_requests_total{method="POST", status="200", endpoint="/api/documents/upload"}

# Error rate
vaultspace_http_requests_total{status="5xx"} / vaultspace_http_requests_total

# Permission engine
vaultspace_permission_checks_total{action="view", result="allowed"}
vaultspace_permission_checks_total{action="view", result="denied"}

# Database connections
vaultspace_db_pool_size{pool="default"}
vaultspace_db_connections_active{pool="default"}

# Cache hit rate
vaultspace_cache_hits_total / (vaultspace_cache_hits_total + vaultspace_cache_misses_total)
```

**Worker metrics:**

```
vaultspace_worker_jobs_total{type="preview", status="success"}
vaultspace_worker_jobs_total{type="preview", status="failed"}
vaultspace_worker_job_duration_seconds{type="preview", quantile="0.95"}

vaultspace_queue_depth{queue="high"}
vaultspace_queue_depth{queue="normal"}
```

**Business metrics:**

```
vaultspace_documents_uploaded_total{organization_id="org123"}
vaultspace_viewers_active{organization_id="org123"}
vaultspace_document_views_total{organization_id="org123"}
vaultspace_storage_bytes_used{organization_id="org123"}
```

### Alert Configuration

**Critical alerts (page on-call):**

```yaml
groups:
  - name: vaultspace-critical
    rules:
      - alert: AppInstanceDown
        expr: up{job="vaultspace-app"} == 0
        for: 5m
        annotations:
          summary: 'App instance down'

      - alert: DatabaseConnectionPoolExhausted
        expr: vaultspace_db_connections_active / vaultspace_db_pool_size > 0.95
        for: 10m

      - alert: QueueDepthCritical
        expr: vaultspace_queue_depth{queue="high"} > 100
        for: 15m

      - alert: ErrorRateHigh
        expr: rate(vaultspace_http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 10m
```

### OpenTelemetry Integration

**Instrumentation (auto-traced):**

```typescript
// lib/otel.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_ENDPOINT, // REQUIRED: Set to Azure Monitor or OTEL collector endpoint
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: process.env.OTEL_ENDPOINT, // REQUIRED: Set to Azure Monitor or OTEL collector endpoint
  }),
});

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
  traceExporter,
  metricReader,
  serviceName: 'vaultspace-app',
  serviceVersion: process.env.APP_VERSION || 'dev',
});

sdk.start();
```

---

## Upgrade Strategy

### Before Upgrading

1. **Backup everything:**

   ```bash
   ./scripts/backup-database.sh
   ./scripts/backup-storage.sh
   ```

2. **Test in staging:** Deploy new version to staging environment first

3. **Review changelog:** Check for breaking changes or new configurations

4. **Plan maintenance window:** Schedule 30 min to 2 hours depending on schema changes

### Database Migrations

Automated via Prisma on container startup:

```dockerfile
# In Dockerfile
ENTRYPOINT ["/sbin/dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
```

**Manual migration (if needed):**

```bash
# Get connection string
export DATABASE_URL=postgresql://user:pass@host/db

# List pending migrations
npx prisma migrate status

# Apply migrations
npx prisma migrate deploy

# Rollback (if something goes wrong)
npx prisma migrate resolve --rolled-back 20240314120000_migration_name
```

### Blue-Green Deployment

**Azure Container Apps Traffic Splitting:**

Azure Container Apps supports native traffic splitting between revisions for zero-downtime deployments:

```bash
# Deploy new revision (automatically created on update)
az containerapp update \
  --name vaultspace-app \
  --resource-group <rg> \
  --image <acr>.azurecr.io/vaultspace:v2

# Split traffic: 90% to old revision, 10% to new
az containerapp ingress traffic set \
  --name vaultspace-app \
  --resource-group <rg> \
  --revision-weight <old-revision>=90 <new-revision>=10

# Monitor metrics in Azure Portal or via CLI
az monitor metrics list \
  --resource /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.App/containerApps/vaultspace-app \
  --metric "Requests" --interval PT1M

# If healthy, shift 100% traffic to new revision
az containerapp ingress traffic set \
  --name vaultspace-app \
  --resource-group <rg> \
  --revision-weight <new-revision>=100

# Deactivate old revision
az containerapp revision deactivate \
  --name vaultspace-app \
  --resource-group <rg> \
  --revision <old-revision>
```

### Rollback Plan

**If new version has critical bug:**

```bash
# Option 1: Immediate rollback (Azure Container Apps)
az containerapp revision activate --name vaultspace-app --resource-group <rg> --revision <previous-revision>

# Option 2: Rollback (AKS)
kubectl rollout undo deployment/vaultspace-app

# Option 3: Restore from database backup
az postgres flexible-server restore \
  --name postgres-vaultspace-restored \
  --source-server postgres-vaultspace \
  --restore-time "2024-03-14T10:00:00Z"
```

---

## Troubleshooting

### Common Issues

#### "502 Bad Gateway" from reverse proxy

**Causes:** App is down, unhealthy, or not responding.

**Debug (Azure Container Apps):**

```bash
# Check app logs via Azure CLI
az containerapp logs show --name vaultspace-app --resource-group <rg>

# Test health endpoint (use your Azure URL)
curl https://your-app.azurecontainerapps.io/api/health

# Check Azure Cache for Redis connectivity
az redis show --name <redis-name> --resource-group <rg>

# Check Azure PostgreSQL connectivity
az postgres flexible-server show --name <server-name> --resource-group <rg>
```

**Solution:**

- Verify Azure connection strings in Container App environment
- Check resource limits in Container App scaling settings
- Restart revision: `az containerapp revision restart --name vaultspace-app --resource-group <rg>`

#### Document upload fails silently

**Causes:** Storage misconfigured, permission denied, or quota exceeded.

**Debug (Azure):**

```bash
# Check storage logs via Azure CLI
az containerapp logs show --name vaultspace-app --resource-group <rg> --follow | grep -i storage

# Test Azure Blob connectivity
az storage blob list --account-name myaccount --container-name documents

# Check storage quota
az storage account show \
  --name stavaultspace \
  --query "{Quota: properties.primaryEndpoints}"
```

**Solution:**

- Verify `STORAGE_PROVIDER=azure` and Azure credentials are set
- Check Azure RBAC permissions for storage account
- Increase storage quota or purge old files

#### Preview generation stuck / slow

**Causes:** Gotenberg overloaded, insufficient resources, or large/complex documents.

**Debug (Azure):**

```bash
# Check queue depth via Azure Cache for Redis
az redis console --name <redis-name> --resource-group <rg> --command "LLEN vaultspace:queue:preview"

# Check Gotenberg health (internal service)
az containerapp exec --name vaultspace-app --resource-group <rg> --command "curl http://gotenberg:3000/health"

# Check preview worker logs
az containerapp logs show --name worker-preview --resource-group <rg> --follow

# Monitor CPU/memory via Azure Portal or CLI
az monitor metrics list --resource <container-app-resource-id> --metric "CpuPercent" "MemoryPercent"
```

**Solution:**

- Scale up preview workers via Azure: `az containerapp update --name worker-preview --resource-group <rg> --min-replicas 4`
- Reduce `PREVIEW_WORKER_CONCURRENCY` if CPU-bound
- Increase `PREVIEW_TIMEOUT_SECONDS` for large documents
- Disable preview for very large files (> 500MB)

#### Memory leak / OOM kill

**Causes:** Long-running connections, unreleased resources, or memory bloat.

**Debug (Azure):**

```bash
# Monitor memory usage via Azure Monitor
az monitor metrics list --resource <container-app-resource-id> --metric "MemoryPercent" --interval PT1M

# Check for open connections in Azure PostgreSQL
az postgres flexible-server execute --name <server> --admin-user <user> --admin-password <pass> \
  --database-name vaultspace --querytext "SELECT count(*) FROM pg_stat_activity;"

# Check Redis connections
az redis console --name <redis-name> --resource-group <rg> --command "INFO stats" | grep connected_clients
```

**Solution:**

- Restart container via Azure: `az containerapp revision restart --name vaultspace-app --resource-group <rg>`
- Reduce `DATABASE_POOL_SIZE` if too many connections
- Enable garbage collection profiling: `NODE_OPTIONS="--expose-gc"`
- Check for large arrays/objects being retained in memory

#### Permission denied on sensitive operations

**Causes:** PermissionEngine denying access (expected) or configuration mismatch.

**Debug:**

```bash
# Enable permission diagnostics
export LOG_LEVEL=debug

# Check user permissions in DB
SELECT * FROM "UserRole" WHERE user_id = 'xxx';
SELECT * FROM "DocumentACL" WHERE document_id = 'yyy';
SELECT * FROM "GroupMember" WHERE group_id = 'zzz';

# Use explainPermission() endpoint (if implemented)
curl "https://your-app.azurecontainerapps.io/api/permissions/explain?userId=xxx&documentId=yyy&action=download"
```

**Solution:**

- Verify admin account is created: `npm run seed` or check first-run setup wizard
- Check that user belongs to correct groups: admin UI → Users → Groups
- Verify document ACLs are set correctly: admin UI → Documents → Permissions

#### Webhook delivery failing

**Causes:** Network unreachable, endpoint down, or signature mismatch.

**Debug (Azure):**

```bash
# Check webhook logs via Azure CLI
az containerapp logs show --name worker-general --resource-group <rg> --follow | grep webhook

# Test webhook endpoint manually
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Signature: ..." \
  -d '{"event": "test"}' \
  https://your-webhook-endpoint.com/webhook

# Check webhook configuration in Azure PostgreSQL
az postgres flexible-server execute --name <server> --admin-user <user> --admin-password <pass> \
  --database-name vaultspace --querytext "SELECT * FROM \"Webhook\" WHERE enabled = true;"
```

**Solution:**

- Verify webhook URL is publicly accessible
- Check firewall rules allow outbound HTTPS
- Ensure webhook signature secret is correct
- Increase retry count: `WEBHOOK_MAX_RETRIES=5`

---

## Cross-References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design, module descriptions, interface contracts
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Complete database schema and Document Object Model
- [EVENT_MODEL.md](./EVENT_MODEL.md) - Event types, schema, partitioning, subscribers
- [PERMISSION_MODEL.md](./PERMISSION_MODEL.md) - Role hierarchy, ACL evaluation, explainPermission
- [SECURITY.md](./SECURITY.md) - Security practices, vulnerability disclosure
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Developer setup, testing, PR process

---

## Appendix A: Non-Azure Reference Configurations

> **Standalone Mode:** These configurations are fully supported when `DEPLOYMENT_MODE=standalone` is set.
> They provide reference material for self-hosted deployments:
>
> - Docker Compose for local development and single-server production
> - Reverse proxy configurations (nginx, Caddy, Traefik)
> - Non-Azure cloud deployments (AWS, GCP, DigitalOcean)

### A.1 Docker Compose Service Reference

This Docker Compose file shows VaultSpace service dependencies and internal networking patterns.
For standalone mode deployments, this serves as a complete local development or single-server production setup.

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: vaultspace
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD}
      POSTGRES_DB: vaultspace
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U vaultspace']
      interval: 10s

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s

  gotenberg:
    image: gotenberg/gotenberg:8.0
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']

  clamav:
    image: clamav/clamav:latest
    healthcheck:
      test: ['CMD', 'clamscan', '--version']

  app:
    build: { context: ., dockerfile: Dockerfile }
    depends_on: [postgres, redis]
    environment:
      APP_URL: ${APP_URL} # REQUIRED
      DATABASE_URL: postgresql://vaultspace:${DATABASE_PASSWORD}@postgres:5432/vaultspace
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      GOTENBERG_URL: http://gotenberg:3000
      CLAMAV_HOST: clamav
```

### A.2 Reverse Proxy Examples

These configurations are for non-Azure deployments (self-hosted VMs, other cloud providers).

#### Caddy

```caddy
dataroom.example.com {
  reverse_proxy app:3000 {
    health_uri /api/health
  }
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
  }
}
```

#### Nginx

```nginx
upstream vaultspace_app {
  server app:3000 max_fails=3 fail_timeout=30s;
}

server {
  listen 443 ssl http2;
  server_name dataroom.example.com;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

  location / {
    proxy_pass http://vaultspace_app;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

#### Traefik (Kubernetes)

```yaml
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRoute
metadata:
  name: vaultspace
spec:
  entryPoints: [websecure]
  routes:
    - match: Host(`dataroom.example.com`)
      services:
        - name: vaultspace-app
          port: 3000
  tls:
    certResolver: letsencrypt
```

---

**Deployment documentation version: 1.1**
**Last updated:** 2026-03-16
**Corresponds to:** Feature F155 (DEPLOYMENT.md) in feature matrix
