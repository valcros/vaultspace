# AI Build Playbook - VaultSpace MVP

## Purpose

This document is the **single entrypoint for AI coding agents** (Claude Code, Codex, etc.) implementing VaultSpace MVP. It defines reading order, precedence rules, generated artifacts, implementation constraints, and MVP completion criteria.

VaultSpace also uses shared operating roles across AI tools. See `AI_ROLES.md` for the canonical definitions of `Advisor` and `Lead Dev` and for role-switching rules.

**Golden Rule:** Read documents in order, follow precedence rules, implement phases sequentially, and stop when MVP criteria are met. Do NOT skip phases, do NOT implement V1 features during MVP.

---

## Document Reading Order (MANDATORY)

AI agents **MUST** read documents in this exact order before writing any code:

1. **This file** (AI_BUILD_PLAYBOOK.md) — Implementation rules, anti-patterns, stop conditions
2. **dataroom-feature-matrix-v6.md** — Section "Authoritative MVP Scope Declaration" — Know exactly what 63 features are in scope
3. **CANONICAL_CONTRACTS.md** — Settled disputes: auth, roles, env vars, signed URLs, state machine, MVP infra vs V1 features
4. **ARCHITECTURE.md** — System design, provider interfaces, CoreService pattern, directory structure, build order
5. **DATABASE_SCHEMA.md** — Prisma schema, tenant isolation patterns, RLS contract and policy SQL
6. **PERMISSION_MODEL.md** — PermissionEngine API, evaluation algorithm, security test matrix (SEC-001 to SEC-016)
7. **EVENT_MODEL.md** — EventBus contract, event types, partitioning strategy
8. **DEPLOYMENT.md** — Docker Compose setup, environment variables (single source of truth for env var names), worker configuration
9. **CONTRIBUTING.md** — Code style, testing requirements, PR conventions
10. **SECURITY.md** — Security policies, vulnerability handling, signed URL policies

### Implementation Detail Documents (read during the relevant build phase)

These documents provide the granular specifications needed for uninterrupted development. Read them as you enter the phase that requires them.

11. **AUTH_AND_SESSIONS.md** — Session tokens, password hashing, login/logout flows, CSRF protection (Phase 1)
12. **API_SPEC.md** — REST endpoints, request/response schemas, error format, rate limiting (Phase 1+)
13. **FILE_HANDLING.md** — Upload flow, preview pipeline, file type mapping, document state machine (Phase 2)
14. **PROVIDER_DEFAULTS.md** — Default implementations for all 13 providers, factory pattern (Phase 1)
15. **EMAIL_TEMPLATES.md** — 10 transactional email templates, notification preferences, deduplication (Phase 1)
16. **JOB_SPECS.md** — 12 job types, payload interfaces, retry policies, dead letter handling (Phase 2)
17. **UI_WIREFRAMES.md** — Design tokens, page wireframes, component library, accessibility (Phase 1+)
18. **SEED_DATA.md** — Test organizations, users, Series A Funding Room demo data (Phase 0)

**Why this order?** Documents 1-10 establish the architecture, constraints, rules, and resolved disputes. Documents 11-18 provide implementation-level detail. Skip a document and you will make incorrect design decisions.

---

## Precedence Rules

When documents conflict, this hierarchy applies (top wins):

1. **dataroom-feature-matrix-v6.md** "Authoritative MVP Scope Declaration" — Feature scope is final
2. **CANONICAL_CONTRACTS.md** — Resolved disputes (auth, roles, env vars, state machine, MVP infra)
3. **DATABASE_SCHEMA.md** — Data model and constraints are immutable
4. **PERMISSION_MODEL.md** — Security invariants override convenience
5. **ARCHITECTURE.md** — System design (stateless app, event-driven, provider pattern)
6. **DEPLOYMENT.md** — Operational configuration (single source of truth for env var names)
7. **This playbook** — Process and sequencing

**Example:** If ARCHITECTURE.md suggests a synchronous operation but DATABASE_SCHEMA.md requires async, use async. If a feature seems fast to implement synchronously but PERMISSION_MODEL.md requires async, follow PERMISSION_MODEL.md.

---

## Non-Negotiable Implementation Rules

These rules protect security, scalability, and auditability. They must be followed even if they slow development.

### Tenant Isolation (CRITICAL)

- **EVERY database query on a tenant-scoped model MUST include organizationId filter**
  - Bad: `const user = await db.user.findFirst({ where: { id: userId } })`
  - Good: `const user = await db.user.findFirst({ where: { id: userId, organizationId } })`
- **NEVER fetch by raw ID alone on models with organizationId** — even for "internal" endpoints
- Prisma middleware (in DATABASE_SCHEMA.md) is **defense-in-depth**, NOT primary access control
- **Row-Level Security (RLS) policies MUST be created for all tenant-scoped tables before MVP is production-ready**
  - See DATABASE_SCHEMA.md section "Row Level Security (RLS)" for exact SQL
- **Always return 404 (not 403) for cross-tenant access attempts** to prevent existence disclosure
  - Exception: If user doesn't exist at all, 404. If user exists but wrong tenant, still 404.

### Security

- **All state mutations go through CoreService layer** (never bypass for convenience or speed)
  - Example: Don't call `db.document.update()` directly from an API route; use `coreService.updateDocumentMetadata()`
