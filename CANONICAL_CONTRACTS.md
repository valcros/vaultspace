# VaultSpace - Canonical Implementation Contracts

> **Purpose:** This document settles every disputed or ambiguous implementation decision
> found across the VaultSpace specification documents. When any other document conflicts
> with a decision listed here, **this document wins**.
>
> **Precedence:** This document sits between the feature matrix and DATABASE_SCHEMA.md
> in the precedence hierarchy. It resolves ambiguities; it does not override the feature
> matrix's MVP scope or the database schema's data model.

**Last Updated:** 2026-03-14

---

## 1. Authentication Framework

**Decision:** Custom database-backed sessions. **Do NOT use NextAuth.js.**

| Property         | Value                                                            |
| ---------------- | ---------------------------------------------------------------- |
| Session storage  | PostgreSQL `sessions` table                                      |
| Session cache    | Redis (optional, for read performance)                           |
| Token format     | 256-bit random, base64url-encoded                                |
| Cookie name      | `vaultspace-session`                                             |
| Cookie flags     | `HttpOnly`, `Secure` (in production), `SameSite=Lax`, `Path=/`   |
| Idle timeout     | 24 hours (sliding window, extended on each request)              |
| Absolute maximum | 7 days (hard cap, regardless of activity)                        |
| Password hashing | bcrypt, 12 rounds                                                |
| CSRF protection  | `SameSite=Lax` cookie attribute (no separate CSRF token for MVP) |

**Canonical source for all session details:** AUTH_AND_SESSIONS.md

**What to ignore in other docs:**

- DEPLOYMENT.md references to `NEXTAUTH_SECRET` and `NEXTAUTH_URL` are **removed** (see fix below).
- AI_BUILD_PLAYBOOK.md's "24 hours for admins, 8 hours for viewers" is **wrong**. The correct contract is a single idle timeout of 24 hours for all roles, with a 7-day absolute cap.
- API_SPEC.md's cookie name `sessionToken` is **wrong**. The correct name is `vaultspace-session`.

---

## 2. Role Enums

**Decision:** Two separate role enums, not one.

### Organization Roles (persisted on `OrganizationMembership.role`)

```typescript
enum OrgRole {
  OWNER = 'owner', // Full control, billing, can delete org
  ADMIN = 'admin', // Manage rooms, users, settings
  MEMBER = 'member', // Viewer-level access on assigned rooms only
}
```

### Room Roles (persisted on `RoomMembership.role`)

```typescript
enum RoomRole {
  ADMIN = 'admin', // Full control within the room
  VIEWER = 'viewer', // View/download per document permissions
}
```

### Mapping Table

| Org Role | Default Room Access      | Can Create Rooms | Can Manage Users |
| -------- | ------------------------ | ---------------- | ---------------- |
| Owner    | Admin on all rooms       | Yes              | Yes              |
| Admin    | Admin on all rooms       | Yes              | Yes              |
| Member   | No access until assigned | No               | No               |

**What to ignore in other docs:**

- AI_BUILD_PLAYBOOK.md's `Admin, Viewer, TeamMember` is **wrong**. The correct enums are above.

---

## 3. Environment Variable Canonical Names

**Single source of truth:** DEPLOYMENT.md

Every implementation-detail document must use the variable names exactly as defined in DEPLOYMENT.md. The table below resolves the three naming conflicts found:

### Storage Provider Variables

| Canonical Name (DEPLOYMENT.md) | Wrong Names to Ignore                | Purpose                       |
| ------------------------------ | ------------------------------------ | ----------------------------- |
| `STORAGE_PROVIDER`             | —                                    | `local`, `s3`, `azure`        |
| `STORAGE_BUCKET`               | `S3_BUCKET`                          | Bucket/container name         |
| `STORAGE_REGION`               | `S3_REGION`                          | AWS region                    |
| `STORAGE_ENDPOINT`             | `AWS_S3_ENDPOINT`                    | Custom S3-compatible endpoint |
| `STORAGE_KEY_ID`               | `S3_ACCESS_KEY`, `AWS_ACCESS_KEY_ID` | AWS access key ID             |
| `STORAGE_SECRET_KEY`           | `AWS_SECRET_ACCESS_KEY`              | AWS secret access key         |

### Auth Variables

