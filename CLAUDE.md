# VaultSpace - Claude Code Project Instructions

> **Canonical source:** This file summarizes project rules for Claude Code.
> If anything here conflicts with AI_BUILD_PLAYBOOK.md or the linked design documents,
> those documents take precedence. See AI_BUILD_PLAYBOOK.md for full reading order.

## Project Overview

VaultSpace is an open-source, self-hosted secure Virtual Data Room (VDR) platform. License: AGPLv3. Tech stack: Next.js 14+ (App Router), TypeScript, React 18+, Prisma ORM, PostgreSQL 15+, TailwindCSS, Redis/BullMQ.

**Status:** Specification complete. Implementation not started.

## Deployment Modes

VaultSpace supports two deployment modes controlled by `DEPLOYMENT_MODE` environment variable:

### Azure Mode (default)
- **Runtime:** Azure Container Apps or AKS
- **Database:** Azure PostgreSQL
- **Storage:** Azure Blob Storage
- **Cache:** Azure Cache for Redis
- **Testing:** Against Azure-hosted services

Missing Azure configuration causes startup failure with clear error messages.

### Standalone Mode
Set `DEPLOYMENT_MODE=standalone` to enable self-hosted deployment:

- **Database:** Any PostgreSQL 15+ (Azure, AWS RDS, self-hosted)
- **Storage:** S3-compatible (MinIO, Backblaze, DO Spaces) or local filesystem
- **Cache:** Any Redis, or omit for degraded mode (async features disabled)
- **Testing:** Localhost databases allowed

Standalone mode uses graceful degradation. Missing optional services (Redis, ClamAV, Gotenberg) disable related features without blocking core functionality. The health endpoint reports degraded capabilities.

## Before Writing Any Code

**Read AI_BUILD_PLAYBOOK.md first.** It defines the mandatory reading order, precedence rules, build phases, and MVP stop conditions.

### Document Reading Order (Mandatory)

1. `AI_BUILD_PLAYBOOK.md` - Implementation entrypoint, rules, stop conditions
2. `dataroom-feature-matrix-v6.md` - "Authoritative MVP Scope Declaration" section (63 MVP features)
3. `CANONICAL_CONTRACTS.md` - Settled disputes: auth, roles, env vars, signed URLs, state machine, MVP infra vs V1
4. `ARCHITECTURE.md` - System design, 13 provider interfaces, CoreService pattern, directory structure
5. `DATABASE_SCHEMA.md` - Prisma schema, composite FKs, RLS operational contract + policy SQL, tenant scoping
6. `PERMISSION_MODEL.md` - 14-layer PermissionEngine, security test matrix (SEC-001 to SEC-016)
7. `EVENT_MODEL.md` - EventBus contract, event types, partitioning, compaction
8. `DEPLOYMENT.md` - Docker Compose, environment variables (single source of truth for env var names), worker config
9. `CONTRIBUTING.md` - Code style, testing requirements
10. `SECURITY.md` - Security policies, vulnerability handling

### Implementation Detail Documents (read during relevant build phase)

11. `AUTH_AND_SESSIONS.md` - Session tokens, password hashing, login/logout flows, CSRF
12. `API_SPEC.md` - REST endpoints, request/response schemas, error format, rate limiting
13. `FILE_HANDLING.md` - Upload flow, preview pipeline, file type mapping, document state machine
14. `PROVIDER_DEFAULTS.md` - Default implementations for all 13 providers, factory pattern
15. `EMAIL_TEMPLATES.md` - Transactional email templates, notification preferences
16. `JOB_SPECS.md` - Job types, payload interfaces, retry policies, dead letter handling
17. `UI_WIREFRAMES.md` - Design tokens, page wireframes, component library, accessibility
18. `SEED_DATA.md` - Test organizations, users, Series A Funding Room demo data

### Document Precedence (When Conflicts Exist)

1. `dataroom-feature-matrix-v6.md` "Authoritative MVP Scope Declaration" (feature scope)
2. `CANONICAL_CONTRACTS.md` (resolved disputes: auth, roles, env vars, state machine)
3. `DATABASE_SCHEMA.md` (data model and constraints)
4. `PERMISSION_MODEL.md` (security invariants)
5. `ARCHITECTURE.md` (system design)
6. `DEPLOYMENT.md` (operational config, canonical env var names)
7. `AI_BUILD_PLAYBOOK.md` (process)

## Non-Negotiable Rules

### Tenant Isolation