- **Events are immutable once emitted** — don't modify or delete EventLog entries (soft-delete only for compliance)
- **Signed preview URLs expire in 5 minutes** with client-side refresh capability (see SECURITY.md)
- **Virus scanning runs before any document becomes viewable** — never expose a document until scan passes
- **All 16 mandatory security tests (SEC-001 through SEC-016, in PERMISSION_MODEL.md) must pass before MVP is complete**

### Architecture

- **Provider interfaces MUST be used for all external integrations** (storage, email, search, monitoring, etc.)
  - Never call cloud SDKs directly (no direct S3 SDK calls, no direct Azure SDK calls)
  - All provider calls go through typed interfaces: `StorageProvider`, `EmailProvider`, `SearchProvider`, etc.
- **No direct cloud SDK calls outside provider implementations** — if you need a new capability, extend the provider interface
- **Background work MUST go through BullMQ job queue**, never in request path
  - Preview generation, virus scanning, OCR, ZIP exports, notifications — all jobs
  - API handler returns immediately; worker processes asynchronously
- **App tier MUST remain stateless** — no session affinity, no memory caches that outlive a request
  - All caching goes through CacheProvider (Redis or in-memory for dev)
  - All job queues are external (Redis or fallback)

### Audit & Compliance

- **Every action that mutates state MUST emit an event**
  - Document uploaded, document deleted, permission changed, room archived — all emit events
  - Event format defined in EVENT_MODEL.md
- **Audit trail MUST be queryable by admins** (implemented in audit log UI)
- **GDPR deletion MUST soft-delete user data**, not destroy records (RLS + audit compliance)

---

## MVP Build Sequence

Implementation must follow this sequence. Do NOT skip phases or reorder tasks.

### Phase 0: Project Scaffold

**Duration:** ~4-6 hours (automated by `create-next-app`)

**Outcome:** Runnable Next.js project with all boilerplate, database connected, Docker Compose working

**Generated Artifacts:**

- `package.json` (Next.js 14+, TypeScript, Prisma, BullMQ, TailwindCSS, testing frameworks)
- `tsconfig.json` (strict mode)
- `.env.example` (from DEPLOYMENT.md environment variables section)
- `docker-compose.yml` (app, postgres, redis, optional gotenberg)
- `.gitignore`, `.env`, `.editorconfig`
- GitHub Actions CI pipeline (`.github/workflows/ci.yml`, `build.yml`)
- `Dockerfile` (app) and `Dockerfile.worker` (job worker)
- `src/` directory structure (see ARCHITECTURE.md section "Directory Structure")
- `prisma/schema.prisma` (skeleton, populated in Phase 1)
- Initial database migration (`001_init.sql`)
- README.md with deployment quickstart

**Success Criteria:**

- `npm install && npm run dev` launches app on `http://localhost:3000`
- `docker-compose up` launches all services (app, DB, Redis)
- TypeScript compiles with zero errors (`tsc --noEmit`)
- ESLint passes (`npm run lint`)

---

### Phase 1: Layer 0-1 (Foundation + Infrastructure Primitives)

**Duration:** ~40-60 hours

**Features:** F004, F059, F062-F066, F068, F070, F100, F102, F103, F105, F141, F142, F146-F149, F152-F155

**Key Implementations:**

#### Database & Schema (F064, F068)

- Complete `prisma/schema.prisma` from DATABASE_SCHEMA.md
  - All models with `organizationId`, `createdAt`, `updatedAt`
  - Composite unique constraints for tenant scoping
  - RLS enable flag in PostgreSQL schema
- Write initial migration: `001_init.sql`
- Prisma middleware for automatic `organizationId` filtering (see DATABASE_SCHEMA.md)

#### Authentication & Roles (F004, F105)

- Session management: `lib/auth/sessionManager.ts`
  - PostgreSQL-backed sessions with Redis caching (see AUTH_AND_SESSIONS.md)
  - Session timeout: 24-hour idle (sliding window), 7-day absolute maximum. See AUTH_AND_SESSIONS.md.
- Role system: Organization roles: Owner, Admin, Member. Room roles: Admin, Viewer. (constants in `lib/constants.ts`)
- User model with hashed password (bcrypt)

#### Organization & Multi-Tenancy (F142)

- Organization model in database (name, tier, created, updated)
- Default organization for self-hosted installs
- Middleware: `lib/middleware/tenantMiddleware.ts` — extract org from authenticated session (NEVER from request headers or body)

#### Email Provider (F059)

- `lib/providers/EmailProvider.ts` interface
  - `sendEmail(to, subject, html, replyTo?, template?)`
- Two implementations:
  - `SmtpEmailProvider` (default) — uses `nodemailer`
  - Stub provider for development
- SMTP credentials from `.env` (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_TLS, SMTP_FROM)

#### Local Storage Provider (F070)

- `lib/providers/StorageProvider.ts` interface
  - `put(bucket, key, buffer)`, `get(bucket, key)`, `delete(bucket, key)`
  - `getSignedUrl(bucket, key, expiresIn)`
- `LocalStorageProvider` implementation
  - Uses local disk: `./storage/{bucket}/{key}`
  - Signed URLs are time-bounded tokens verified at serve time
- S3-compatible provider available at MVP (STORAGE_ENDPOINT, STORAGE_KEY_ID, STORAGE_SECRET_KEY)

#### Job Queue (F100)

- BullMQ + Redis setup
- `lib/queue/jobQueue.ts` — register job types
- Worker process: `worker.ts` (runs in separate container via docker-compose)
- Job types (defined in EVENT_MODEL.md):
  - `preview-pipeline` (convert, extract, thumbnail, index)
  - `virus-scan`
  - `ocr`
  - `email-send`
  - `backup`
  - `zip-export`