| Canonical Name   | Wrong Names to Ignore | Purpose                       |
| ---------------- | --------------------- | ----------------------------- |
| `SESSION_SECRET` | `NEXTAUTH_SECRET`     | Secret for session token HMAC |
| `APP_URL`        | `NEXTAUTH_URL`        | Application base URL          |

### Already Standardized (for reference)

| Variable                      | Source        | Notes                         |
| ----------------------------- | ------------- | ----------------------------- |
| `SMTP_PASSWORD`               | DEPLOYMENT.md | Not `SMTP_PASS`               |
| `SMTP_TLS`                    | DEPLOYMENT.md | Not `SMTP_SECURE`             |
| `SMTP_FROM`                   | DEPLOYMENT.md | Not `EMAIL_FROM_ADDRESS`      |
| `REDIS_URL`                   | DEPLOYMENT.md | Not `REDIS_HOST`/`REDIS_PORT` |
| `CLAMAV_HOST` + `CLAMAV_PORT` | DEPLOYMENT.md | Not `CLAMAV_URL`              |

---

## 4. MVP Infrastructure vs. V1 User-Facing Features

Some provider implementations ship as MVP infrastructure even though the user-facing feature that fully exposes them is V1. This table eliminates the ambiguity.

| Infrastructure (ships in MVP)    | User-Facing Feature (V1)    | What MVP includes                                    | What MVP does NOT include                                |
| -------------------------------- | --------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| PostgreSQL FTS indexing pipeline | F011 Full-text search       | Text extraction and indexing during preview pipeline | Search UI, search API endpoint, search results page      |
| NoOpEncryptionProvider           | F120 Encryption at rest     | Provider interface + no-op default                   | AES-256-GCM implementation, key management, key rotation |
| NoOpSignatureProvider            | F045 E-signatures (V2)      | Provider interface + no-op default                   | Signature capture UI, audit trail, DocuSign integration  |
| NoOpAIProvider                   | F074 AI categorization (V2) | Provider interface + no-op default                   | Document classification, auto-tagging                    |
| NoOpSSOProvider                  | F072 SSO/OIDC (V1)          | Provider interface + no-op default                   | OIDC/SAML login flows, IdP configuration                 |

**Rule:** If a provider interface is defined in ARCHITECTURE.md, the interface and its NoOp/default implementation ship in MVP Phase 1. The user-facing feature that activates the real implementation ships in its designated version (V1/V2/V3).

**What to ignore in other docs:**

- SECURITY.md's claim that "AES-256-GCM encryption at rest is MVP" is **wrong**. Encryption at rest (F120) is V1. MVP ships NoOpEncryptionProvider.

---

## 5. Signed URL Contract

**Decision:** ALL storage providers, including LocalStorageProvider, MUST enforce signed URL expiry.

| Property            | Value                                             |
| ------------------- | ------------------------------------------------- |
| Preview URL expiry  | 5 minutes (300 seconds)                           |
| Download URL expiry | 1 hour (3600 seconds)                             |
| Refresh mechanism   | Client-side timer requests new URL before expiry  |
| Env var             | `SIGNED_URL_EXPIRY_SECONDS=300` (preview default) |

**LocalStorageProvider implementation:** Generate HMAC-signed URLs with embedded expiry timestamp. The `/api/storage/[key]` endpoint verifies the HMAC and checks expiry before streaming the file. This is not optional -- security tests SEC-016 depend on it.

**What to ignore in other docs:**

- PROVIDER_DEFAULTS.md's comment "No expiry on signed URLs (assumption: local access is trusted)" is **wrong**. Local storage must enforce expiry.

---

## 6. Tenant Context Handling

**Decision:** Tenant organization is ALWAYS derived from the authenticated session. Never from request headers or request body.

```typescript
// CORRECT: Extract from session
const organizationId = session.organizationId;

// WRONG: Extract from header
const organizationId = req.headers['x-organization-id']; // NEVER DO THIS

// WRONG: Extract from request body
const organizationId = req.body.organizationId; // NEVER DO THIS
```

**tenantMiddleware behavior:**

1. Extract session token from `vaultspace-session` cookie
2. Look up session in database (or Redis cache)
3. Read `organizationId` from the session record
4. Attach to request context: `req.context = { organizationId, userId, orgRole }`
5. If no valid session, return 401

