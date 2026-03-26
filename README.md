# VaultSpace

Open-source, self-hosted secure Virtual Data Room (VDR) platform.

## Overview

VaultSpace provides enterprise-grade document security and collaboration for M&A due diligence, fundraising, board communications, and other sensitive business transactions. Built with a security-first architecture including 14-layer permission evaluation, immutable audit trails, and complete tenant isolation.

## Key Features

- **Multi-tenant architecture** with Row-Level Security and complete tenant isolation
- **14-layer permission engine** — org roles, room roles, folder/document permissions, group membership, link-based access
- **Secure document viewing** with in-browser preview, watermarking, and download controls
- **Comprehensive audit logging** — immutable event trail with request correlation
- **Background processing** — virus scanning (ClamAV), preview generation, OCR text extraction
- **Share links** — password-protected, email-verified, expiring access for external viewers
- **Room management** — templates (M&A, investor, board, compliance), lifecycle states, folder hierarchy
- **Self-hosted deployment** — Azure Container Apps with PostgreSQL, Redis, Blob Storage
- **Admin dashboard** — rooms, users, groups, activity log, analytics, organization branding

## Tech Stack

| Layer     | Technology                                           |
| --------- | ---------------------------------------------------- |
| Framework | Next.js 14+ (App Router)                             |
| Language  | TypeScript (strict mode)                             |
| Database  | PostgreSQL 15+ with Prisma ORM                       |
| Queue     | Redis + BullMQ (4 priority queues)                   |
| UI        | React 18+ / TailwindCSS / shadcn/ui                  |
| Auth      | Custom DB-backed sessions (bcrypt, HttpOnly cookies) |
| Storage   | Azure Blob Storage / S3 / Local filesystem           |
| Scanning  | ClamAV virus scanning                                |
| Preview   | Sharp (images), Gotenberg (documents)                |
| OCR       | Tesseract.js                                         |

## Status

**MVP implementation in progress.** Backend APIs complete (61 routes), admin UI fully wired, CI/CD pipeline operational.

See [MASTER_PLAN.md](MASTER_PLAN.md) for the full sprint plan and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for current progress.

## Quick Start

### Prerequisites

- Node.js 20+
- Azure account (VaultSpace runs exclusively on Azure)

### Development (static analysis only)

```bash
git clone https://github.com/valcros/vaultspace.git
cd vaultspace
npm install

# Run checks (no Azure services required)
npm run type-check    # TypeScript
npm run lint          # ESLint
npm run test          # Unit tests (74 tests)
```

### Deployment

VaultSpace deploys to Azure Container Apps. See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions.

```bash
# Build Docker images
docker build -t vaultspace-web -f Dockerfile .
docker build -t vaultspace-worker -f Dockerfile.worker .
```

### Demo

After deployment with seed data (`npm run db:seed`):

- **Admin:** `admin@demo.vaultspace.app` / `Demo123!`
- **Viewer 1:** `investor1@demo.vaultspace.app` / `Demo123!`
- **Viewer 2:** `investor2@demo.vaultspace.app` / `Demo123!`

The seed creates a "Due Diligence Package" room with sample folders (Financials, Legal, Technical) and documents.

## Architecture

```
src/
  app/           # Next.js App Router (pages, layouts, API routes)
  components/    # React components (TailwindCSS + shadcn/ui)
  services/      # CoreService Layer (business logic, event emission)
  providers/     # Provider/Adapter implementations (storage, email, etc.)
  lib/           # Shared utilities (PermissionEngine, EventBus, auth)
  workers/       # Background job processors (email, preview, scan)
prisma/          # Database schema and migrations
infrastructure/  # Azure deployment configuration
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design.

## Documentation

| Document                                     | Purpose                                              |
| -------------------------------------------- | ---------------------------------------------------- |
| [AI_BUILD_PLAYBOOK.md](AI_BUILD_PLAYBOOK.md) | Implementation guide and build phases                |
| [ARCHITECTURE.md](ARCHITECTURE.md)           | System design, provider pattern, directory structure |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)     | Prisma schema, indexes, RLS                          |
| [PERMISSION_MODEL.md](PERMISSION_MODEL.md)   | 14-layer permission engine specification             |
| [API_SPEC.md](API_SPEC.md)                   | REST API endpoints and schemas                       |
| [DEPLOYMENT.md](DEPLOYMENT.md)               | Azure deployment guide                               |
| [SECURITY.md](SECURITY.md)                   | Security policies and vulnerability disclosure       |
| [CONTRIBUTING.md](CONTRIBUTING.md)           | Development workflow and code standards              |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Key points:

- TypeScript strict mode, ESLint + Prettier
- Functional React components with hooks
- All API routes validate input with Zod
- Every database query must include `organizationId` (tenant isolation)

## License

VaultSpace is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

You can use, modify, and distribute VaultSpace. If you run a modified version as a network service, you must make your source code available to users of that service.