#### EventBus (F102)

- `lib/events/EventBus.ts` interface
  - `emit(eventType, payload, actor, requestId)` — returns Promise<void>
  - Stores in `Event` table (see DATABASE_SCHEMA.md)
- Event types (from EVENT_MODEL.md):
  - `document.uploaded`, `document.deleted`, `document.viewed`
  - `permission.changed`, `room.created`, `room.archived`
  - etc.
- Events are immutable; include request_id, actor_id, timestamp, IP, user-agent

#### Cache Service (F103)

- `lib/providers/CacheProvider.ts` interface
  - `get(key)`, `set(key, value, ttl)`, `delete(key)`
- `RedisCacheProvider` (production)
- `InMemoryCacheProvider` (development fallback)
- Used for: sessions, rate limit buckets, query caches

#### Permission Engine (F141)

- `lib/permissions/PermissionEngine.ts`
  - `evaluate(actor, action, resource) → boolean`
  - Supports role-based rules, group membership, link-based permissions
  - Full spec in PERMISSION_MODEL.md
- Example: Can user X view document Y? PermissionEngine.evaluate('user123', 'view', 'doc456')

#### Rate Limiting (F104)

- Middleware: `lib/middleware/rateLimitMiddleware.ts`
  - Token bucket algorithm using CacheProvider
  - Limits: 100 requests/min per IP for viewers, 1000/min for admins (configurable)
  - Returns 429 with Retry-After header

**Generated Artifacts:**

- Complete Prisma schema with all models
- `lib/providers/` — Provider interfaces and implementations
- `lib/events/EventBus.ts` and event type definitions
- `lib/permissions/PermissionEngine.ts`
- `lib/auth/sessionManager.ts`
- Middleware: tenant, rate limit, auth guards
- `.env` configuration template
- Database migrations (001_init.sql with RLS)
- BullMQ worker setup and registration
- GitHub Actions: lint, type-check, unit tests

**Success Criteria:**

- Prisma schema compiles: `npx prisma generate`
- All environment variables from .env.example are documented
- Database migrations apply: `npm run db:migrate`
- Job queue worker starts: `npm run worker`
- PermissionEngine unit tests pass for 10 scenarios (admin, viewer, group, link)
- Rate limiting blocks 101st request within 1-minute window
- EventBus emits and stores 5 test events in database
- CI passes (lint, type-check, unit tests)

---

### Phase 2: Layer 2 (Document Pipeline)

**Duration:** ~30-40 hours

**Features:** F006, F020, F101, F104, F105, F137

**Key Implementations:**

#### Upload Endpoint (F006)

- `POST /api/rooms/:roomId/documents/` — multipart form
  - Accepts: file, folderPath (optional), tags (optional)
  - Returns: documentId, status="scanning"
  - Creates Document, DocumentVersion, FileBlob records
- Validation:
  - File size < 500 MB (configurable)
  - Allowed mime types (see DATABASE_SCHEMA.md)
  - Rate limiting: 10 uploads/min per user
- Trigger async job: `preview-pipeline` + `virus-scan`

#### Preview Pipeline (F101)

- Worker job that runs after upload
- Steps (in order):
  1. **Virus Scan** — ClamAV or configured ScanProvider
     - If fails: mark document as quarantined, notify admin
     - If passes: proceed
  2. **Preview Conversion** — Gotenberg or LibreOffice
     - Input: original file
     - Output: preview images (PNG), one per page
     - Supported formats: PDF, DOCX, XLSX, PPTX, images (see F009)
  3. **Text Extraction** — pdfparse, poppler, etc.
     - Output: ExtractedText record with full-text searchable content
  4. **Thumbnail Generation** — First page preview, resized to 200x300px
  5. **Search Indexing** — Add to SearchIndex (PostgreSQL FTS for MVP)
- On completion: mark document as "ready" (status = "active")
- On failure: mark as "error", notify admin

**Note:** Text extraction and FTS indexing run as part of the MVP preview pipeline (infrastructure). The user-facing search UI/API (F011) is V1.

#### User Groups (F020)

- Models: `Group` (name, organizationId), `GroupMember` (userId, groupId)
- API routes:
  - `POST /api/users/groups` — create group
  - `GET /api/users/groups` — list groups
  - `POST /api/users/groups/:groupId/members` — add member
  - `DELETE /api/users/groups/:groupId/members/:userId` — remove member
- Groups used in permission evaluation (see PERMISSION_MODEL.md)

#### Session Management (F105)

- Middleware: auto-populate `req.session.userId`, `req.session.organizationId`
- Session timeout: 24-hour idle (sliding window), 7-day absolute maximum
- CSRF protection: `next-csrf` or similar

#### Backup/Restore (F137)

- Script: `scripts/backup.ts`
  - Exports all tables as JSONL to timestamped directory
  - Exports all blobs (documents, previews) to timestamped directory
  - Output: `./backups/2026-03-14T15-30-00Z/`
- Script: `scripts/restore.ts`
  - Takes backup directory
  - Restores database and blobs
  - Validates referential integrity

**Generated Artifacts:**

- Upload API endpoint
- Preview pipeline worker (scan → convert → extract → thumbnail → index)
- User groups CRUD
- Backup/restore scripts in `scripts/`
- Integration tests for upload → preview → ready state transition

**Success Criteria:**