- EVERY database query on tenant-scoped models MUST include `organizationId`
- Use `findFirst` with org scope or composite unique -- NEVER raw `findUnique({ id })` alone
- Prisma middleware is defense-in-depth, not primary access control
- RLS is REQUIRED in production (SET LOCAL, never SET)
- Return 404 (not 403) for cross-tenant access to prevent existence disclosure
- Tenant org is ALWAYS from authenticated session, NEVER from request headers or body

### Architecture

- All state mutations go through CoreService layer (`src/services/`)
- CoreService methods tagged `@readonly` or `@mutating`; only mutating emits events
- Provider interfaces for ALL external integrations (StorageProvider, EmailProvider, etc.)
- No direct cloud SDK calls outside provider implementations
- Background work through BullMQ job queue, never in request path
- App tier MUST remain stateless
- Atomic file writes: write to `.tmp`, then rename

### Auth & Sessions

- Custom DB-backed sessions (NOT NextAuth.js)
- Cookie name: `vaultspace-session` (HttpOnly, Secure, SameSite=Lax)
- Idle timeout: 24 hours (sliding window); Absolute max: 7 days
- Org roles: Owner, Admin, Member. Room roles: Admin, Viewer.

### Security

- Events are immutable once emitted
- Signed preview URLs: 5-minute expiry with client-side refresh (ALL providers, including local)
- Virus scanning (ClamAV) before any document becomes viewable
- All 16 mandatory security tests (SEC-001 through SEC-016 in PERMISSION_MODEL.md) must pass

### Jobs

- All background jobs MUST be idempotent (safe for BullMQ redelivery)
- Worker types: general, preview, scan, report
- Job priority classification: High (preview, scan), Normal (email), Low (analytics), Scheduled (retention)

## MVP Scope

63 features across 6 build phases (Layers 0-6). See `AI_BUILD_PLAYBOOK.md` for the full phase breakdown.

**Do NOT implement V1+ features during MVP.** The feature matrix is the single source of truth for what's in scope. Provider interfaces + NoOp defaults ship as MVP infrastructure even when the user-facing feature is V1 (see CANONICAL_CONTRACTS.md Section 4).

## Key Commands

```bash
# Static Analysis (runs locally, no runtime)
npm run type-check                   # TypeScript type checking
npm run lint                         # ESLint
npm run test                         # Unit tests (no database required)

# Azure Mode (default)
DATABASE_URL=<azure-postgres-url> npm run test:integration
az containerapp up ...               # Deploy to Azure
DATABASE_URL=<azure-postgres-url> npm run db:migrate

# Standalone Mode
npm run dev:standalone               # Local development server
npm run worker:standalone            # Local worker process
npm run test:integration:standalone  # Integration tests against localhost
npm run db:migrate:dev               # Create migrations (local DB)
npm run db:push                      # Push schema to local DB
npm run db:studio                    # Prisma Studio (local DB)
```

## Project Structure

```
src/
  app/                    # Next.js App Router (pages, layouts, API routes)
  components/             # React components (TailwindCSS)
  services/               # CoreService Layer (business logic, event emission)
  providers/              # Provider/Adapter implementations
  lib/                    # Shared utilities (PermissionEngine, EventBus, azure-guard)
  workers/                # Background worker entry points
  instrumentation.ts      # Azure-only runtime guard
prisma/
  schema.prisma           # Database schema
  migrations/             # Migration files
  seed.ts                 # Demo seed data
infra/                    # Azure deployment configuration
```

## Operational Rules for AI Code Generation

- **Work one phase at a time.** Do not start Phase N+1 until Phase N success criteria pass.
- **Read only the docs relevant to the current phase.** The playbook lists which docs matter for each phase. Do not pre-read later-phase docs.
- **Always read CANONICAL_CONTRACTS.md before any implementation.** It overrides conflicting details in other docs.
- **Run verification after each phase:** `npm run type-check && npm run lint && npm run test`
- **Never skip tenant isolation.** Every new database query must include `organizationId`. No exceptions.
- **When in doubt, check the precedence hierarchy.** Feature matrix > CANONICAL_CONTRACTS > DATABASE_SCHEMA > PERMISSION_MODEL > ARCHITECTURE > DEPLOYMENT > playbook.
- **Do not implement features marked V1 or later.** If a feature ID is not in the "Authoritative MVP Scope Declaration" section of the feature matrix, skip it entirely. Ship the NoOp provider interface only.
- **Commit after each logical unit of work.** Do not batch an entire phase into one commit. Prefer small, reviewable commits (one feature or one service at a time).

## Style Guide

- TypeScript strict mode
- ESLint + Prettier
- Functional React components with hooks
- Server Components by default; Client Components only when needed
- All API routes validate input with Zod
- All services use dependency injection via CoreServiceContext
- Prefer named exports over default exports