**What to ignore in other docs:**

- AI_BUILD_PLAYBOOK.md's "extract org from session/header" is **wrong**. Session only, never headers.

---

## 7. Demo Data Scope Resolution

**Decision:** Seed data (SEED_DATA.md) must NOT imply V1+ features are functional.

The following fields in seed data must be set to their MVP-safe defaults:

| Field              | MVP Value      | Reason                  |
| ------------------ | -------------- | ----------------------- |
| `requireNda`       | `false`        | F018 NDA gating is V1   |
| `enableWatermark`  | `false`        | F023 Watermarking is V1 |
| `ipAllowlist`      | `null` / empty | F021 IP allowlist is V1 |
| `legalHoldEnabled` | `false`        | F157 Legal hold is V1   |
| `ndaTemplateId`    | `null`         | F018 NDA gating is V1   |

The feature matrix description of F143 mentions "NDA gate" as part of the demo room. This is **descriptive of the V1 demo experience**, not the MVP demo. MVP seed data omits all V1 feature configurations.

---

## 8. API Route Scope

**Decision:** MVP uses `/api/*` routes (no version prefix). Public versioned API (`/api/v1/*`) is V1.

| Route Pattern      | Version | Purpose                            |
| ------------------ | ------- | ---------------------------------- |
| `/api/auth/*`      | MVP     | Authentication endpoints           |
| `/api/rooms/*`     | MVP     | Room CRUD and management           |
| `/api/documents/*` | MVP     | Document upload, download, preview |
| `/api/users/*`     | MVP     | User management                    |
| `/api/admin/*`     | MVP     | Admin operations                   |
| `/api/links/*`     | MVP     | Shared link management             |
| `/api/v1/*`        | V1      | Public versioned API with API keys |

**What to ignore in other docs:**

- Any reference to `/api/v1/` in MVP context is wrong. MVP routes have no version prefix.

---

## 9. Acceptance Test Locations

**Decision:** Security tests SEC-001 through SEC-016 are defined in PERMISSION_MODEL.md, not SECURITY.md.

| Test Category            | Location                                            | Test IDs                |
| ------------------------ | --------------------------------------------------- | ----------------------- |
| Security invariant tests | PERMISSION_MODEL.md, Section "Security Test Matrix" | SEC-001 through SEC-016 |
| Unit tests               | Per-module, co-located in `src/tests/unit/`         | —                       |
| Integration tests        | `src/tests/integration/`                            | —                       |
| E2E tests                | `src/tests/e2e/`                                    | —                       |

**MVP completion command sequence:**

```bash
npm run type-check          # Zero TypeScript errors
npm run lint                # Zero ESLint errors
npm run test                # All unit + SEC tests pass (Tier 1)
npm run test:integration    # All integration tests pass (Tier 2)
npm run test:e2e            # All E2E user journeys pass (Tier 3)
```

**All 16 SEC tests must pass before MVP is declared complete.**

---

## 10. Document Processing State Machine

**Decision:** Processing state lives on `DocumentVersion`, not `Document`. The `Document` model tracks lifecycle (ACTIVE/ARCHIVED/DELETED). The `DocumentVersion` model tracks processing via two fields:

```typescript
// On DocumentVersion model
scanStatus: 'PENDING' | 'SCANNING' | 'CLEAN' | 'INFECTED' | 'ERROR';
previewStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
```

**State transitions (scan):**

```
PENDING → SCANNING → CLEAN (proceed to preview)
                   → INFECTED (quarantine, notify admin)
                   → ERROR (retry up to 3 times, then permanent failure)
```

**State transitions (preview):**

```
PENDING → PROCESSING → READY (available to viewers)
                     → FAILED (retry up to 3 times, then show fallback)
```

**What to ignore in other docs:**

- FILE_HANDLING.md's 8-state model on `Document.status` is **wrong**. Processing state is on `DocumentVersion` via `scanStatus` and `previewStatus`.
- DATABASE_SCHEMA.md's `ScanStatus` enum of `PENDING/SCANNING/CLEAN/QUARANTINED` is **incomplete**. Add `ERROR` state. Rename `QUARANTINED` to `INFECTED` for consistency with FILE_HANDLING.md's quarantine semantics (both mean "virus detected, file isolated").

---

**Document ID:** N/A (governance document, not a feature)