- Upload 100 MB file: endpoint returns immediately with documentId
- Worker processes preview in background (verify via database polling)
- Document transitions to "ready" status after scan + conversion
- Text extraction works for PDF, DOCX, XLSX (verify ExtractedText content)
- Search index is populated (query returns document in results)
- Backup script creates timestamped directory with all data
- Restore script recovers database and blobs
- Rate limiting prevents >10 uploads/min per user

---

### Phase 3: Layer 3 (Document Features)

**Duration:** ~50-70 hours

**Features:** F007-F010, F106-F110, F132

**Key Implementations:**

#### In-Browser Viewer (F008)

- Component: `app/(viewer)/[roomId]/page.tsx`
  - Uses react-pdf (PDF.js wrapper) for PDF rendering
  - Displays preview images from PreviewAsset for other formats
  - One document at a time (selected from sidebar)
  - Shows: document name, version, uploaded by, upload date
- Watermarking support (see F023, defer to V1 if time-constrained)
- Export/download button (disabled if download not allowed per ACL)

#### Multi-Format Support (F009)

- Supported formats in preview pipeline:
  - PDF, DOCX, XLSX, PPTX, PNG, JPG, GIF, SVG, TXT, RTF
- Unsupported formats: return preview as "file icon + download link"

#### Document Indexing & Auto-Numbering (F010)

- Model: `DocumentIndex` (roomId, documentId, indexNumber, custom_name)
- API: `POST /api/rooms/:roomId/documents/:docId/index` — set position
- Display: "01 - Investor Deck", "02 - Financial Statements", etc.
- Auto-increment on upload (next number = max + 1)

#### File Integrity Hash (F106)

- On upload: compute SHA-256 of original file
- Store in `FileBlob.sha256`
- On download: verify hash matches (return 400 if corrupted)
- Chain: each DocumentVersion hash references previous version hash
  - Enables proof of immutability

#### Virus Scanning (F107)

- Job runs in worker (see Phase 2: Preview Pipeline)
- Provider: `ScanProvider.ts` interface
  - `scan(buffer) → Promise<{clean: boolean, threats?: string[]}>`
- Implementation: ClamAV (via clamlift or HTTP API)
- If infected: mark document quarantined, notify admin, prevent viewing
- Configuration: CLAMAV_HOST, CLAMAV_PORT in .env

#### OCR (F132)

- Job runs in worker for scanned documents (detected via preview pipeline heuristic)
- Provider: `OcrProvider.ts` interface
  - `extract(imageBuffer) → Promise<string>`
- Implementation: Tesseract.js (CPU-bound, run in separate worker thread)
- Output: ExtractedText combined with OCR results
- Enable full-text search on scanned documents

#### Room Templates (F109)

- Predefined templates: "Investor Data Room", "M&A Due Diligence", "Board Portal", "Compliance"
- Each template: default structure (folder names), default permissions (who can view), document types
- API: `POST /api/rooms/from-template?template=investor-data-room` — creates room with template structure
- Custom templates: create and save room structure for reuse

#### Room Lifecycle (F108)

- States: Draft, Active, Archived, Closed
- Transitions:
  - Draft → Active: admin clicks "publish"
  - Active → Archived: admin clicks "archive"
  - Archived → Active: admin clicks "reactivate"
  - Any → Closed: permanent closure (soft-delete)
- Permissions: Draft/Archived/Closed visible to admins only

#### Drag & Drop Upload (F007)

- Component: `app/(admin)/rooms/[roomId]/UploadZone.tsx`
  - HTML5 drag-and-drop
  - Shows progress bar
  - Preserves folder structure (drag folder → create Folder records)

#### Document Tagging & Metadata (F110)

- Model: `DocumentTag` (documentId, tag)
- API: `POST /api/rooms/:roomId/documents/:docId/tags` — add tag
- Tags searchable (full-text search includes tags)
- Custom metadata as JSON: `metadata: { vendor: "Acme Inc", fiscal_year: 2025 }`

**Generated Artifacts:**

- In-browser viewer component (PDF.js + preview images)
- Multi-format preview pipeline worker
- Document indexing API
- File integrity hash (SHA-256)
- Virus scanning worker (ClamAV)
- OCR worker (Tesseract.js)
- Room templates (5 templates)
- Room lifecycle management (state machine in CoreService)
- Drag-and-drop upload component
- Tagging and metadata API

**Success Criteria:**

- Upload PDF, DOCX, XLSX, PPTX — each converts to preview images
- Viewer displays preview images correctly
- OCR extracts text from scanned PDF (verify in ExtractedText)
- File integrity hash verified on download
- Virus scanning marks infected files as quarantined
- Room template creates folder structure correctly
- Room transitions through states (Draft → Active → Archived)
- Drag-and-drop preserves folder hierarchy
- Tags are searchable

---

### Phase 4: Layer 4 (Access Control & Audit)

**Duration:** ~50-70 hours

**Features:** F002, F005, F014, F016, F017, F019, F025, F113, F114, F116

**Key Implementations:**

#### Document Versioning (F002)

- Model: `DocumentVersion` (documentId, versionNumber, createdAt, createdBy, changeLog)
- On each re-upload: create new DocumentVersion
- Display version history in UI: "Uploaded by John on 2026-03-14"
- Rollback (defer if time-constrained): `PUT /api/documents/:docId/versions/:versionId/rollback`

#### Access Controls (F005)

- ACL model: `Permission` (resourceId, resourceType, subjectType, subjectId, level)
  - resourceId: room or document or folder
  - subjectType: user, group, publicLink
  - level: view, download, export, admin
