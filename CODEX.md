# CODEX.md - VaultSpace AI Agent Context

> **This file is a summary pointer. The authoritative sources are listed below.**
> If this file conflicts with any linked document, the linked document takes precedence.

## Shared AI Roles

VaultSpace uses shared operating roles across AI tools. See [AI_ROLES.md](./AI_ROLES.md) for the canonical definitions of `Advisor` and `Lead Dev` and for role-switching rules.

## Project

VaultSpace: open-source, self-hosted Virtual Data Room. AGPLv3 license.

## Authoritative Documents (read in this order)

1. [AI_BUILD_PLAYBOOK.md](./AI_BUILD_PLAYBOOK.md) - Implementation entrypoint, rules, MVP stop conditions
2. [dataroom-feature-matrix-v6.md](./dataroom-feature-matrix-v6.md) - 151 features, 63 MVP, SOC2/HIPAA compliance mapping
3. [CANONICAL_CONTRACTS.md](./CANONICAL_CONTRACTS.md) - Settled disputes: auth, roles, env vars, signed URLs, state machine, MVP infra vs V1
4. [ARCHITECTURE.md](./ARCHITECTURE.md) - System design, 13 provider interfaces, CoreService pattern
5. [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Prisma schema, composite FKs, RLS operational contract + policy SQL
6. [PERMISSION_MODEL.md](./PERMISSION_MODEL.md) - 14-layer PermissionEngine, 16 security tests (SEC-001 to SEC-016)
7. [EVENT_MODEL.md](./EVENT_MODEL.md) - EventBus contract, event types, partitioning
8. [DEPLOYMENT.md](./DEPLOYMENT.md) - Docker Compose, environment variables (canonical source for env var names), worker config
9. [CONTRIBUTING.md](./CONTRIBUTING.md) - Code style, testing requirements
10. [SECURITY.md](./SECURITY.md) - Security policies, vulnerability handling

## Implementation Detail Documents

- [AUTH_AND_SESSIONS.md](./AUTH_AND_SESSIONS.md) - Session management, password hashing, login flows
- [API_SPEC.md](./API_SPEC.md) - REST endpoints, request/response schemas, error format
- [FILE_HANDLING.md](./FILE_HANDLING.md) - Upload flow, preview pipeline, file type mapping
- [PROVIDER_DEFAULTS.md](./PROVIDER_DEFAULTS.md) - Default implementations for all 13 providers
- [EMAIL_TEMPLATES.md](./EMAIL_TEMPLATES.md) - Transactional email content and structure
- [JOB_SPECS.md](./JOB_SPECS.md) - Job payloads, retry policies, dead letter handling
- [UI_WIREFRAMES.md](./UI_WIREFRAMES.md) - Page layouts, component hierarchy, design tokens
- [SEED_DATA.md](./SEED_DATA.md) - Test data, sample users, Series A Funding Room

## Canonical Bootstrap Contract

- **Stack:** Next.js 14+, TypeScript, React 18+, Prisma ORM, PostgreSQL 15+, TailwindCSS, Redis/BullMQ
- **Package manager:** npm
- **Node:** 20+ LTS
- **Layout:** src/app/, src/lib/, src/services/, src/providers/, src/workers/
- **Ports:** Next.js 3000, PostgreSQL 5432, Redis 6379, Gotenberg 3001
- **Auth:** Custom DB sessions (NOT NextAuth.js), cookie: `vaultspace-session`
- **Org roles:** Owner, Admin, Member. **Room roles:** Admin, Viewer.
- **License:** AGPLv3

## Status

Specification complete. Implementation not started. 63 MVP features across 6 build phases.