- Evaluation: PermissionEngine.evaluate() (see Phase 1)
- API: `POST /api/rooms/:roomId/permissions`
  - `{ subjectType: "user", subjectId: "user123", level: "view" }`

#### Email Verification (F016)

- On link access for first-time viewer: send email with verification code
- Verification link: `https://example.com/verify?code=abc123`
- Code expires in 24 hours
- After verification: session created, viewer can access room

#### Password-Protected Rooms (F017)

- Room model: `Room.passwordHash` (optional)
- When viewer accesses room without password: modal prompts for password
- Verify against bcrypt hash
- Session includes password verification flag (prevents re-prompting)

#### Permission Levels (F019)

- Levels (ordered by privilege):
  - `view` — read-only, no download
  - `download` — view + download (if F014 enabled)
  - `export` — view + download + ZIP export
  - `admin` — full access
- Per-document override: can grant "view only" for one document even if user has "download" on room

#### Download Control (F014)

- Document model: `Document.downloadable` (boolean, default true)
- Admin can toggle per-document
- API: `PUT /api/rooms/:roomId/documents/:docId` — `{ downloadable: false }`
- Viewer UI disables download button if false

#### Audit Trail (F025)

- Display: `app/(admin)/rooms/[roomId]/audit/page.tsx`
- Shows all events for room (from Event table)
  - Filterable by action type, date range, actor
  - Searchable by actor name
- Events include: document uploaded, viewed, deleted, permission changed, room archived, etc.
- Export as CSV: `GET /api/rooms/:roomId/audit?format=csv`

#### Trash & Soft Delete (F114)

- Model: `Document.deletedAt` (nullable timestamp)
- Delete API: marks deletedAt, does NOT remove record
- Soft-deleted documents hidden from viewers, visible to admins in "Trash"
- UI: `app/(admin)/rooms/[roomId]/trash/page.tsx`
  - Shows deleted documents
  - Restore button: clear deletedAt
  - Permanent delete button (with confirmation): remove event + blobs

#### Archive/Export as ZIP (F113)

- Job: `zip-export`
- API: `POST /api/rooms/:roomId/export` — triggers job, returns jobId
- Worker:
  1. Fetch all documents in room (not soft-deleted)
  2. For each: include original file OR preview images (based on user permission)
  3. Create metadata.json (document list, permissions, audit summary)
  4. Zip all, upload to Storage with signed URL (5-minute expiry)
- Return: signed URL to user

#### Granular Link Permissions (F116)

- Model: `ShareLink` (roomId, token, expiresAt, maxViews, passwordHash, allowedDocumentIds)
- Create: `POST /api/rooms/:roomId/links`
  - `{ expiresAt: "2026-04-14T23:59:59Z", maxViews: 10, password: "secret", allowedDocumentIds: ["doc1", "doc2"] }`
- Share link: `https://example.com/r/{token}`
- Verification: token valid + not expired + view count < maxViews + password (if set) + document in allowedDocumentIds

**Generated Artifacts:**

- DocumentVersion model and versioning logic
- Permission (ACL) model and evaluation in PermissionEngine
- Email verification flow
- Password protection for rooms
- Permission levels UI
- Download control toggle
- Audit trail viewer and export
- Soft delete logic (deletedAt field)
- Trash UI with recovery
- ZIP export worker
- Share link generation and verification
- Integration tests for all access control scenarios

**Success Criteria:**

- Create document version on re-upload
- Version history shows in UI
- Grant user permission to room, viewer can access
- Revoke permission, viewer gets 404
- Email verification required for first-time viewer
- Room password protects access
- Download-disabled document cannot be downloaded
- Audit trail shows all 10+ action types
- Soft-deleted document not visible to viewers
- Export to ZIP includes all documents and metadata
- Share link with expiry expires after date

---

### Phase 5: Layer 5 (User-Facing Features)

**Duration:** ~30-40 hours

**Features:** F001, F003, F033-F035, F039, F121, F124, F130

**Key Implementations:**

#### Custom Domain Support (F001)

- Organization model: `customDomain` (optional, e.g., "docs.acme.com")
- Middleware: match request host to organization
- DNS setup: user CNAME to app domain
- SSL certificate: Let's Encrypt with dns-01 challenge (or manual upload)
- Fallback: default domain always available

#### Email Notifications (F003)

- Event subscribers: when document viewed, send email to room admins
- Models: `Notification` (userId, eventType, enabled)
- Templates:
  - "Document Viewed" — "User X viewed Document Y at TIME on DATE"
  - "Document Uploaded" — "User X uploaded Document Y (SIZE, TYPE)"
  - "Permission Changed" — "User X granted user Y permission LEVEL on Room Z"
- Async: job queue sends emails, never in request path
- Unsubscribe link in footer

#### Branded Viewer (F033)

- Customization per organization:
  - Logo: upload image
  - Color scheme: primary color picker
  - Footer text: custom HTML
  - Disable VaultSpace branding: toggle
- Applied to: viewer UI, email notifications, login page
- Storage: Organization.branding (JSON)

#### Mobile Responsive (F034)

- All pages responsive (TailwindCSS)
- Viewer: swipe to next document, pinch to zoom
- Forms: touch-friendly buttons, input fields
- Navigation: hamburger menu on mobile

#### No Account Required (F035)

- Viewer access via share link: `https://example.com/r/{token}`
- Viewer identity: email (required after first view) or anonymous
- Stored as `GuestSession` record with link association
- No password required (password optional per link)

#### Multi-Admin Support (F039)

- Room model: `Room.admins` (relationship to User)
- Multiple users can have admin role on same room
- Each admin: full access + can change permissions
- Remove admin: revoke permissions API

#### Room Activity Dashboard (F121)

- Component: `app/(admin)/rooms/[roomId]/analytics/page.tsx`
- Displays:
  - View count: total unique viewers, views per document
  - Upload activity: documents uploaded, last upload date
  - Download activity: files downloaded, download count per document
  - Member activity: team member list, who last accessed
  - Timeline: events over last 7/30/90 days (line chart)

#### Breadcrumb Navigation (F124)

- Display: `Home > Rooms > RoomName > FolderName > DocumentName`
- Clickable: each breadcrumb links to parent

#### Configurable Room Settings (F130)

- Room model: settings JSON
  - allowGuests: boolean (enable/disable public links)
  - allowDownload: boolean (override per-document toggle)
  - maxViewDuration: minutes (disconnect viewer if idle)
  - requirePassword: boolean (all links require password)
  - requireEmailVerification: boolean (all viewers must verify email)
  - allowPrint: boolean (show/hide print button)
  - watermarkText: string (optional, V1 if deferred)
- Settings UI: `app/(admin)/rooms/[roomId]/settings/page.tsx`

**Generated Artifacts:**

- Custom domain resolver middleware
- Email notification templates and job
- Branding customization UI and storage
- Mobile-responsive layouts (TailwindCSS)
- Guest session management
- Multi-admin assignment API
- Activity dashboard with charts (recharts or similar)
- Breadcrumb navigation component
- Room settings panel

**Success Criteria:**

- Custom domain resolves to org's branding
- Email notification sent when document viewed
- Branded viewer logo and colors visible
- Mobile layout responsive on 320px width
- Guest can access link without account
- Multiple admins can manage same room
- Dashboard shows view count and upload activity
- Breadcrumbs navigate correctly
- Room settings restrict downloads/printing as configured

---

### Phase 6: Layer 6 (Admin & Onboarding)

**Duration:** ~20-30 hours

**Features:** F040, F043, F044, F052, F128, F143

**Key Implementations:**

#### Admin Activity Log (F040)

- Display: `app/(admin)/settings/activity/page.tsx`
- Shows all events org-wide (not just one room)
  - User created, user deleted, room created, room archived
  - Permission changed, document uploaded, bulk operations
- Filterable by: user, action type, date range
- Exportable as CSV

#### Notification Preferences (F043)

- Model: `UserNotificationPreferences` (userId, eventType, emailEnabled)
- UI: `app/(admin)/settings/notifications/page.tsx`
  - Checkboxes for each notification type
  - "Email me when: document viewed, document uploaded, permission changed, etc."
- Honors user preferences in notification job

#### Team Member Invite (F044)

- API: `POST /api/users/invite`
  - `{ email: "john@example.com", role: "admin" | "member" }`
  - Sends email with sign-up link
  - Link includes token: `https://example.com/register?token=abc123`
  - Token pre-fills email and role assignment
- No duplicate invites (prevent spam)

#### GDPR Data Deletion (F052)

- API: `DELETE /api/users/:userId` (admin only)
  - User soft-deleted: set deletedAt
  - All documents by user: soft-deleted
  - All events: kept for audit (legal requirement), but userId redacted to "deleted_user"
  - All rooms: ownership transferred to requesting admin (if single owner)
- Script: `scripts/gdpr-export.ts`
  - Exports user's data (documents, events, permissions) as JSON
  - Encrypted if encryption key provided

#### Admin Setup Wizard (F128)

- First-run wizard: `app/(admin)/setup/page.tsx`
  - Step 1: Organization name
  - Step 2: Admin user (email, password)
  - Step 3: SMTP configuration (host, port, user, pass)
  - Step 4: Storage configuration (local or S3)
  - Step 5: Review & confirm
  - Writes to .env file and database
- Redirect admins to wizard if setup not complete

#### Demo Seed Data (F143)

- Script: `scripts/seed.ts`
- Creates:
  - Organization: "Series A Funding"
  - Room: "Due Diligence Package"
  - Sample documents (10 files):
    - Capitalization table (XLSX)
    - Pitch deck (PPTX)
    - Financial statements (XLSX)
    - Customer list (XLSX)
    - Technology roadmap (PDF)
    - Security audit (PDF)
    - Employee agreements (DOCX × 3)
    - Insurance certificate (PDF)
  - Sample folders: "Financials", "Legal", "Technical"
  - Sample users: Admin, 2 viewers
  - Sample permissions: viewers can view but not download
- Run: `npm run db:seed` (after migration)

**Generated Artifacts:**

- Admin activity log viewer
- Notification preferences UI
- User invite API and email
- GDPR deletion logic and export script
- Setup wizard
- Database seed script (Series A Funding room)
- Admin settings dashboard

**Success Criteria:**

- Admin sees all org-wide events in activity log
- User can enable/disable notifications per type
- Invited user receives email with sign-up link
- User deleted: no longer viewable, events redacted, but audit trail preserved
- First-run wizard prompts on new install
- Seed script creates Series A room with 10 documents
- New user can complete demo workflow: login → view room → view document → check audit trail

---

## Generated Artifacts Summary

By end of MVP, these artifacts exist:

### Code

- Next.js 14+ app with TypeScript
- Prisma schema + migrations
- API routes (auth, rooms, documents, permissions, users, search, audit)
- React components (viewer, admin dashboard, forms)
- Provider implementations (storage, email, cache, job queue, scan, OCR, search)
- EventBus and event emitters
- PermissionEngine with 16+ security tests
- Middleware (tenant, auth, rate limit, CSRF)
- Job workers (preview, scan, OCR, email, zip-export, backup)
- Helper scripts (backup, restore, seed, gdpr-export)

### Configuration

- docker-compose.yml (app, postgres, redis)
- .env.example with all variables documented
- Dockerfile and Dockerfile.worker
- GitHub Actions CI pipeline

### Documentation

- DATABASE_SCHEMA.md (complete Prisma schema)
- PERMISSION_MODEL.md (PermissionEngine spec + security tests)
- EVENT_MODEL.md (event types + consumption patterns)
- DEPLOYMENT.md (step-by-step Docker Compose)
- CONTRIBUTING.md (code style, testing, PR process)
- SECURITY.md (policies, vulnerability handling, signed URLs)
- README.md (quickstart, feature overview, license)
- CODE_OF_CONDUCT.md

### Data & Tests

- Seed data: Series A Funding room with 10 sample documents
- Unit tests: >80% coverage for PermissionEngine, EventBus, CoreService
- Integration tests: upload → preview → view → download workflow
- Security tests: 16 mandatory tests (SEC-001 through SEC-016)
- Fixtures: test rooms, test users, test permissions

---

## MVP Stop Condition

**MVP is COMPLETE when ALL of the following are true:**

1. **Feature Completeness**
   - All 63 features from "Authoritative MVP Scope Declaration" are implemented and functional
   - No feature is partial or stubbed

2. **Security**
   - All 16 mandatory security tests pass (SEC-001 through SEC-016 from PERMISSION_MODEL.md)
   - Tenant isolation enforced: all queries include organizationId
   - RLS policies created for all tenant tables
   - Cross-tenant requests return 404 (not 403)

3. **Deployability**
   - Docker Compose launches all services with one command: `docker-compose up`
   - All environment variables documented in .env.example
   - Database migrations apply automatically on first run
   - Seed data ("Series A Funding Room") loads successfully
   - App accessible at http://localhost:3000

4. **Core User Flow**
   - New user can: sign up → create room → upload document → share link → viewer accesses → audit trail visible
   - All steps work end-to-end without manual intervention
   - No error messages in console or logs during normal use

5. **Data Integrity**
   - Document versioning works (re-upload creates new version)
   - File hash verification works (SHA-256 chain)
   - Audit trail complete (all state changes recorded)
   - Soft delete works (trash recovery possible)
   - Backup/restore scripts functional

6. **Code Quality**
   - CI passes: `npm run lint`, `npm run type-check`, `npm run test`
   - No TypeScript errors or warnings
   - > 80% test coverage for core business logic
   - No console errors or warnings during normal operation

7. **Documentation**
   - All 9 design documents complete (ARCHITECTURE.md, DATABASE_SCHEMA.md, etc.)
   - README with deployment quickstart
   - Code comments on complex logic (PermissionEngine, event sourcing, preview pipeline)

---

## Implementation Conventions

These coding conventions apply across all phases. They are derived from best practices observed in production-grade open-source projects.

### 1. Atomic File Operations

All file writes to storage (previews, exports, thumbnails, OCR output) MUST use the atomic write pattern:

```typescript
// CORRECT: Write to temp, then rename (atomic on POSIX)
await fs.writeFile(`${targetPath}.tmp`, buffer);
await fs.rename(`${targetPath}.tmp`, targetPath);

// WRONG: Direct write (crash mid-write leaves corrupted file)
await fs.writeFile(targetPath, buffer);
```

This prevents partial-write corruption if a worker crashes during preview generation, ZIP export, or any storage write.

### 2. CoreService Method Classification

Tag every CoreService method as `readonly` or `mutating`:

```typescript
class DocumentService {
  /** @readonly */
  async getDocument(orgId: string, docId: string): Promise<Document> { ... }

  /** @mutating - emits document.uploaded */
  async upload(input: UploadInput, actor: Actor): Promise<Document> { ... }
}
```

Only `@mutating` methods emit events and write audit records. This classification also determines which operations are safe to retry on failure.

### 3. Structured Error Diagnostics

All error responses and job failures MUST include machine-readable metadata, not just string messages:

```typescript
interface OperationError {
  code: string; // e.g., "DOCUMENT_NOT_FOUND", "PERMISSION_DENIED"
  message: string; // Human-readable description
  operation: string; // e.g., "document.upload", "preview.convert"
  organizationId: string;
  resourceId?: string;
  actor?: string;
  retryable: boolean; // Can the caller retry this operation?
  suggestion?: string; // Actionable next step for debugging
}
```

This enables programmatic failure analysis via `jq` or log aggregation without parsing natural language.

### 4. Tiered Testing Strategy

| Tier | Scope                                                         | When to Run               | Speed    |
| ---- | ------------------------------------------------------------- | ------------------------- | -------- |
| 1    | Unit tests + SEC-001 through SEC-016 security tests           | Every commit, CI required | < 30s    |
| 2    | Integration tests against Docker Compose (DB, Redis, storage) | PR merge, CI required     | < 5 min  |
| 3    | End-to-end user journey (create room, upload, share, view)    | Release candidate         | < 15 min |

Tier 1 gates all PRs. Tier 2 gates merges to main. Tier 3 gates releases.

### 5. Documentation Generation from Source

API route documentation and provider interface docs SHOULD be generated from TypeScript source (JSDoc/TSDoc annotations + extraction script), not maintained by hand. Generated docs are committed to git and validated by CI (`git diff --exit-code` on generated files). This prevents documentation drift from implementation.

### 6. Idempotent Job Design

All background jobs MUST be idempotent. If a job is delivered twice (BullMQ at-least-once), the second execution produces no side effects:

```typescript
async processPreview(jobData: PreviewJobData): Promise<void> {
  // Check if already processed (idempotency guard)
  const existing = await this.previewRepo.findByVersionId(jobData.versionId);
  if (existing?.status === 'completed') return;

  // Process...
}
```

### 7. Version-Aware Deployments

Store the application git commit hash in a health endpoint (`GET /api/health`). During rolling deployments, compare running version against expected version. This prevents stale-container bugs where a pod serves old code after a deployment.

```typescript
// GET /api/health
{
  "status": "ok",
  "version": process.env.GIT_COMMIT_SHA,
  "uptime": process.uptime()
}
```

---

## Anti-Patterns (NEVER DO)

- **Never skip tenant scoping** "for simplicity" or "will add later" — this opens security holes. Add organizationId to EVERY query on tenant-scoped models.
- **Never store secrets in code or committed .env files** — use environment variables, load from .env (gitignored).
- **Never process documents synchronously in API handlers** — always queue jobs (preview, scan, OCR). Let handler return immediately.
- **Never access storage directly** — always use StorageProvider interface (enables multi-cloud).
- **Never trust client-supplied organizationId headers** — extract from authenticated session only.
- **Never use SET for RLS policies** — use SET LOCAL (transaction-scoped), see DATABASE_SCHEMA.md.
- **Never return 403 for cross-tenant requests** — use 404 to prevent existence disclosure (e.g., "user exists but not in your org").
- **Never modify or delete emitted events** — only soft-delete (set deletedAt) for compliance, see EVENT_MODEL.md.
- **Never implement V1 features during MVP** — stick to 63 features in scope. V1 features (webhooks, API rate limiting, SAML, etc.) are post-MVP.
- **Never hardcode feature flags or environment-specific logic** — use environment variables and feature matrix.
- **Never defer security or audit trail to V1** — they are core MVP (F141, F025, F052).

---

## Post-MVP Scope (V1 & Beyond)

**DO NOT IMPLEMENT DURING MVP.** These features follow MVP per the feature matrix:

- **V1 Critical Paths** (from feature matrix):
  - Webhooks (F058) — event subscribers
  - Advanced search (F011) — SearchProvider with PostgreSQL FTS (Meilisearch in V1+)
  - IP-based access rules (F021)
  - Time-based access (F022)
  - Watermarking (F023)
  - Page-level engagement tracking (F027)
  - Exportable activity reports (F031)
  - Mobile app (F042)
  - API documentation (F061)
  - Generic OIDC/OAuth2 SSO (F072)
  - LDAP/Active Directory (F073)
  - SAML 2.0 SSO (F140)
  - OpenTelemetry monitoring (F071)

- **V1+ Features**:
  - AI-powered document classification (F120+)
  - Custom integrations (Salesforce, HubSpot connectors)
  - Advanced reporting and analytics
  - Kubernetes/Helm deployment
  - Multi-region replication
  - Advanced DLP (Data Loss Prevention)

**When to start V1:** Only after MVP CI passes, security tests pass, and demo room works end-to-end.

---

## Key Documents Reference

- **dataroom-feature-matrix-v6.md** — Feature scope, dependencies, build order
- **ARCHITECTURE.md** — System design, provider interfaces, directory structure
- **DATABASE_SCHEMA.md** — Prisma models, RLS, tenant scoping
- **PERMISSION_MODEL.md** — PermissionEngine algorithm, security tests
- **EVENT_MODEL.md** — Event types, subscribers, partitioning
- **DEPLOYMENT.md** — Docker Compose, environment setup
- **CONTRIBUTING.md** — Code style, testing standards
- **SECURITY.md** — Policies, vulnerability handling, signed URLs
- **CODE_OF_CONDUCT.md** — Community guidelines

---

## Support & Debugging

**CI Failure?**

1. Check TypeScript: `npm run type-check`
2. Check lint: `npm run lint`
3. Check tests: `npm run test`
4. Check database: `npm run db:migrate`

**Database Issues?**

1. Reset: `npm run db:reset` (development only)
2. Check migrations: `npx prisma migrate status`
3. Check schema: `npx prisma studio` (GUI)

**Preview Pipeline Fails?**

1. Check Gotenberg: `docker-compose ps` (should be running)
2. Check logs: `docker-compose logs gotenberg`
3. Check job queue: `docker-compose logs app` (look for job errors)
4. Test conversion manually: `curl -F "files=@test.pdf" http://localhost:3001/api/convert`

**Permission Denied?**

1. Check organizationId in query
2. Check PermissionEngine evaluation: add logs
3. Check RLS policy: `psql -U postgres -d vaultspace -c "SELECT * FROM pg_policies;"`

---

## Version History

| Version | Date       | Changes                                                |
| ------- | ---------- | ------------------------------------------------------ |
| 1.0     | 2026-03-14 | Initial MVP playbook. 6 phases, 63 features, 7 layers. |

---

**End of AI Build Playbook**

This document is maintained in `/sessions/elegant-relaxed-curie/mnt/vaultspace/AI_BUILD_PLAYBOOK.md`.

For clarifications or updates, refer to the linked design documents.
