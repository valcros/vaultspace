# VaultSpace Architecture

**Status:** MVP Specification (Feature F148)
**Last Updated:** 2026-03-14
**Version:** 1.0

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Design Philosophy](#design-philosophy)
3. [Tech Stack](#tech-stack)
4. [Architecture Diagram](#architecture-diagram)
5. [Application Layers](#application-layers)
6. [Provider/Adapter Pattern](#provideradapter-pattern)
7. [Core Modules](#core-modules)
8. [Plugin/Extension Hook Architecture](#pluginextension-hook-architecture)
9. [Multi-Tenancy](#multi-tenancy)
10. [Security Architecture](#security-architecture)
11. [Request Flows](#request-flows)
12. [Directory Structure](#directory-structure)
13. [Build Order](#build-order)
14. [Cross-References](#cross-references)

---

## System Overview

**VaultSpace** is a cloud-agnostic, self-hosted secure document collaboration platform designed for use cases including investor data rooms, M&A due diligence, legal discovery, board portals, and compliance document sharing.

### Key Characteristics

- **Multi-tenant from day one:** Every database entity includes `organization_id`, enabling future SaaS deployments without schema migration
- **Self-hostable:** Docker Compose deployment with single command; no vendor lock-in
- **Cloud-agnostic:** Core uses provider/adapter pattern for storage, email, caching, job queues, and search
- **Event-driven:** All state changes emit immutable audit events; enables audit trail, analytics, webhooks, and forensics
- **Scalable:** Stateless app tier, separated worker tier, horizontal scaling via load balancer + shared Redis
- **Secure by default:** HTTPS everywhere, private storage with signed URLs, server-side permission checks, virus scanning, immutable audit log

### Positioning

General-purpose secure document library for organizations that need cryptographic integrity, audit compliance, granular access control, and complete activity traceability. Competitive with commercial VDRs (Datasite, Intralinks, Firmex) but self-hosted and open-source (AGPLv3).

---

## Design Philosophy

### Cloud-Agnostic

No hard dependency on any cloud provider. Core application uses provider interfaces (StorageProvider, EmailProvider, etc.) that can target:

- On-premises (local disk, SMTP)
- AWS (S3, SES, CloudFront)
- Azure (Blob Storage, Key Vault, Application Insights)
- GCP (Cloud Storage, CDN)
- Multi-cloud (app deployed to one cloud, storage to another)

### Multi-Tenant from Day One

Single codebase serves one or many organizations. Every table includes `organization_id`. Query middleware automatically scopes results to the current tenant. This enables:

- Self-hosted single-org installs (one default organization)
- Future SaaS multi-org deployments
- No schema migration required when pivoting

### Event-Driven Architecture

All domain state changes (uploads, permission changes, views, deletions) emit events via EventBus. Events are:

- Immutable: stored in database, never modified or deleted (soft-deleted if needed for compliance)
- Traceable: include request_id, session_id, actor_id, IP address, user-agent
- Partitioned: monthly partitioning by timestamp for query performance at scale
- Consumed by: audit trail, analytics, notifications, webhooks, reporting, compliance exports

### Adapter-Based Extensibility

Critical infrastructure layers use provider interfaces. At runtime, adapters are selected via environment variables:

- StorageProvider (local disk, S3-compatible, Azure Blob, GCP)
- EmailProvider (SMTP, SendGrid, Azure Communication Services, AWS SES)
- CacheProvider (Redis, in-memory LRU)
- JobProvider (BullMQ + Redis, in-process fallback)
- PreviewProvider (LibreOffice/Gotenberg, local disk or CDN)
- SearchProvider (PostgreSQL FTS, Meilisearch, OpenSearch)
- EncryptionProvider (env key, HashiCorp Vault, Azure Key Vault, AWS KMS)
- AuthSSOProvider (built-in, OIDC/OAuth2, LDAP, SAML)
- ScanProvider (ClamAV, etc.)
- MonitoringProvider (stdout logging, OpenTelemetry, Azure Insights)
- CDNProvider (none, Azure CDN, CloudFront, GCP CDN)
- AIProvider (OpenAI, Anthropic, local LLM via adapter in V2+)
- SignatureProvider (none, built-in, DocuSign via adapter in V2+)

---

## Tech Stack

| Component              | Technology                       | Rationale                                                                                                          |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Framework**          | Next.js 14+ (App Router)         | Server-side rendering, API routes, incremental static generation, excellent TypeScript support, modern React hooks |
| **Language**           | TypeScript                       | Type safety, IDE support, documentation-as-code, reduces runtime errors                                            |
| **Frontend**           | React 18+                        | Component model, hooks, concurrent rendering, excellent ecosystem                                                  |
| **Styling**            | TailwindCSS                      | Utility-first, consistent design system, small bundle, dark mode support built-in                                  |
| **ORM**                | Prisma 5+                        | Type-safe, auto-generated client, database-agnostic, migration tooling, excellent DX                               |
| **Database**           | PostgreSQL 15+                   | ACID compliance (critical for audit), rich types (JSON, arrays), FTS, time-based partitioning, row-level security  |
| **Cache & Queue**      | Redis (optional)                 | BullMQ for job queue, session caching, rate limiting; fallback to in-memory for small installs                     |
| **Job Queue**          | BullMQ                           | Reliable job processing with retries, priorities, concurrency control, dedicated workers                           |
| **Preview Conversion** | LibreOffice headless / Gotenberg | Multi-format support, handles PDF, DOCX, XLSX, PPTX, images, reliable                                              |
| **Virus Scanning**     | ClamAV                           | Open-source, reliable, no SaaS dependency, can run in separate container                                           |
| **Search**             | PostgreSQL FTS (MVP)             | Built-in, no external dependency; Meilisearch or OpenSearch in V1+                                                 |
| **Deployment**         | Docker Compose (MVP)             | Single command, includes app, PostgreSQL, Redis; Kubernetes/Helm in V2+                                            |

---

## Architecture Diagram

```
                    ┌─────────────────────────────┐
                    │   End Users / Admins        │
                    │   Browsers, API clients     │
                    └──────────────┬──────────────┘
                                   │ HTTPS
                                   ▼
                    ┌─────────────────────────────┐
                    │  DNS + TLS + Reverse Proxy  │
                    │  Nginx/Caddy/Traefik        │
                    │  (App Gateway / Front Door) │
                    └──────────────┬──────────────┘
                                   │
               ┌───────────────────┴───────────────────┐
               │                                       │
               ▼                                       ▼
    ┌─────────────────────────┐        ┌─────────────────────────┐
    │  App Instance 1         │        │  App Instance 2         │
    │  Next.js 14+ (App Router)├───────┤  Next.js 14+ (App Router)│
    │  Admin UI               │        │  Admin UI               │
    │  Viewer UI              │        │  Viewer UI              │
    │  API Routes             │        │  API Routes             │
    │  (Stateless)            │        │  (Stateless)            │
    └─────────────┬───────────┘        └─────────────┬───────────┘
                  │                                   │
                  └───────────────────┬───────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │                            │                            │
         ▼                            ▼                            ▼
    ┌────────────┐          ┌──────────────────┐        ┌──────────────────┐
    │ Redis      │          │ PostgreSQL 15+   │        │ Object Storage   │
    │ Sessions   │          │ ├─ users         │        │ (S3-compatible,  │
    │ Cache      │          │ ├─ rooms         │        │  Azure Blob,     │
    │ Rate limits│          │ ├─ documents     │        │  local disk)     │
    │ Queue      │          │ ├─ versions      │        │ ├─ originals     │
    │            │          │ ├─ permissions   │        │ ├─ previews      │
    │ (Optional) │          │ ├─ events        │        │ ├─ thumbnails    │
    │ Fallback:  │          │ ├─ audit_log     │        │ ├─ exports       │
    │ In-memory  │          │ └─ search_index  │        │ └─ backups       │
    └──────┬─────┘          └────────┬─────────┘        └──────┬───────────┘
           │                         │                         │
           │                         │                         │
           ▼                         │                         ▼
    ┌──────────────────┐              │           ┌──────────────────────┐
    │ Job Queue        │              │           │ Preview Workers      │
    │ (BullMQ)         │              │           │ LibreOffice          │
    │ ├─ High priority │◄─────────────┘           │ Gotenberg            │
    │ ├─ Normal        │                          │ OCR services         │
    │ ├─ Low           │                          └──────────┬───────────┘
    │ └─ Scheduled     │                                     │
    └──────┬───────────┘                                     │
           │                                                 ▼
           ▼                                        ┌──────────────────────┐
    ┌──────────────────┐                           │ Preview Cache /      │
    │ Worker Pool      │                           │ CDN (optional)       │
    │ ├─ general-worker│                           │ Azure CDN            │
    │ ├─ preview-worker│                           │ CloudFront           │
    │ ├─ scan-worker   │                           │ Local disk           │
    │ └─ report-worker │                           └──────────────────────┘
    └──────────────────┘

                              External Services (Adapters)

    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │ Email Service    │  │ Secrets Manager  │  │ Search Engine    │
    │ SMTP / SendGrid  │  │ Vault / KMS      │  │ Meilisearch      │
    │ AWS SES          │  │ Env variables    │  │ OpenSearch       │
    └──────────────────┘  └──────────────────┘  └──────────────────┘

    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │ Auth Provider    │  │ Monitoring       │  │ AI Services      │
    │ OIDC / LDAP      │  │ OpenTelemetry    │  │ OpenAI /         │
    │ SAML             │  │ Azure Insights   │  │ Anthropic (V2+)  │
    └──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## Application Layers

### 1. Presentation Layer

**Components:** React components, pages, layouts (Next.js App Router)

**Responsibilities:**

- Admin UI: room management, user management, settings, analytics dashboard
- Viewer UI: branded viewer, document display, watermark rendering, breadcrumb navigation
- Mobile-responsive design (Tailwind CSS)
- Form handling, client-side validation (before API call)
- Session state management (React Context or Zustand)
- WebSocket connections (future: real-time collaboration, activity feeds)

**Key Files:**

```
app/
├── admin/
│   ├── layout.tsx
│   ├── rooms/
│   │   ├── page.tsx
│   │   ├── [roomId]/
│   │   │   ├── layout.tsx
│   │   │   ├── documents/page.tsx
│   │   │   ├── members/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   ├── analytics/page.tsx
│   │   │   └── audit/page.tsx
│   ├── users/page.tsx
│   ├── settings/page.tsx
│   └── dashboard/page.tsx
├── viewer/
│   ├── layout.tsx
│   ├── [roomId]/
│   │   ├── layout.tsx
│   │   └── page.tsx
├── auth/
│   ├── login/page.tsx
│   ├── logout/page.tsx
│   └── callback/page.tsx
└── public/
    ├── rooms/
    │   └── [shareToken]/page.tsx
```

### 2. API Layer

**Components:** Next.js API routes, middleware, authentication, authorization

**Responsibilities:**

- REST endpoints for document/room/user operations
- Authentication (session tokens, API keys)
- Authorization (via PermissionEngine)
- Input validation, output serialization
- Error handling, logging
- Rate limiting middleware (via CacheProvider)
- CORS headers

**Key Files:**

```
app/api/
├── auth/
│   ├── login/route.ts
│   ├── logout/route.ts
│   ├── session/route.ts
│   ├── sso/route.ts
│   └── [...routes]/route.ts
├── rooms/
│   ├── route.ts                    # GET, POST
│   ├── [roomId]/
│   │   ├── route.ts                # GET, PATCH, DELETE
│   │   ├── documents/route.ts      # GET, POST
│   │   ├── documents/[docId]/
│   │   │   ├── route.ts            # GET, PATCH, DELETE
│   │   │   ├── versions/route.ts
│   │   │   ├── download/route.ts
│   │   │   ├── preview/route.ts
│   │   │   └── archive/route.ts
│   │   ├── members/route.ts
│   │   ├── links/route.ts
│   │   ├── audit/route.ts
│   │   ├── export/route.ts
│   │   └── settings/route.ts
├── users/
│   ├── route.ts                    # GET, POST
│   ├── [userId]/route.ts           # GET, PATCH, DELETE
│   └── [userId]/invitations/route.ts
├── search/route.ts
├── webhooks/
│   ├── route.ts
│   └── [webhookId]/route.ts
└── health/route.ts

middleware.ts                        # Auth, tenancy, CORS
```

**Middleware Chain:**

```typescript
1. Authentication Middleware
   ├─ Extract session token or API key
   ├─ Verify JWT/session
   ├─ Load user + organization
   └─ Attach to request context

2. Tenancy Middleware
   ├─ Ensure organization_id in request
   ├─ Scope queries to organization
   └─ Prevent cross-tenant data leaks

3. Rate Limiting Middleware
   ├─ Check per-IP limit (CacheProvider)
   ├─ Check per-user limit
   └─ Return 429 if exceeded

4. Logging & Tracing Middleware
   ├─ Assign request_id, session_id
   ├─ Log to MonitoringProvider
   └─ Track latency

5. Error Handling Middleware
   ├─ Catch exceptions
   ├─ Emit error events
   └─ Return standardized error responses
```

### 3. Service Layer

**Components:** Business logic modules, use cases, orchestration

**Responsibilities:**

- Document upload/download/deletion workflows
- Permission evaluation via PermissionEngine
- Event emission via EventBus
- Job queuing for async work
- Integration with external providers

**Key Modules:**

```
lib/services/
├── RoomService.ts
│   ├─ createRoom()
│   ├─ updateRoom()
│   ├─ deleteRoom()
│   ├─ archiveRoom()
│   └─ cloneRoom()
├── DocumentService.ts
│   ├─ uploadDocument()
│   ├─ createVersion()
│   ├─ deleteDocument()
│   ├─ getDocument()
│   ├─ listDocuments()
│   └─ tagDocument()
├── PermissionService.ts
│   ├─ evaluateAccess()
│   ├─ getEffectivePermissions()
│   ├─ explainPermission()
│   └─ updateACL()
├── PreviewService.ts
│   ├─ queuePreviewJob()
│   ├─ getPreviewStatus()
│   ├─ renderPreview()
│   └─ applyWatermark()
├── ShareLinkService.ts
│   ├─ createShareLink()
│   ├─ validateShareLink()
│   ├─ revokeShareLink()
│   └─ updateLinkPermissions()
├── UserService.ts
│   ├─ createUser()
│   ├─ inviteUser()
│   ├─ updateUser()
│   ├─ deleteUser()
│   └─ assignRole()
├── AuditService.ts
│   ├─ logEvent()
│   ├─ queryAuditTrail()
│   └─ exportAuditReport()
├── ExportService.ts
│   ├─ queueZipExport()
│   ├─ queuePdfBinder()
│   └─ queueComplianceExport()
└── NotificationService.ts
    ├─ sendViewNotification()
    ├─ sendDownloadNotification()
    └─ sendAccessRevoked()
```

### 3.5. CoreService Layer (Internal SDK)

**Purpose:** Shared internal API for all state-mutating operations. Both Next.js API routes and background workers use CoreService to ensure consistent behavior, event emission, and audit logging regardless of caller (Web UI, API key, CLI, worker).

**Key Principle:** All state mutations go through CoreService. API routes and workers are thin wrappers; they authenticate, authorize, call CoreService, and return responses.

**Architecture:**

```
API Routes / Workers
   ↓ (call)
CoreService (validates, executes business logic, emits events, queues jobs)
   ↓ (uses)
Data Access Layer (queries, transactions)
EventBus (event emission)
JobQueue (async work)
PermissionEngine (authorization)
```

**Services (in `src/services/`):**

```typescript
// lib/services/DocumentService.ts
class DocumentService {
  constructor(
    private db: PrismaClient,
    private eventBus: EventBus,
    private jobQueue: JobQueue,
    private permissionEngine: PermissionEngine,
    private storageProvider: StorageProvider
  ) {}

  /**
   * Core operation: Upload document. Validates, persists, emits event, queues preview job.
   * Called identically whether triggered by web UI, REST API, CLI, or background worker.
   */
  async upload(input: DocumentUploadInput, actor: Actor): Promise<Document> {
    // 1. Authorize (permission check)
    await this.permissionEngine.check(actor, 'document.upload', input.roomId);

    // 2. Validate input
    if (!input.file || input.file.size === 0) {
      throw new ValidationError('File is empty');
    }

    // 3. Execute business logic (transaction)
    const document = await this.db.$transaction(async (tx) => {
      // Store file
      const fileKey = `originals/${input.roomId}/${crypto.randomUUID()}/${input.file.name}`;
      await this.storageProvider.put(fileKey, input.file.buffer);

      // Create document record
      const doc = await tx.document.create({
        data: {
          organizationId: actor.organizationId,
          roomId: input.roomId,
          folderId: input.folderId,
          name: input.file.name,
          originalFileName: input.file.name,
          mimeType: input.file.mimetype,
          fileSize: input.file.size,
        },
      });

      // Create version
      await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          organizationId: actor.organizationId,
          versionNumber: 1,
          fileBlobKey: fileKey,
          status: 'PENDING',
        },
      });

      return doc;
    });

    // 4. Emit event (audit trail, webhooks, notifications)
    await this.eventBus.emit('document.uploaded', {
      documentId: document.id,
      roomId: input.roomId,
      actorId: actor.id,
      actorType: actor.type,
      ip: actor.ip,
      metadata: { fileName: input.file.name, fileSize: input.file.size },
    });

    // 5. Queue async work (preview generation, scanning)
    await this.jobQueue.enqueue(
      'preview',
      {
        documentId: document.id,
        versionId: version.id,
      },
      { priority: 'high' }
    );

    await this.jobQueue.enqueue(
      'scan',
      {
        documentId: document.id,
        fileBlobKey: fileKey,
      },
      { priority: 'high' }
    );

    return document;
  }
}

// lib/services/RoomService.ts
class RoomService {
  async create(input: RoomCreateInput, actor: Actor): Promise<Room> {
    // 1. Authorize
    await this.permissionEngine.check(actor, 'room.create');

    // 2. Validate
    if (!input.name || input.name.length < 1) {
      throw new ValidationError('Room name required');
    }

    // 3. Execute (create room, set default permissions)
    const room = await this.db.$transaction(async (tx) => {
      const r = await tx.room.create({
        data: {
          organizationId: actor.organizationId,
          name: input.name,
          status: 'DRAFT',
        },
      });

      // Grant creator admin access
      await tx.permission.create({
        data: {
          organizationId: actor.organizationId,
          subjectId: actor.id,
          subjectType: 'USER',
          resourceType: 'ROOM',
          resourceId: r.id,
          action: 'ADMIN',
        },
      });

      return r;
    });

    // 4. Emit event
    await this.eventBus.emit('room.created', {
      roomId: room.id,
      actorId: actor.id,
      metadata: { roomName: input.name },
    });

    // 5. Queue jobs (if needed)
    if (input.templateId) {
      await this.jobQueue.enqueue('room', {
        action: 'clone_template',
        roomId: room.id,
        templateId: input.templateId,
      });
    }

    return room;
  }
}

// lib/services/PermissionService.ts
class PermissionService {
  async grant(input: GrantPermissionInput, actor: Actor): Promise<Permission> {
    // 1. Authorize: only admins can grant permissions
    await this.permissionEngine.check(actor, 'permission.grant', input.resourceId);

    // 2. Validate
    if (!input.subjectId || !input.action) {
      throw new ValidationError('Subject and action required');
    }

    // 3. Create permission
    const permission = await this.db.permission.create({
      data: {
        organizationId: actor.organizationId,
        subjectId: input.subjectId,
        subjectType: input.subjectType,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        action: input.action,
      },
    });

    // 4. Emit event
    await this.eventBus.emit('permission.granted', {
      permissionId: permission.id,
      subjectId: input.subjectId,
      resourceId: input.resourceId,
      action: input.action,
      grantedBy: actor.id,
    });

    return permission;
  }
}
```

**API Route Thin Wrapper:**

```typescript
// app/api/rooms/[roomId]/documents/route.ts
export async function POST(request: NextRequest, context: { params: { roomId: string } }) {
  const { roomId } = context.params;

  try {
    // 1. Authenticate (extract actor from session/API key)
    const actor = await authenticateRequest(request);
    if (!actor) return response.unauthorized();

    // 2. Parse and validate input
    const input = await request.json();
    if (!input.file) return response.badRequest('File required');

    // 3. Call CoreService (all business logic here)
    const documentService = new DocumentService(...dependencies);
    const document = await documentService.upload({ ...input, roomId }, actor);

    // 4. Return response
    return response.created(document);
  } catch (err) {
    if (err instanceof UnauthorizedError) return response.forbidden();
    if (err instanceof ValidationError) return response.badRequest(err.message);
    throw err;
  }
}
```

**Background Worker Direct Call:**

```typescript
// workers/preview-worker.ts
jobQueue.process('preview', async (job) => {
  const { documentId, versionId } = job.data;

  // No HTTP overhead; call CoreService directly
  const documentService = new DocumentService(...dependencies);

  // This uses the SAME DocumentService.upload() and event emission
  // as the API route, ensuring identical behavior
  await documentService.generatePreview(documentId, versionId, {
    actorId: 'system',
    actorType: 'WORKER',
  });
});
```

**Benefits:**

- **Single source of truth** for business logic; no duplication between API routes, CLI, and workers
- **Consistent event emission:** All callers trigger the same events, enabling reliable audit trail and webhooks
- **Simplified API routes:** API becomes thin translation layer (auth → CoreService → response)
- **Easy to test:** CoreService is testable in isolation; doesn't depend on HTTP context
- **Worker integration:** Workers call CoreService directly; same behavior as API but without HTTP overhead
- **Audit trail completeness:** All state changes produce events; impossible to bypass audit by calling DB directly

**Directory Structure:**

```
src/
├── services/
│   ├── CoreServiceContext.ts      # DI container for services
│   ├── DocumentService.ts
│   ├── RoomService.ts
│   ├── PermissionService.ts
│   ├── UserService.ts
│   ├── ShareLinkService.ts
│   ├── ExportService.ts
│   ├── AuditService.ts
│   └── index.ts                   # Export factory
├── api/
│   ├── rooms/
│   ├── documents/
│   └── ... (thin wrappers)
├── workers/
│   ├── preview-worker.ts          # Uses DocumentService.generatePreview()
│   ├── scan-worker.ts
│   └── ...
└── lib/
    ├── providers/
    ├── db/
    └── ...
```

### 4. Data Access Layer

**Components:** Prisma ORM client, repository pattern, query builders

**Responsibilities:**

- Database queries (read, write, update, delete)
- Transaction management
- Tenant isolation via Prisma middleware
- Soft-delete auto-exclusion: automatically filters `deletedAt IS NULL` from all queries
- Query optimization (indexes, eager loading)
- Database migrations

**Key Files:**

```
lib/db/
├── prisma.ts                       # Prisma client singleton
├── middleware.ts                   # Tenant scoping middleware
└── repositories/
    ├── RoomRepository.ts
    ├── DocumentRepository.ts
    ├── UserRepository.ts
    ├── PermissionRepository.ts
    ├── EventRepository.ts
    ├── SearchIndexRepository.ts
    └── AuditRepository.ts

prisma/
├── schema.prisma                   # Schema definition
├── migrations/                      # Migration files (auto-generated)
└── seed.ts                         # Seed data for demo
```

**Prisma Schema Structure:**

```prisma
// Multi-tenant foundation
model Organization {
  id              String @id @default(cuid())
  name            String
  logo_url        String?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  rooms           Room[]
  users           User[]
  documents       Document[]
  events          Event[]
  settings        OrgSettings?
}

// Every major entity includes organization_id
model Room {
  id              String @id @default(cuid())
  organization_id String
  organization    Organization @relation(fields: [organization_id], references: [id])

  name            String
  status          RoomStatus  // draft, active, archived, closed
  // ... other fields

  documents       Document[]
  folders         Folder[]
  permissions     Permission[]
  events          Event[]

  @@index([organization_id])
}

// Event log (time-partitioned, monthly)
model Event {
  id              String @id @default(cuid())
  organization_id String
  event_type      String
  actor_id        String?
  actor_type      String  // admin, viewer, system
  room_id         String?
  document_id     String?
  request_id      String  // Group events across single request
  session_id      String  // Group events across session
  ip_address      String?
  user_agent      String?
  metadata_json   Json
  created_at      DateTime @default(now())

  @@index([organization_id, created_at])
  @@index([request_id])
  @@index([session_id])
  // Time-based partitioning: monthly by created_at
}
```

**Soft-Delete Auto-Exclusion (F114 - Trash/Soft Delete):**

Prisma middleware automatically excludes soft-deleted records from normal queries. All models with a `deletedAt` field (Document, Room, Folder, etc.) are filtered:

```typescript
// Prisma middleware: auto-exclude soft-deleted records
prisma.$use(async (params, next) => {
  // Auto-filter: exclude deletedAt IS NOT NULL from normal queries
  if (['findMany', 'findFirst', 'findUnique', 'count'].includes(params.action)) {
    // Check if model has deletedAt field
    const model = params.model;
    const models_with_soft_delete = ['Document', 'Room', 'Folder'];

    if (models_with_soft_delete.includes(model)) {
      // Add deletedAt filter unless explicitly overridden
      if (!params.args.where || !('includeDeleted' in params.args.where)) {
        if (!params.args.where) {
          params.args.where = {};
        }
        params.args.where.deletedAt = null; // or { equals: null }
      } else {
        // Admin override: includeDeleted: true
        const { includeDeleted, ...rest } = params.args.where;
        params.args.where = rest;
      }
    }
  }

  return next(params);
});
```

**Override for Admin/Cleanup Views:**

Trash views and retention cleanup explicitly opt-in to see deleted records:

```typescript
// Admin view: fetch items in trash
async function getTrashedDocuments(roomId: string) {
  return await db.document.findMany({
    where: {
      roomId,
      includeDeleted: true, // Override middleware filter
      deletedAt: { not: null }, // Only show deleted items
    },
  });
}

// Retention cleanup job: hard-delete old soft-deleted records
async function hardDeleteExpiredSoftDeletes() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30); // 30-day recovery window

  await db.document.deleteMany({
    where: {
      includeDeleted: true,
      deletedAt: { lt: cutoffDate },
    },
  });
}
```

### 5. Infrastructure Layer

**Components:** Provider implementations, adapters, external service integrations

**Responsibilities:**

- Storage operations (upload, download, delete, sign URLs)
- Email dispatch (SMTP, SendGrid, cloud providers)
- Cache operations (Redis, in-memory)
- Job queue management (BullMQ, in-process)
- Preview conversion (LibreOffice, Gotenberg)
- Virus scanning (ClamAV)
- Search indexing (PostgreSQL FTS, Meilisearch)
- Encryption (AES-256, KMS)
- Authentication (built-in, OIDC, LDAP)
- Monitoring (logging, OpenTelemetry)

**Key Files:**

```
lib/providers/
├── storage/
│   ├── StorageProvider.ts          # Interface
│   ├── LocalStorageProvider.ts
│   ├── S3StorageProvider.ts
│   ├── AzureBlobProvider.ts        # V3+
│   └── factory.ts                  # Environment-based selection
├── email/
│   ├── EmailProvider.ts            # Interface
│   ├── SmtpEmailProvider.ts
│   ├── SendGridEmailProvider.ts
│   ├── AzureCommsProvider.ts       # V3+
│   └── factory.ts
├── cache/
│   ├── CacheProvider.ts            # Interface
│   ├── RedisCacheProvider.ts
│   ├── InMemoryCacheProvider.ts
│   └── factory.ts
├── job/
│   ├── JobProvider.ts              # Interface
│   ├── BullMqJobProvider.ts
│   ├── InProcessJobProvider.ts
│   └── factory.ts
├── preview/
│   ├── PreviewProvider.ts          # Interface
│   ├── GotenbergPreviewProvider.ts
│   └── factory.ts
├── scan/
│   ├── ScanProvider.ts             # Interface
│   ├── ClamAvScanProvider.ts
│   └── factory.ts
├── search/
│   ├── SearchProvider.ts           # Interface
│   ├── PostgresFtsSearchProvider.ts
│   ├── MeilisearchProvider.ts
│   └── factory.ts
├── encryption/
│   ├── EncryptionProvider.ts       # Interface
│   ├── AesEncryptionProvider.ts
│   ├── VaultEncryptionProvider.ts
│   └── factory.ts
├── auth/
│   ├── AuthSSOProvider.ts          # Interface
│   ├── OidcAuthProvider.ts
│   ├── LdapAuthProvider.ts
│   └── factory.ts
├── monitoring/
│   ├── MonitoringProvider.ts       # Interface
│   ├── ConsoleMonitoringProvider.ts
│   ├── OtelMonitoringProvider.ts
│   └── factory.ts
├── cdn/
│   ├── CDNProvider.ts              # Interface
│   ├── DirectServeCDNProvider.ts
│   ├── AzureCdnProvider.ts         # V3+
│   └── factory.ts
└── factory.ts                       # Central provider factory
```

---

## Provider/Adapter Pattern

Each provider defines a TypeScript interface. At runtime, the correct implementation is selected via environment variables or configuration.

### StorageProvider

**Purpose:** Abstract file storage (upload, download, delete, sign temporary URLs)

**Interface:**

```typescript
interface StorageProvider {
  // Upload file to storage, return key/path
  uploadFile(
    key: string,
    data: Buffer | Stream,
    metadata?: Record<string, string>
  ): Promise<UploadResult>;

  // Download file from storage
  downloadFile(key: string): Promise<Buffer>;

  // Delete file from storage
  deleteFile(key: string): Promise<void>;

  // Generate temporary signed URL for secure access
  // expires_in: seconds until expiry
  getSignedUrl(key: string, expiresIn: number): Promise<string>;

  // Check if file exists
  exists(key: string): Promise<boolean>;

  // Move/copy file
  copyFile(sourceKey: string, destKey: string): Promise<void>;
}

interface UploadResult {
  key: string;
  url?: string;
  size: number;
  etag?: string;
}
```

**Implementations:**

- **LocalStorageProvider** (F070): Store on local filesystem. Dev/small installs. Files at `/data/storage/`.
- **S3StorageProvider** (F065): AWS S3 or S3-compatible (MinIO, Backblaze). Production standard.
- **AzureBlobProvider** (F065 variant): Azure Blob Storage via generic StorageProvider interface. Works with standard Azure SDK.

**Note on Cloud Adapters:** The StorageProvider interface ships at MVP with three generic implementations (Local, S3, Azure Blob). These are standard cloud APIs, not cloud-specific optimizations. The V3 Cloud Adapter features (F080-F094) are Azure/AWS/GCP-NATIVE optimizations that leverage platform-specific capabilities beyond basic storage (managed identity auth, CDN integration, native monitoring, etc.).

**Selection via Environment:**

```bash
# .env
STORAGE_PROVIDER=s3
S3_BUCKET=vaultspace-prod
S3_REGION=us-east-1
S3_ACCESS_KEY=***
S3_SECRET_KEY=***

# or
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=/var/data/storage

# or
STORAGE_PROVIDER=azure
AZURE_STORAGE_ACCOUNT_NAME=***
AZURE_STORAGE_ACCOUNT_KEY=***
STORAGE_BUCKET=vaultspace
```

### EmailProvider

**Purpose:** Abstract email dispatch (send emails via SMTP, cloud services, etc.)

**Interface:**

```typescript
interface EmailProvider {
  // Send email
  send(request: SendEmailRequest): Promise<SendEmailResult>;

  // Send template-based email (for notifications)
  sendTemplate(
    to: string,
    templateId: string,
    data: Record<string, string>
  ): Promise<SendEmailResult>;

  // Verify email address (optional async validation)
  verifyEmail(email: string): Promise<boolean>;
}

interface SendEmailRequest {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  html?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

interface SendEmailResult {
  id: string;
  status: 'sent' | 'failed' | 'queued';
  error?: string;
}
```

**Implementations:**

- **SmtpEmailProvider** (F059): SMTP server. Default for self-hosted.
- **SendGridEmailProvider** (V1): SendGrid API. High volume, reliability.
- **AzureCommsProvider** (F086, V3): Azure Communication Services.
- **AwsSesProvider** (F091, V3): AWS SES. Integrated with AWS deployments.

### AuthSSOProvider

**Purpose:** Abstract authentication and SSO (login, token validation, user provisioning)

**Interface:**

```typescript
interface AuthSSOProvider {
  // Authenticate user (return session token)
  authenticate(username: string, password: string): Promise<AuthResult>;

  // Validate existing token/session
  validateToken(token: string): Promise<ValidateTokenResult>;

  // Get user info from token
  getUserInfo(token: string): Promise<UserInfo>;

  // Refresh token (if supported)
  refreshToken(token: string): Promise<string>;

  // For SSO providers: get authorization URL
  getAuthorizationUrl?(redirectUri: string): Promise<string>;

  // Exchange OAuth/OIDC code for token
  exchangeCode?(code: string, redirectUri: string): Promise<AuthResult>;

  // List users (for provisioning)
  listUsers?(): Promise<UserInfo[]>;

  // Sync user from external directory
  syncUser?(externalId: string): Promise<UserInfo>;
}

interface AuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  user: UserInfo;
}

interface UserInfo {
  id: string;
  email: string;
  name: string;
  groups?: string[];
}
```

**Implementations:**

- **BuiltInAuthProvider** (default): Email + password stored in PostgreSQL. Supports local logins.
- **OidcAuthProvider** (F072, V1): Generic OIDC/OAuth2 (Okta, Auth0, etc.).
- **LdapAuthProvider** (F073, V2): LDAP/Active Directory sync.
- **SamlAuthProvider** (F140, V2): SAML 2.0 for enterprise.
- **AzureEntraProvider** (F081, V3): Azure Entra ID (Azure AD).

### MonitoringProvider

**Purpose:** Abstract observability (logging, metrics, tracing)

**Interface:**

```typescript
interface MonitoringProvider {
  // Log message
  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, any>
  ): Promise<void>;

  // Emit metric
  metric(name: string, value: number, tags?: Record<string, string>): Promise<void>;

  // Start trace
  startTrace(name: string): Span;

  // Track event (for analytics)
  trackEvent(name: string, properties?: Record<string, any>): Promise<void>;

  // Set user context
  setUserContext(userId: string, email: string): Promise<void>;
}

interface Span {
  end(): void;
  setAttribute(key: string, value: string | number): void;
}
```

**Implementations:**

- **ConsoleMonitoringProvider** (default): stdout logging. Simple, dev-friendly.
- **OtelMonitoringProvider** (F071, V1): OpenTelemetry. Standard, vendor-agnostic.
- **AzureInsightsProvider** (F085, V3): Azure Application Insights.

### CDNProvider

**Purpose:** Abstract content delivery for previews and assets

**Interface:**

```typescript
interface CDNProvider {
  // Publish asset to CDN (or return direct storage URL)
  publishAsset(key: string, content: Buffer | Stream): Promise<PublishResult>;

  // Get CDN URL (or storage URL if no CDN)
  getAssetUrl(key: string, expiresIn?: number): Promise<string>;

  // Invalidate cache
  invalidateCache(pattern: string): Promise<void>;

  // Delete asset from CDN
  deleteAsset(key: string): Promise<void>;
}

interface PublishResult {
  cdnUrl: string;
  storageKey: string;
}
```

**Implementations:**

- **DirectServeCDNProvider** (default): No CDN, serve directly from storage via signed URLs.
- **AzureCdnProvider** (F083, V3): Azure CDN.
- **CloudFrontCdnProvider** (F092, V3): AWS CloudFront.
- **GcpCdnProvider** (F094, V3): Google Cloud CDN.

### JobProvider

**Purpose:** Abstract background job queue (enqueue, process, retry, schedule)

**Interface:**

```typescript
interface JobProvider {
  // Enqueue job
  enqueueJob<T>(queueName: string, jobType: string, payload: T, options?: JobOptions): Promise<Job>;

  // Listen for job completion
  onJobComplete(
    queueName: string,
    jobType: string,
    handler: (job: Job, result: any) => Promise<void>
  ): void;

  // Listen for job failure
  onJobFailed(
    queueName: string,
    jobType: string,
    handler: (job: Job, error: Error) => Promise<void>
  ): void;

  // Get job status
  getJobStatus(jobId: string): Promise<JobStatus>;

  // Cancel job
  cancelJob(jobId: string): Promise<void>;

  // Scheduled job (cron-like)
  scheduleJob(
    queueName: string,
    jobType: string,
    payload: any,
    cronExpression: string
  ): Promise<ScheduledJob>;
}

interface JobOptions {
  priority?: 'high' | 'normal' | 'low';
  attempts?: number;
  backoff?: number;
  delay?: number;
  timeout?: number;
}

interface Job {
  id: string;
  queueName: string;
  jobType: string;
  payload: any;
  status: JobStatus;
  attempts: number;
  progress?: number;
  result?: any;
  error?: string;
}

type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | 'delayed';
```

**Implementations:**

- **BullMqJobProvider** (F100, MVP): BullMQ + Redis. Reliable, scalable, multi-priority.
- **InProcessJobProvider** (fallback): In-process queue for single-container deployments. No persistence, no scale.

**Job Classification (F100):**

- **High priority:** Preview generation, virus scanning (time-sensitive, block viewers)
- **Normal priority:** Email dispatch, notifications, webhooks
- **Low priority:** Analytics aggregation, report generation
- **Scheduled:** Retention cleanup, expiry checks, daily digests

**Dedicated Workers:**

```
general-worker:      Email, webhooks, analytics aggregation, cleanup (normal/low priority)
preview-worker:      Convert documents, generate thumbnails (CPU-heavy)
scan-worker:         ClamAV virus scanning (I/O-heavy)
report-worker:       Binder exports, compliance reports (long-running)
```

### CacheProvider

**Purpose:** Abstract caching layer (sessions, rate limits, preview metadata, frequently accessed data)

**Interface:**

```typescript
interface CacheProvider {
  // Get value
  get<T>(key: string): Promise<T | null>;

  // Set value with optional TTL
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  // Delete value
  delete(key: string): Promise<void>;

  // Clear all
  clear(): Promise<void>;

  // Increment counter (for rate limiting)
  increment(key: string, amount?: number): Promise<number>;

  // Get with automatic increment and TTL (for rate limits)
  getAndIncrement(key: string, ttlSeconds?: number, amount?: number): Promise<number>;
}
```

**Implementations:**

- **RedisCacheProvider** (F103, MVP): Redis. Fast, distributed, supports expiration and atomic operations.
- **InMemoryCacheProvider** (fallback): In-memory LRU cache. Single-process only, limited to available memory.

### PreviewProvider

**Purpose:** Abstract document conversion to preview format (PDF) and thumbnails. Orchestrates OCR as part of the pipeline (F132).

**Interface:**

```typescript
interface PreviewProvider {
  // Convert document to PDF
  convertToPreview(
    sourceKey: string,
    sourceFormat: string,
    options?: PreviewOptions
  ): Promise<PreviewResult>;

  // Generate thumbnail from PDF
  generateThumbnail(
    pdfKey: string,
    pageNumber: number,
    width: number,
    height: number
  ): Promise<Buffer>;

  // Extract text from document (includes OCR for scanned documents via ocrEngine)
  extractText(sourceKey: string, sourceFormat: string): Promise<string>;

  // Apply watermark to preview
  applyWatermark(
    pdfKey: string,
    watermarkText: string,
    options?: WatermarkOptions
  ): Promise<Buffer>;

  // Get supported formats
  getSupportedFormats(): Promise<string[]>;
}

interface PreviewOptions {
  pageCount?: number;
  quality?: 'low' | 'medium' | 'high';
}

interface PreviewResult {
  pdfKey: string;
  pageCount: number;
  size: number;
  textKey?: string;
}

// OCR sub-interface (consumed by PreviewProvider, not independently registered)
interface OCREngine {
  // Perform OCR on image-based PDF or scanned document
  performOCR(sourceKey: string, sourceFormat: string, options?: OCROptions): Promise<string>;

  // Check if document requires OCR (e.g., is scanned rather than native text)
  requiresOCR(sourceKey: string, sourceFormat: string): Promise<boolean>;
}

interface OCROptions {
  language?: string; // ISO language code, default 'en'
  quality?: 'fast' | 'normal' | 'high'; // Trade-off between speed and accuracy
}
```

**Implementations:**

- **GotenbergPreviewProvider** (F101, MVP): Gotenberg microservice with integrated Tesseract OCR (F132). Orchestrates conversion and OCR as part of the preview pipeline. Reliable, supports many formats.
- **LibreOfficePreviewProvider** (alternative): LibreOffice headless with Tesseract OCR. More formats, single-machine.

**OCR Integration:**
PreviewProvider implementations include an `ocrEngine` property injected at construction time. The `extractText()` method:

1. Converts document to PDF (if needed)
2. Detects if the PDF is scanned (requires OCR) via `ocrEngine.requiresOCR()`
3. If scanned, applies OCR via `ocrEngine.performOCR()` (default: Tesseract)
4. Returns combined text for search indexing

This design keeps OCR as an internal concern of the preview pipeline, not exposed as a top-level provider to API callers. Advanced AI-based OCR (F079 V2+) can be substituted by providing an alternative OCREngine implementation.

### ScanProvider

**Purpose:** Abstract virus/malware scanning

**Interface:**

```typescript
interface ScanProvider {
  // Scan file for viruses
  scan(fileKey: string): Promise<ScanResult>;

  // Get scan status
  getScanStatus(scanId: string): Promise<ScanStatus>;
}

interface ScanResult {
  scanId: string;
  status: 'clean' | 'infected' | 'error';
  threats?: ThreatInfo[];
  scannedAt: Date;
}

interface ThreatInfo {
  name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

type ScanStatus = 'pending' | 'scanning' | 'complete' | 'error';
```

**Implementations:**

- **ClamAvScanProvider** (F107, MVP): ClamAV. Open-source, reliable, containerizable.

### SearchProvider

**Purpose:** Abstract full-text search indexing and querying

**Interface:**

```typescript
interface SearchProvider {
  // Index document text
  indexDocument(
    documentId: string,
    versionId: string,
    organizationId: string,
    text: string,
    metadata?: SearchMetadata
  ): Promise<void>;

  // Search documents
  search(organizationId: string, query: string, options?: SearchOptions): Promise<SearchResult[]>;

  // Delete index for document
  deleteIndex(documentId: string, versionId: string): Promise<void>;

  // Clear all indexes for organization
  clearOrganization(organizationId: string): Promise<void>;
}

interface SearchMetadata {
  fileName: string;
  fileType: string;
  tags: string[];
  customFields?: Record<string, string>;
}

interface SearchOptions {
  limit?: number;
  offset?: number;
  fields?: string[];
  filters?: Record<string, any>;
}

interface SearchResult {
  documentId: string;
  versionId: string;
  fileName: string;
  score: number;
  excerpt?: string;
}
```

**Implementations:**

- **PostgresFtsSearchProvider** (ships with framework; feature F011 is V1): PostgreSQL Full-Text Search. Built-in, no external dependency.
- **MeilisearchProvider** (V1): Meilisearch. Fast, typo-tolerant, more featured.
- **OpenSearchProvider** (V2): OpenSearch/Elasticsearch. Enterprise-scale, vector search.

### EncryptionProvider

**Purpose:** Abstract document encryption at rest

**Interface:**

```typescript
interface EncryptionProvider {
  // Encrypt data before storage
  encrypt(plaintext: Buffer): Promise<EncryptedData>;

  // Decrypt data after retrieval
  decrypt(encrypted: EncryptedData): Promise<Buffer>;

  // Rotate encryption key
  rotateKey(): Promise<void>;

  // Get key version (for audit)
  getKeyVersion(): Promise<string>;
}

interface EncryptedData {
  ciphertext: Buffer;
  iv: Buffer;
  keyVersion: string;
}
```

**Implementations:**

- **AesEncryptionProvider** (ships with framework; feature F120 is V1): AES-256 key from environment variable. Simple, sufficient for MVP.
- **VaultEncryptionProvider** (V1): HashiCorp Vault. Centralized key management, rotation, audit.
- **AzureKeyVaultProvider** (F082, V3): Azure Key Vault. Cloud-native, integrated.
- **AwsKmsProvider** (V3): AWS KMS. Cloud-native, integrated.

### AIProvider

**Purpose:** Abstract AI services (categorization, summarization, semantic search, Q&A)

**Interface:**

```typescript
interface AIProvider {
  // Categorize document
  categorizeDocument(text: string, categories: string[]): Promise<CategorizeResult>;

  // Summarize document
  summarizeDocument(text: string): Promise<string>;

  // Generate embeddings for semantic search
  embedText(text: string): Promise<number[]>;

  // Answer question about document
  answerQuestion(context: string, question: string): Promise<string>;

  // Detect sensitive content
  detectSensitiveContent(text: string): Promise<SensitiveContent[]>;
}

interface CategorizeResult {
  category: string;
  confidence: number;
}

interface SensitiveContent {
  type: 'pii' | 'credit_card' | 'ssn' | 'api_key' | 'custom';
  pattern: string;
  position: { start: number; end: number };
}
```

**Implementations:**

- None (MVP): Implemented in V2+ with external providers.
- **OpenAiProvider** (V2): OpenAI GPT API.
- **AnthropicProvider** (V2): Anthropic Claude API.
- **AzureOpenAiProvider** (V3): Azure OpenAI.

### SignatureProvider

**Purpose:** Abstract e-signature capabilities (built-in or external)

**Interface:**

```typescript
interface SignatureProvider {
  // Create signature request
  createSignatureRequest(
    documentId: string,
    signerEmail: string,
    signerName: string
  ): Promise<SignatureRequest>;

  // Get signature request status
  getSignatureStatus(requestId: string): Promise<SignatureStatus>;

  // Verify signature integrity
  verifySignature(documentId: string, signatureData: SignatureData): Promise<boolean>;

  // Get signed document
  getSignedDocument(requestId: string): Promise<Buffer>;
}

interface SignatureRequest {
  id: string;
  documentId: string;
  signerEmail: string;
  status: 'pending' | 'signed' | 'expired' | 'declined';
  externalId?: string;
}

interface SignatureData {
  requestId: string;
  signature: string;
  timestamp: Date;
  certificateChain?: string[];
}
```

**Implementations:**

- None (MVP): Implemented in V2+.
- **BuiltInSignatureProvider** (V2): Simple draw/type signature in browser.
- **DocusignProvider** (F048, V2): DocuSign integration via adapter.

---

## Core Modules

### PermissionEngine (F141)

**Purpose:** Centralized access control. Single module evaluates all permission decisions. Prevents duplication across codebase.

**Reference:** `PERMISSION_MODEL.md` (F154)

**Core Function:**

```typescript
async function canUserAccessDocument(
  user: User,
  document: Document,
  action: 'view' | 'download' | 'print' | 'share' | 'comment' | 'sign',
  context?: RequestContext
): Promise<boolean>;
```

**Evaluation Order:**

1. Admin bypass: if user is room admin, grant all actions
2. Room closed: if room is closed, deny all viewer access
3. Role check: user must have viewer or admin role
4. Group membership: check groups user belongs to
5. Per-document ACLs: check document-level permissions
6. Folder ACLs: check folder-level permissions (inherited by documents)
7. Share link: if via public link, check link permissions, password, expiry
8. IP rules: if IP allowlist/blocklist enabled, check against IP rules
9. Time-based access: check if access window is still open
10. Document state: check if document is deleted or archived

**Diagnostic Function:**

```typescript
async function explainPermission(
  user: User,
  document: Document,
  action: string
): Promise<PermissionExplanation>;

interface PermissionExplanation {
  allowed: boolean;
  reasons: string[]; // Human-readable chain
  // e.g., ["Allowed: user in group 'Investors'",
  //        "Group has read permission on folder",
  //        "No document-level ACL override"]
}
```

**Actions:**

- **view:** Display document in viewer
- **download:** Download original file
- **print:** Print preview
- **share:** Create share links
- **comment:** Add annotations (admin-side)
- **sign:** E-sign document (V2+)

### EventBus (F102)

**Purpose:** Immutable audit log and event stream. All state changes emit events. Foundation for audit trail, analytics, webhooks, notifications.

**Reference:** `EVENT_MODEL.md` (F153)

**Core Interface:**

```typescript
interface EventBus {
  // Emit event
  emit(event: DomainEvent): Promise<void>;

  // Subscribe to event type
  on(eventType: string, handler: EventHandler): void;

  // Query event history
  queryEvents(filter: EventFilter): Promise<Event[]>;
}

interface DomainEvent {
  event_id: string; // UUID, unique
  event_type: string; // e.g., "document.uploaded", "permission.changed"
  timestamp: Date;
  actor_id: string; // User ID or "system"
  actor_type: 'admin' | 'viewer' | 'system';
  organization_id: string;
  room_id?: string;
  document_id?: string;
  request_id: string; // Group events from single HTTP request
  session_id: string; // Group events from single session
  ip_address?: string;
  user_agent?: string;
  metadata: Record<string, any>;
}
```

**Event Types (Catalog):**

- `room.created`, `room.updated`, `room.deleted`, `room.archived`, `room.closed`
- `document.uploaded`, `document.updated`, `document.deleted`, `document.tagged`
- `version.created`
- `permission.changed`
- `link.created`, `link.revoked`
- `user.invited`, `user.joined`, `user.left`
- `document.viewed`, `document.downloaded`, `document.printed`
- `user.locked_out`, `room.accessed_from_new_ip`
- `audit_event.exported`, `compliance_report.generated`

**Subscribers (Event Consumers):**

```
EventBus ──┬─→ AuditTrail (store immutable log)
           ├─→ Analytics (compute views, downloads, engagement)
           ├─→ Notifications (email admins on important events)
           ├─→ Webhooks (HTTP callbacks to external integrations)
           ├─→ Cache invalidation (bust preview/permission caches)
           └─→ Search indexing (update search index on doc changes)
```

**Storage (Database):**

```
Table: events
├─ event_id (PK, UUID)
├─ event_type (indexed)
├─ organization_id (indexed)
├─ room_id (indexed)
├─ document_id (indexed)
├─ request_id (indexed, for grouping)
├─ session_id (indexed, for grouping)
├─ actor_id
├─ actor_type
├─ ip_address
├─ user_agent
├─ metadata_json
├─ created_at (indexed)

Partitioning: Time-based, monthly by created_at
Retention: Configurable per organization (default 2 years)
Archival: Move old events to cold storage (S3 Glacier, Azure Archive)
```

### Preview Pipeline (F101)

**Purpose:** Multi-stage async conversion of documents to searchable, viewable PDFs with thumbnails.

**Stages:**

```
1. Scan (via ScanProvider)
   ├─ Input: original file key
   ├─ Action: virus scan
   ├─ Output: clean/infected status
   └─ On infected: quarantine, skip remaining stages

2. Convert (via PreviewProvider)
   ├─ Input: original file
   ├─ Action: convert to PDF (LibreOffice/Gotenberg)
   ├─ Output: PDF at `previews/{document_id}/{version_id}/preview.pdf`
   └─ Emit event: preview.pdf_ready

3. Extract Text (via PreviewProvider)
   ├─ Input: PDF from stage 2
   ├─ Action: extract all text (OCR if needed)
   ├─ Output: plain text at `previews/{document_id}/{version_id}/text.txt`
   └─ Emit event: preview.text_extracted

4. Generate Thumbnails (via PreviewProvider)
   ├─ Input: PDF from stage 2
   ├─ Action: generate PNG thumbnail per page
   ├─ Output: thumbnails at `previews/{document_id}/{version_id}/thumb_1.png`, etc.
   └─ Emit event: preview.thumbnails_generated

5. Index Text (via SearchProvider)
   ├─ Input: text from stage 3, document metadata
   ├─ Action: index in search engine
   ├─ Output: searchable document in SearchIndex
   └─ Emit event: preview.indexed

Final: Document marked ready_for_viewing = true
```

**Job Architecture:**

```typescript
// Each stage is a separate job in the queue

// Stage 1: Scan
await jobProvider.enqueueJob('high', 'preview.scan', {
  document_id: doc.id,
  version_id: version.id,
  file_key: file.storage_key
});

// On scan completion:
on('preview.scan.complete', async (job) => {
  if (job.result.infected) {
    // Quarantine
    document.quarantined = true;
    document.quarantine_reason = job.result.threat;
    await document.save();
    emit(new QuarantinedEvent(document.id));
    return;
  }
  // Proceed to stage 2
  await jobProvider.enqueueJob('high', 'preview.convert', { ... });
});

// Stage 2: Convert
on('preview.convert.complete', async (job) => {
  // Check success
  if (job.failed) {
    document.preview_error = job.error.message;
    await document.save();
    emit(new PreviewFailedEvent(document.id, job.error));
    return;
  }
  // Proceed to stages 3, 4 in parallel
  await Promise.all([
    jobProvider.enqueueJob('normal', 'preview.extract_text', { ... }),
    jobProvider.enqueueJob('normal', 'preview.thumbnails', { ... })
  ]);
});

// Stages 3 & 4 complete
on('preview.extract_text.complete', async (job) => {
  document.extracted_text_key = job.result.text_key;
  document.extracted_text_size = job.result.size;
  // Check if stage 4 also complete, then proceed to stage 5
  if (document.thumbnails_generated_at) {
    await jobProvider.enqueueJob('normal', 'preview.index_text', { ... });
  }
  await document.save();
});

on('preview.thumbnails.complete', async (job) => {
  document.thumbnails_key_pattern = job.result.pattern;
  document.page_count = job.result.page_count;
  // Check if stage 3 also complete
  if (document.extracted_text_key) {
    await jobProvider.enqueueJob('normal', 'preview.index_text', { ... });
  }
  await document.save();
});

// Stage 5: Index
on('preview.index_text.complete', async (job) => {
  document.ready_for_viewing = true;
  document.preview_completed_at = now();
  await document.save();
  emit(new PreviewCompleteEvent(document.id));
  // Notify subscribers
  await notificationService.sendPreviewReadyNotification(document);
});
```

**Watermarking (Applied at Render Time):**
Watermarks are NOT baked into stored previews. Instead, applied dynamically at render:

```typescript
async function renderPreviewWithWatermark(
  documentId: string,
  versionId: string,
  viewerId: string,
  viewerEmail: string,
  viewerIp: string
): Promise<Stream> {
  // 1. Fetch stored PDF
  const pdfStream = await storageProvider.downloadFile(
    `previews/${documentId}/${versionId}/preview.pdf`
  );

  // 2. Apply watermark overlay
  const watermarkText = `${viewerEmail} | ${viewerIp} | ${new Date().toISOString()}`;
  const watermarkedPdf = await previewProvider.applyWatermark(pdfStream, watermarkText, {
    placement: 'diagonal', // or 'margin'
    opacity: 0.3,
    fontSize: 12,
  });

  return watermarkedPdf;
}
```

**Error Handling & Retries:**

- Each stage auto-retries up to 3 times with exponential backoff
- If conversion fails, document marked with `preview_error` and admin notified
- User can manually retry conversion after issue is fixed

### Job System (F100)

**Purpose:** Reliable async job execution with classification and dedicated workers.

**Queue Classifications:**

```
High Priority (Dedicated preview-worker)
├─ document.convert
├─ document.scan
├─ document.extract_text
└─ document.thumbnails
  → Time-sensitive, block document viewing

Normal Priority (General worker)
├─ email.send
├─ notification.send
├─ webhook.dispatch
├─ document.index_text
└─ activity.record
  → Important but not time-blocking

Low Priority (Low-priority worker)
├─ analytics.aggregate
├─ report.generate
├─ export.zip_room
└─ cleanup.temp_files
  → Can be delayed, low impact

Scheduled (Scheduler)
├─ retention.cleanup (daily 2am UTC)
├─ expiry.check_and_revoke (hourly)
├─ session.cleanup_expired (hourly)
├─ event-compaction (daily 2am UTC) [F102 optimization for long-lived rooms]
└─ digest.send_activity (daily 9am UTC)
```

**BullMQ Configuration:**

```typescript
const queues = {
  preview: {
    connection: redisConnection,
    settings: {
      maxStalledCount: 3,
      stalledInterval: 30000,
      maxRetriesPerStalledCount: 3,
      lockDuration: 60000,
      lockRenewTime: 30000,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 604800 },
      },
    },
  },
  normal: {
    // Similar config
    settings: {
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      },
    },
  },
  low: {
    settings: {
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      },
    },
  },
};
```

**Dedicated Worker Processes:**

```bash
# docker-compose.yml
services:
  app:
    # Main web app
    command: npm run dev

  worker-general:
    image: dataroom:latest
    command: npm run worker -- --queue=normal,low
    depends_on: [postgres, redis]

  worker-preview:
    image: dataroom:latest
    command: npm run worker -- --queue=preview
    environment:
      PREVIEW_WORKER_CONCURRENCY: 2  # Limit CPU usage
    depends_on: [postgres, redis, gotenberg]

  worker-scan:
    image: dataroom:latest
    command: npm run worker -- --queue=scan
    environment:
      CLAMAV_SOCKET: clamav:3310
    depends_on: [postgres, redis, clamav]

  gotenberg:
    image: gotenberg/gotenberg:latest
    expose: [3000]

  clamav:
    image: clamav/clamav:latest
    expose: [3310]
```

### Document Object Model (F152 reference: DATABASE_SCHEMA.md)

**Structure:**

```
Document (mutable metadata)
  ├─ id, organization_id, room_id, folder_id
  ├─ name, file_name, file_type
  ├─ status (active, deleted, archived)
  ├─ created_at, updated_at
  ├─ current_version_id (FK)
  ├─ extracted_text (denormalized for search)
  ├─ custom_metadata (JSON)
  ├─ tags (array of strings)
  ├─ bates_number (optional)
  └─ ready_for_viewing (bool)

DocumentVersion (immutable snapshot)
  ├─ id, document_id, organization_id
  ├─ version_number
  ├─ uploaded_by_user_id
  ├─ uploaded_at
  ├─ file_size, file_hash (SHA-256)
  ├─ previous_version_hash (for chain-of-custody)
  ├─ preview_status (pending, converting, ready, failed)
  ├─ preview_error (nullable)
  ├─ page_count
  └─ quarantined (bool, if virus found)

FileBlob (original uploaded content)
  ├─ id, version_id
  ├─ storage_key (path in StorageProvider)
  ├─ size
  ├─ etag (for integrity)
  └─ content_hash (SHA-256)

PreviewAsset (generated preview files)
  ├─ id, version_id
  ├─ pdf_key (storage path: previews/{doc_id}/{ver_id}/preview.pdf)
  ├─ thumbnail_pattern (previews/{doc_id}/{ver_id}/thumb_*.png)
  ├─ page_count
  ├─ pdf_size
  └─ generated_at

ExtractedText (searchable text)
  ├─ id, version_id
  ├─ text (plain text content)
  ├─ storage_key (if stored separately for large docs)
  └─ extracted_at

SearchIndex (for full-text search)
  ├─ document_id, version_id, organization_id
  ├─ extracted_text (indexed field)
  ├─ metadata (file name, tags, custom fields)
  ├─ vector_embedding (nullable, for semantic search in V2+)
  └─ indexed_at
```

**Hash Chain (Tamper Detection):**

```
Version 1:
  file_hash = SHA256(original_file)
  version_hash = SHA256(version_number + file_hash + uploaded_at)

Version 2 (updated):
  file_hash = SHA256(updated_file)
  previous_version_hash = Version1.version_hash
  version_hash = SHA256(version_number + file_hash + previous_version_hash + uploaded_at)

→ If any prior version is tampered, all downstream version hashes become invalid
→ Enables legal-grade proof of integrity
```

### SearchIndex (Separate from Documents)

**Purpose:** Decoupled search storage. Allows search engine swaps without reprocessing documents.

**Schema:**

```sql
CREATE TABLE search_index (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL,
  version_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  extracted_text TEXT,
  file_name VARCHAR(255),
  file_type VARCHAR(50),
  tags TEXT[],
  custom_metadata JSONB,
  vector_embedding VECTOR(1536),  -- For semantic search (V2+)
  indexed_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (version_id) REFERENCES document_versions(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE INDEX idx_search_org ON search_index(organization_id);
CREATE INDEX idx_search_doc ON search_index(document_id);
CREATE INDEX idx_search_text ON search_index USING GIN(to_tsvector('english', extracted_text));
CREATE INDEX idx_search_vector ON search_index USING ivfflat(vector_embedding vector_cosine_ops);  -- For semantic
```

**Index Updates:**
When document version is complete (all preview stages done):

```typescript
on('preview.index_text.complete', async (job) => {
  const { document_id, version_id, extracted_text } = job.result;
  const doc = await documentRepo.findById(document_id);

  // Update SearchIndex
  await searchIndexRepo.upsert({
    document_id,
    version_id,
    organization_id: doc.organization_id,
    extracted_text,
    file_name: doc.file_name,
    file_type: doc.file_type,
    tags: doc.tags,
    custom_metadata: doc.custom_metadata,
    // vector_embedding computed in V2+ via AIProvider
  });
});
```

**Search Implementations:**

- **PostgresFtsSearchProvider (MVP):** Uses PostgreSQL `tsvector` and `tsquery`.
- **MeilisearchProvider (V1):** External Meilisearch instance. Faster, typo-tolerant.
- **OpenSearchProvider (V2):** OpenSearch/Elasticsearch. Advanced analytics, semantic search.

---

## Multi-Tenancy

**Foundation:** Every entity includes `organization_id`. Query middleware ensures results are scoped to current tenant.

**Database Design:**

```sql
-- All major tables include organization_id
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  logo_url VARCHAR(512),
  created_at TIMESTAMP DEFAULT now(),
  settings JSONB
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email VARCHAR(255),
  name VARCHAR(255),
  role ENUM('admin', 'viewer'),
  ...
  UNIQUE(organization_id, email)
);

CREATE TABLE rooms (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255),
  ...
  INDEX (organization_id)
);

-- Every table follows this pattern
```

**Prisma Middleware (Auto-Scoping):**

```typescript
// lib/db/middleware.ts

export function applyTenantMiddleware(prisma: PrismaClient) {
  prisma.$use(async (params, next) => {
    // Get current organization from request context (injected via middleware)
    const organizationId = getOrgIdFromContext();

    if (!organizationId) {
      throw new Error('Organization context required');
    }

    // For models that require tenancy, add where clause
    if (requiresTenancy(params.model)) {
      if (params.action === 'findUnique' || params.action === 'findFirst') {
        params.where = {
          ...params.where,
          organization_id: organizationId,
        };
      } else if (params.action === 'findMany') {
        params.where = {
          ...params.where,
          organization_id: organizationId,
        };
      } else if (params.action.startsWith('create')) {
        params.data = {
          ...params.data,
          organization_id: organizationId,
        };
      } else if (params.action.startsWith('update')) {
        // Verify record belongs to org before updating
        const current = await prisma[params.model].findFirst({
          where: { ...params.where, organization_id: organizationId },
        });
        if (!current) throw new Error('Record not found');
      }
    }

    return next(params);
  });
}
```

### Mandatory Tenant-Scoped Data Access Pattern

The Prisma middleware above is a **defense-in-depth safety net**, not the primary access control mechanism. All tenant-model queries MUST use explicit tenant scoping in the application code.

**REQUIRED Pattern:**

```typescript
// CORRECT: Use findFirst with explicit organizationId in where clause
const document = await prisma.document.findFirst({
  where: {
    id: documentId,
    organizationId: ctx.organizationId, // Always include tenant filter
  },
});

// CORRECT: Use composite unique constraint
const room = await prisma.room.findUnique({
  where: {
    organizationId_id: {
      organizationId: ctx.organizationId,
      id: roomId,
    },
  },
});

// CORRECT: findMany with tenant scope
const documents = await prisma.document.findMany({
  where: {
    organizationId: ctx.organizationId,
    roomId: roomId,
  },
});
```

**BANNED Pattern (relies only on middleware):**

```typescript
// WRONG: Direct unscoped access (middleware is safety net only, not primary control)
const document = await prisma.document.findUnique({
  where: { id: documentId }, // NEVER DO THIS - violates defense-in-depth
});

// WRONG: No tenant filter in findMany
const documents = await prisma.document.findMany({
  where: { roomId: roomId }, // Missing organizationId filter
});
```

**Why Both Are Required:**

1. **Application code explicit scoping:** Makes intent clear, aids code review, provides primary defense
2. **Middleware auto-injection:** Catches bugs in application code, provides secondary defense

If middleware injection is the only tenant control and a developer forgets the filter, data leaks cross-tenant. Explicit scoping + middleware creates layered protection.

**Application Context:**

```typescript
// middleware.ts (Next.js middleware)
export async function middleware(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.next();
  }

  // Inject organization context into request-scoped storage
  // NOTE: Do NOT set organizationId in response headers (client exposure risk)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', session.user.id);
  requestHeaders.set('x-request-id', generateUuid());
  requestHeaders.set('x-session-id', session.id);

  // Store organization context in AsyncLocalStorage or request context object
  // Server-side code retrieves it via getOrgIdFromContext()
  setRequestContext({
    organizationId: session.user.organization_id,
    userId: session.user.id,
    requestId: generateUuid(),
    sessionId: session.id,
  });

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
```

**Single-Org Deployment:**
On first deployment:

```typescript
// lib/services/SetupService.ts
export async function initializeDefaultOrganization() {
  let org = await prisma.organization.findFirst();

  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: 'org_default',
        name: 'My Organization',
        settings: {},
      },
    });
  }

  return org;
}
```

All users created in default org. When SaaS is deployed, change to support multiple orgs via explicit organization selection at signup.

---

## Security Architecture

### HTTPS Everywhere

All traffic between client, load balancer, and app must be encrypted:

```
Client ──HTTPS──> Load Balancer / Reverse Proxy ──HTTPS──> App
```

TLS termination at reverse proxy (Nginx, Caddy, App Gateway).

### Private Storage with Signed URLs

Document storage is private (no public read access):

```
# Storage bucket/container policy
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::bucket/*",
      "Condition": {
        "StringNotEquals": {
          "aws:userid": "app-service-account"
        }
      }
    }
  ]
}
```

App serves documents only via signed URLs (temporary, limited scope):

```typescript
// Viewer preview document
async function getPreviewUrl(documentId: string, userId: string) {
  // 1. Check permission via PermissionEngine
  const allowed = await permissionEngine.canUserAccessDocument(
    user,
    document,
    'view'
  );
  if (!allowed) throw new UnauthorizedError();

  // 2. Emit activity event
  await eventBus.emit({
    event_type: 'document.viewed',
    document_id: documentId,
    actor_id: userId,
    ip_address: request.ip,
    ...
  });

  // 3. Generate temporary signed URL for preview (5 minute expiry)
  // Short expiry prevents URL sharing that bypasses the permission engine
  const signedUrl = await storageProvider.getSignedUrl(
    `previews/${documentId}/${versionId}/preview.pdf`,
    expiresIn: 300  // 5 minutes
  );

  // 4. Client-side viewer must implement refresh mechanism:
  //    Before URL expires, call GET /api/rooms/{roomId}/documents/{docId}/preview
  //    to obtain a fresh signed URL (which re-checks permissions)
  return { url: signedUrl, expiresIn: 300 };
}

// Download document (longer expiry acceptable, still checks permissions)
async function downloadDocument(documentId: string, userId: string) {
  // 1. Check permission via PermissionEngine
  const allowed = await permissionEngine.canUserAccessDocument(
    user,
    document,
    'download'
  );
  if (!allowed) throw new UnauthorizedError();

  // 2. Emit activity event
  await eventBus.emit({
    event_type: 'document.downloaded',
    document_id: documentId,
    actor_id: userId,
    ip_address: request.ip,
    ...
  });

  // 3. Generate temporary signed URL for download (1 hour expiry)
  const signedUrl = await storageProvider.getSignedUrl(
    `originals/${documentId}/${versionId}/${fileName}`,
    expiresIn: 3600
  );

  // 4. Redirect to signed URL (or return it)
  return { url: signedUrl };
}
```

**Rationale:**

- **Viewer preview URLs (5 minutes):** Short-lived URLs prevent casual sharing that circumvents the permission engine. A viewer cannot share a URL with an external party; by the time they do, the URL is expired. The viewer must be granted direct access via the app's permission controls.
- **Download URLs (1 hour):** Allows longer-running downloads without permissions being revoked mid-stream.
- **Client-side refresh:** The viewer JS implementation (F008) must track URL expiry and proactively request fresh URLs before expiration, maintaining seamless experience for legitimate users.
- **Permission re-check:** Each URL refresh request re-checks permissions, so if access is revoked, the next refresh fails and viewer loses access immediately.

### Server-Side Permission Checks

Every API endpoint must check permissions via PermissionEngine before serving data:

```typescript
// api/rooms/[roomId]/documents/[docId]/route.ts
export async function GET(request, { params }) {
  const user = await getSessionUser(request);
  const doc = await documentRepo.findById(params.docId);

  // Mandatory: check permission
  const canView = await permissionEngine.canUserAccessDocument(user, doc, 'view');

  if (!canView) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  return NextResponse.json(doc);
}
```

No client-side permission checks. Assume malicious client.

### Rate Limiting (F104)

Prevent brute-force attacks on password-protected rooms and login endpoints:

```typescript
// Middleware applying rate limits
const rateLimitMiddleware = async (req, res, next) => {
  const key = `rate_limit:${req.ip}`;
  const count = await cacheProvider.getAndIncrement(key, ttlSeconds: 60);

  if (count > 100) {  // 100 requests per minute per IP
    return res.status(429).json({ error: 'Too many requests' });
  }

  next();
};

// User-level rate limit (stricter)
const userRateLimitMiddleware = async (req, res, next) => {
  if (!req.user) return next();

  const key = `rate_limit:user:${req.user.id}`;
  const count = await cacheProvider.getAndIncrement(key, ttlSeconds: 60);

  if (count > 1000) {  // 1000 requests per minute per user
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  next();
};

// Apply to password verification
const passwordAttemptLimit = async (req, res, next) => {
  const key = `password_attempt:${req.ip}:${req.body.room_id}`;
  const count = await cacheProvider.getAndIncrement(key, ttlSeconds: 300);

  if (count > 5) {  // 5 attempts per 5 minutes
    return res.status(429).json({ error: 'Too many password attempts' });
  }

  next();
};
```

### Virus Scanning (F107)

Before a document is made viewable, it must be scanned:

```typescript
// Upload flow
async function uploadDocument(file: File, roomId: string) {
  // 1. Store original file
  const fileBlob = await storageProvider.uploadFile(
    `originals/${documentId}/${versionId}/${file.name}`,
    file.buffer
  );

  // 2. Create Document and DocumentVersion records
  const doc = await documentRepo.create({
    room_id: roomId,
    file_name: file.name,
    file_size: file.size,
    ready_for_viewing: false, // Blocked until scanned
  });

  const version = await documentVersionRepo.create({
    document_id: doc.id,
    preview_status: 'pending',
  });

  // 3. Queue scan job (HIGH priority)
  await jobProvider.enqueueJob('high', 'preview.scan', {
    document_id: doc.id,
    version_id: version.id,
    file_key: fileBlob.key,
  });

  return doc;
}

// Scan worker
on('preview.scan', async (job) => {
  const result = await scanProvider.scan(job.data.file_key);

  if (result.status === 'infected') {
    // Quarantine
    await documentVersionRepo.update(job.data.version_id, {
      quarantined: true,
      preview_error: `Infected: ${result.threats.map((t) => t.name).join(', ')}`,
    });

    await eventBus.emit({
      event_type: 'document.quarantined',
      document_id: job.data.document_id,
      metadata: { threats: result.threats },
    });

    // Notify admin
    await notificationService.sendQuarantineAlert(doc);
    return;
  }

  // Continue to preview conversion
  await jobProvider.enqueueJob('high', 'preview.convert', job.data);
});
```

### Immutable Audit Events (F102, F025)

All events stored immutably in database. Never modified, only soft-deleted if needed for compliance:

```sql
-- Events table
CREATE TABLE events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(255) NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(50),
  organization_id UUID NOT NULL,
  room_id UUID,
  document_id UUID,
  request_id UUID,
  session_id UUID,
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  deleted_at TIMESTAMP NULL,  -- Soft delete only

  INDEX (organization_id, created_at),
  INDEX (request_id),
  INDEX (session_id),
  INDEX (actor_id)
);

-- Partitioning by month (PostgreSQL)
-- Retention: 2 years default, configurable per organization
-- Archive to cold storage (S3 Glacier) after 1 year
```

**Immutability Enforcement:**

```typescript
// No UPDATE allowed on events table
async function logEvent(event: DomainEvent) {
  // Only INSERT
  const result = await prisma.event.create({
    data: event,
  });
  return result;
}

// Deletion is soft (set deleted_at)
async function softDeleteEvent(eventId: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: { deleted_at: new Date() },
  });
}

// Queries exclude soft-deleted by default
async function queryEvents(filter) {
  return await prisma.event.findMany({
    where: {
      ...filter,
      deleted_at: null, // Exclude soft-deleted
    },
  });
}
```

### Encryption Key Management (F120)

**MVP:** AES-256 key from environment variable

```bash
# .env
ENCRYPTION_KEY=<base64-encoded-256-bit-key>  # 44 chars when base64
```

**V1+:** HashiCorp Vault or cloud KMS for centralized key management

```typescript
// EncryptionProvider interface
async function encrypt(plaintext: Buffer): Promise<EncryptedData> {
  const key = await getEncryptionKey(); // Fetch from Vault/KMS
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv,
    authTag,
    keyVersion: key.version,
  };
}

async function decrypt(data: EncryptedData): Promise<Buffer> {
  const key = await getEncryptionKey(data.keyVersion);
  const decipher = createDecipheriv('aes-256-gcm', key, data.iv);
  decipher.setAuthTag(data.authTag);

  let decrypted = decipher.update(data.ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted;
}
```

**V2+:** Key rotation support

```typescript
async function rotateEncryptionKey() {
  const newKey = generateEncryptionKey();
  await vault.storeKey('encryption_key_v2', newKey);

  // Reencrypt all documents with new key
  const allDocs = await documentRepo.findAllNeedingReencryption();
  for (const doc of allDocs) {
    const plaintext = await decrypt(doc.encrypted_data, versionId: 1);
    doc.encrypted_data = await encrypt(plaintext);  // Uses new key
    await documentRepo.update(doc);
  }

  // Update key version
  await settingsRepo.update({ encryption_key_version: 2 });
}
```

---

## Plugin/Extension Hook Architecture

**Purpose:** Enable enterprise add-ons (SSO, Advanced AI, Custom Storage, etc.) via a standard plugin system rather than if/else blocks scattered through the core. Keeps the AGPLv3 core clean, simplifies the commercial upsell path, and enables customers to extend functionality without forking.

### ExtensionRegistry Pattern

A central registry where plugins register capabilities at server startup.

```typescript
interface ExtensionRegistry {
  // Register a plugin
  register(plugin: DataRoomPlugin): void;

  // Get plugin by ID
  getPlugin(pluginId: string): DataRoomPlugin | undefined;

  // List all registered plugins
  listPlugins(): DataRoomPlugin[];

  // Get all plugins implementing a hook
  getPluginsForHook(hookName: string): DataRoomPlugin[];

  // Get all custom providers (e.g., auth, storage)
  getProviders(): Partial<ProviderOverrides>;
}

// Singleton instance
export const extensionRegistry = new ExtensionRegistry();
```

### Hook Points

Plugins inject behavior at defined interfaces. These are the contract points between core and extensions.

```typescript
interface PluginHooks {
  // Lifecycle hooks
  onServerStart?: (context: PluginContext) => Promise<void>;
  onServerShutdown?: () => Promise<void>;

  // Document processing hooks
  onDocumentUpload?: (event: DocumentUploadedEvent) => Promise<void>;
  onDocumentScanned?: (event: DocumentScannedEvent) => Promise<void>;
  onPreviewReady?: (event: PreviewReadyEvent) => Promise<void>;

  // Permission hooks
  onPermissionCheck?: (request: PermissionCheckRequest) => Promise<PermissionDecision | null>;

  // Viewer hooks
  onViewerRender?: (context: ViewerRenderContext) => Promise<ViewerRenderContext>;

  // Room hooks
  onRoomCreate?: (event: RoomCreatedEvent) => Promise<void>;
  onRoomClosed?: (event: RoomClosedEvent) => Promise<void>;

  // Authentication hooks
  onUserLogin?: (event: UserLoginEvent) => Promise<void>;
  onUserLogout?: (event: UserLogoutEvent) => Promise<void>;

  // Audit/Compliance hooks
  onAuditEvent?: (event: DomainEvent) => Promise<void>;
}

// Hook execution utilities
interface HookExecutor {
  // Execute hook across all plugins
  executeHook<T>(hookName: string, data: T): Promise<T>;

  // Execute permission hooks in order; first non-null response wins
  executePermissionHooks(request: PermissionCheckRequest): Promise<PermissionDecision | null>;
}
```

### Plugin Loading Mechanism

Plugins are discovered from the `plugins/` directory or via environment variable at server startup.

```typescript
// Server bootstrap
async function initializePlugins() {
  // 1. Scan plugins/ directory for installed plugins
  const pluginDir = process.env.PLUGINS_DIR || './plugins';
  const pluginFolders = await fs.readdir(pluginDir);

  for (const folderName of pluginFolders) {
    const pluginPath = path.join(pluginDir, folderName);
    const pluginManifest = await import(path.join(pluginPath, 'plugin.js'));

    const plugin: DataRoomPlugin = pluginManifest.default;
    extensionRegistry.register(plugin);

    // 3. Call initialize() hook
    const context: PluginContext = {
      logger,
      db: prisma,
      config: appConfig,
      providers: currentProviders,
      hooks: hookExecutor,
    };

    try {
      await plugin.initialize(context);
      logger.info(`Plugin loaded: ${plugin.id}@${plugin.version}`);
    } catch (error) {
      logger.error(`Failed to load plugin ${plugin.id}`, error);
      if (process.env.FAIL_ON_PLUGIN_ERROR === 'true') {
        process.exit(1);
      }
    }
  }

  // 4. Merge custom providers
  const overrides = extensionRegistry.getProviders();
  Object.assign(globalProviders, overrides);
}
```

### TypeScript Plugin Interface

```typescript
interface DataRoomPlugin {
  // Plugin metadata
  id: string; // e.g., "enterprise-sso", "advanced-ai-redaction"
  name: string; // Display name
  version: string; // Semantic versioning
  author?: string;
  license?: string; // Should be AGPLv3-compatible or commercial
  description?: string;

  // Hook implementations (partial: plugin only implements hooks it needs)
  hooks: Partial<PluginHooks>;

  // Custom provider implementations (e.g., AuthSSOProvider, StorageProvider)
  providers?: Partial<ProviderOverrides>;

  // Optional: Custom API routes
  routes?: PluginRoute[];

  // Initialization: validate dependencies, set up resources
  initialize(context: PluginContext): Promise<void>;

  // Cleanup: close connections, release resources
  shutdown(): Promise<void>;
}

interface PluginRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string; // e.g., "/api/plugins/advanced-ai/redact"
  handler: (req: NextRequest) => Promise<NextResponse>;
  requiresAuth?: boolean; // Default: true
  roles?: ('admin' | 'viewer')[]; // Default: ['admin']
}

interface PluginContext {
  logger: Logger;
  db: PrismaClient;
  config: AppConfig;
  providers: AllProviders; // Current provider implementations
  hooks: HookExecutor; // Access to hook system
  env: Record<string, string>; // Plugin-specific env vars
}

type ProviderOverrides = Partial<{
  AuthSSOProvider: AuthSSOProvider;
  StorageProvider: StorageProvider;
  EmailProvider: EmailProvider;
  // ... other providers
}>;
```

### Relationship to Provider/Adapter Pattern

Plugins leverage the existing Provider/Adapter pattern to inject custom implementations:

```typescript
// Example: Enterprise SSO Plugin
export const enterpriseSSOPlugin: DataRoomPlugin = {
  id: 'enterprise-sso',
  name: 'Enterprise SSO (OIDC/SAML)',
  version: '1.0.0',

  hooks: {
    onUserLogin: async (event) => {
      // Custom logic: sync user attributes from OIDC provider
      await syncUserAttributesFromProvider(event.user);
    },
  },

  providers: {
    // Override the default AuthSSOProvider with custom implementation
    AuthSSOProvider: new EnterpriseOIDCProvider(config),
  },

  routes: [
    {
      method: 'POST',
      path: '/api/plugins/enterprise-sso/callback',
      handler: handleOIDCCallback,
      requiresAuth: false,
    },
  ],

  async initialize(context: PluginContext) {
    // Validate OIDC provider is reachable
    const provider = new EnterpriseOIDCProvider(context.config);
    await provider.validateConnection();
    context.logger.info('Enterprise SSO plugin initialized');
  },

  async shutdown() {
    // Cleanup
  },
};
```

### Enterprise vs. Community Boundary

**Core features** (AGPLv3) live in the main codebase and are always available:

- Basic access control, document upload/preview, viewer
- Built-in authentication (username/password)
- Standard audit logging
- Basic document management (archive, delete, versions)

**Enterprise features** are separate packages that register via the plugin system:

- SSO (OIDC, SAML, LDAP)
- Advanced AI (redaction, OCR, anomaly detection)
- Custom storage backends (private clouds)
- Custom email providers
- Signature plugins (DocuSign, e-signature)
- Advanced reporting and analytics
- Compliance integrations (GDPR, HIPAA)

At runtime, if a plugin is not registered, the core provides sensible defaults (or gracefully degrades). For example, if no AuthSSOProvider plugin is registered, the built-in password authentication is used.

```typescript
// Core code remains plugin-agnostic
async function handleUserLogin(credentials: LoginRequest) {
  // Try plugin hooks first
  const pluginDecision = await hookExecutor.executePermissionHooks({
    action: 'login',
    data: credentials,
  });

  if (pluginDecision) {
    return pluginDecision;
  }

  // Fallback to built-in auth
  return await builtInAuthService.authenticate(credentials);
}
```

### Plugin Lifecycle Example

A step-by-step walkthrough of how a plugin is loaded and used:

```
1. Server startup
   └─→ initializePlugins() scans plugins/ directory

2. Plugin discovered
   └─→ plugins/enterprise-sso/plugin.js exports DataRoomPlugin

3. Plugin registration
   └─→ extensionRegistry.register(enterpriseSSOPlugin)

4. Plugin initialization
   └─→ enterpriseSSOPlugin.initialize(context)
   └─→ Validates OIDC provider connectivity
   └─→ Registers custom AuthSSOProvider with global provider set

5. Runtime: User logs in via SSO
   └─→ Core calls hookExecutor.executeHook('onUserLogin', event)
   └─→ Enterprise SSO plugin onUserLogin hook executes
   └─→ Syncs user attributes from OIDC provider

6. Server shutdown
   └─→ extensionRegistry.listPlugins().forEach(p => p.shutdown())
```

---

## Request Flows

### 1. Document Upload Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ User selects file(s) and clicks Upload                          │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ API: POST /api/rooms/{roomId}/documents                         │
│ Validate: user is admin, room exists, file not too large        │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ For each file:                                                  │
│ 1. Generate UUIDs: document_id, version_id                      │
│ 2. Compute SHA-256 file hash                                    │
│ 3. Store original to StorageProvider (e.g., S3)                 │
│    Path: originals/{document_id}/{version_id}/{filename}        │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Create Document record in PostgreSQL                            │
│ ├─ id, room_id, organization_id, file_name                     │
│ ├─ ready_for_viewing: FALSE                                     │
│ └─ status: active                                               │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Create DocumentVersion record in PostgreSQL                     │
│ ├─ version_number: 1                                            │
│ ├─ file_hash: SHA-256                                           │
│ ├─ preview_status: pending                                      │
│ └─ uploaded_by_user_id: {admin_id}                              │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Emit event: document.uploaded                                   │
│ EventBus → immutable audit log                                  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Return success to client                                        │
│ (Document exists but not yet viewable)                          │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ [ASYNC BACKGROUND JOBS]                                         │
│                                                                 │
│ Queue HIGH-priority job: preview.scan                           │
│  │                                                              │
│  ├─→ Worker: ClamAV scans file                                  │
│  │   └─→ If infected: mark quarantined, stop pipeline, notify   │
│  │   └─→ If clean: continue to convert                          │
│  │                                                              │
│  ├─→ Queue HIGH-priority job: preview.convert                   │
│  │   │                                                          │
│  │   ├─→ Worker: Gotenberg converts to PDF                      │
│  │   │   └─→ Store at: previews/{doc_id}/{ver_id}/preview.pdf   │
│  │   │                                                          │
│  │   └─→ Emit event: preview.pdf_ready                          │
│  │                                                              │
│  ├─→ [Parallel] Queue jobs:                                     │
│  │   1. preview.extract_text                                    │
│  │      └─→ Extract text from PDF, store for search             │
│  │   2. preview.thumbnails                                      │
│  │      └─→ Generate PNG per page: thumb_1.png, etc.            │
│  │                                                              │
│  └─→ When both complete, queue: preview.index_text              │
│      └─→ Index extracted text in SearchProvider                 │
│      └─→ Mark document.ready_for_viewing = TRUE                 │
│      └─→ Emit event: preview.ready                              │
│      └─→ Notify admin: "Document ready for viewing"             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Timing:**

- Upload → API response: ~200ms (synchronous)
- Upload → Preview ready: ~10-30s per document (depends on size, conversion)

### 1.5. Document Lifecycle State Machine

Every document version progresses through a well-defined state machine. This ensures predictable behavior and enables robust error handling and retries.

#### State Enum

```typescript
enum DocumentVersionState {
  // Initial upload phase
  UPLOADING = 'UPLOADING', // File being written to storage

  // Scanning phase
  SCANNING = 'SCANNING', // Virus scan in progress
  SCAN_FAILED = 'SCAN_FAILED', // Terminal: file quarantined

  // Conversion phase
  CONVERTING = 'CONVERTING', // Converting to PDF (retryable)
  CONVERT_FAILED = 'CONVERT_FAILED', // Retryable: fallback to original

  // Extraction phase
  EXTRACTING = 'EXTRACTING', // Extracting text for search (retryable)
  EXTRACT_FAILED = 'EXTRACT_FAILED', // Retryable: document still viewable

  // Indexing phase
  INDEXING = 'INDEXING', // Indexing text in SearchProvider (retryable)
  INDEX_FAILED = 'INDEX_FAILED', // Retryable: document still viewable but not searchable

  // Ready for viewing
  ACTIVE = 'ACTIVE', // Document fully processed, ready for viewers

  // Terminal states (manual or policy-driven)
  ARCHIVED = 'ARCHIVED', // Soft-deleted via retention policy or manual action
  REDACTED = 'REDACTED', // V2: Redactions applied (immutable)
  LEGAL_HOLD = 'LEGAL_HOLD', // V1: Under legal hold, immutable
}
```

#### State Transition Diagram

```
┌──────────┐
│ UPLOADING│
└────┬─────┘
     │
     ▼
┌──────────┐
│ SCANNING │
└────┬─────┘
     │
     ├─→ [Virus detected] ─→ SCAN_FAILED (terminal, quarantined)
     │
     └─→ [Clean] ─→ CONVERTING
                      ▼
                   ┌──────────────┐
                   │  CONVERTING  │
                   └────┬─────────┘
                        │
                        ├─→ [Failure] ─→ CONVERT_FAILED (retryable)
                        │                   │
                        │                   └─→ [Retry] → CONVERTING
                        │
                        └─→ [Success] ─→ EXTRACTING
                                          ▼
                                       ┌──────────────┐
                                       │  EXTRACTING  │
                                       └────┬─────────┘
                                            │
                                            ├─→ [Failure] ─→ EXTRACT_FAILED (retryable)
                                            │                   │
                                            │                   └─→ [Retry] → EXTRACTING
                                            │
                                            └─→ [Success] ─→ INDEXING
                                                              ▼
                                                           ┌─────────┐
                                                           │ INDEXING│
                                                           └────┬────┘
                                                                │
                                                                ├─→ [Failure] ─→ INDEX_FAILED (retryable)
                                                                │                  │
                                                                │                  └─→ [Retry] → INDEXING
                                                                │
                                                                └─→ [Success] ─→ ACTIVE
                                                                                   ▼
                                                                                ┌────────┐
                                                                                │ ACTIVE │
                                                                                └───┬────┘
                                                                                    │
                                                    ┌───────────────────┬─────────┘
                                                    │                   │
                                        [Manual]    │    [Retention]    │
                                                    ▼                   ▼
                                                ┌─────────┐        ┌────────┐
                                                │ARCHIVED │        │ARCHIVED│
                                                └─────────┘        └────────┘
                                        [V2+] ──────▼──────────────────────▼
                                                    REDACTED
                                        [V1] ──────▼──────────────────────▼
                                                   LEGAL_HOLD
```

#### State Storage and Database Schema

States are stored on the `DocumentVersion` record:

```typescript
// Prisma schema
model DocumentVersion {
  id                  String
  document_id         String
  version_number      Int
  organization_id     String

  // STATE MACHINE
  state               DocumentVersionState // Current state
  state_changed_at    DateTime
  state_changed_by    String?              // User ID if manual transition

  // Scanning phase
  scan_status         String?              // "pending", "clean", "infected"
  scan_result         Json?                // Details from ClamAV

  // Conversion phase
  conversion_status   String?              // "pending", "success", "failed"
  conversion_error    String?              // Error message from Gotenberg

  // Extraction phase
  extraction_status   String?              // "pending", "success", "failed"
  extracted_text      String?              // Full text content for search

  // Indexing phase
  indexing_status     String?              // "pending", "success", "failed"
  indexing_error      String?              // Error message from SearchProvider

  // File references
  file_hash           String               // SHA-256
  file_size_bytes     Int
  preview_url         String?              // Signed URL to PDF
  thumbnail_urls      String[]             // Per-page thumbnails

  // Audit
  created_at          DateTime
  updated_at          DateTime
}
```

#### Worker Responsibilities

Each worker is responsible for one or more state transitions:

| Worker              | Handles                                            | Input State                                  | Output State(s)                |
| ------------------- | -------------------------------------------------- | -------------------------------------------- | ------------------------------ |
| **Web API**         | File upload, create DocumentVersion record         | -                                            | UPLOADING → SCANNING           |
| **ScanWorker**      | Virus scan (ClamAV)                                | SCANNING                                     | SCAN_FAILED \| CONVERTING      |
| **PreviewWorker**   | PDF conversion, text extraction, thumbnails        | CONVERTING                                   | CONVERT_FAILED \| EXTRACTING   |
| **ExtractorWorker** | Text extraction from PDF                           | EXTRACTING                                   | EXTRACT_FAILED \| INDEXING     |
| **IndexWorker**     | Index extracted text in SearchProvider             | INDEXING                                     | INDEX_FAILED \| ACTIVE         |
| **RetryWorker**     | Automatic retry of failed jobs                     | CONVERT_FAILED, EXTRACT_FAILED, INDEX_FAILED | Retries → original worker      |
| **Admin API**       | Manual archiving, redaction (V2+), legal hold (V1) | ACTIVE                                       | ARCHIVED, REDACTED, LEGAL_HOLD |

#### Error Handling: Retryable vs. Terminal

**Terminal States** (no automatic retry):

- `SCAN_FAILED`: File is infected. Quarantined permanently. Admin must delete or review with security team.

**Retryable States** (automatic retry with backoff):

- `CONVERT_FAILED`: Transient error in Gotenberg. Retry with exponential backoff (1s, 2s, 4s, 8s, ..., max 5 retries).
- `EXTRACT_FAILED`: Transient error in text extraction. Retry up to 3 times. If all fail, mark as `ACTIVE` anyway (document is still viewable, just not fully searchable).
- `INDEX_FAILED`: Transient error in SearchProvider. Retry up to 3 times. If all fail, mark as `ACTIVE` (document is searchable via full-text scan if needed).

```typescript
// RetryWorker logic
async function handleRetry(docVersionId: string) {
  const version = await documentVersionRepo.findById(docVersionId);

  if (version.state === 'CONVERT_FAILED') {
    version.retry_count = (version.retry_count || 0) + 1;

    if (version.retry_count > 5) {
      // Max retries exceeded, keep as CONVERT_FAILED
      version.state = 'CONVERT_FAILED';
      // Notify admin
      await sendNotification('document_conversion_stuck', { docVersionId });
    } else {
      // Retry conversion
      version.state = 'CONVERTING';
      await queueJob('preview.convert', { docVersionId });
    }
  }

  await documentVersionRepo.update(version);
}
```

#### Sequence Diagram: Full Ingestion Path

```
Client                Web API              StorageProvider   ScanWorker    PreviewWorker   SearchIndex
  │                     │                       │                │             │              │
  │──POST /documents───▶│                       │                │             │              │
  │                     │                       │                │             │              │
  │                     │──Create record────────│                │             │              │
  │                     │ (state=UPLOADING)     │                │             │              │
  │                     │◀──────────────────────│                │             │              │
  │                     │                       │                │             │              │
  │                     │──Upload file──────────▶                │             │              │
  │                     │                       │                │             │              │
  │                     │◀──────────────────────│                │             │              │
  │                     │                       │                │             │              │
  │◀──200 OK───────────│                       │                │             │              │
  │                     │                       │                │             │              │
  │                     │──Queue job: scan─────────────────────▶│             │              │
  │                     │ (state→SCANNING)      │                │             │              │
  │                     │                       │                │             │              │
  │                     │                       │                │──Scan file──│             │
  │                     │                       │                │             │              │
  │                     │◀────────Scan result───│◀───────────────│             │              │
  │                     │ (state→CONVERTING)    │                │             │              │
  │                     │                       │                │             │              │
  │                     │──Queue job: convert─────────────────────────────────▶             │
  │                     │ (state→CONVERTING)    │                │             │              │
  │                     │                       │                │             │──Convert───▶ │
  │                     │                       │                │             │              │
  │                     │◀───────PDF ready──────│◀────────────────────────────│              │
  │                     │ (state→EXTRACTING)    │                │             │              │
  │                     │                       │                │             │──Extract──▶  │
  │                     │                       │                │             │              │
  │                     │◀────Text extracted────│◀────────────────────────────│──Queue: idx─▶│
  │                     │ (state→INDEXING)      │                │             │              │
  │                     │                       │                │             │              │
  │                     │◀─────Indexed──────────│◀───────────────────────────────────────────│
  │                     │ (state→ACTIVE)        │                │             │              │
  │                     │ notify: "Ready"       │                │             │              │
  │                     │                       │                │             │              │
```

#### State Transition Handlers

Each state transition is guarded and logged:

```typescript
// Example: SCANNING → CONVERTING transition
async function markDocumentAsScanned(docVersionId: string, scanResult: ScanResult) {
  const version = await documentVersionRepo.findById(docVersionId);

  // Guard: must be in SCANNING state
  if (version.state !== 'SCANNING') {
    throw new Error(`Cannot transition from ${version.state} to CONVERTING. Expected SCANNING.`);
  }

  if (scanResult.infected) {
    version.state = 'SCAN_FAILED';
    version.scan_status = 'infected';
    version.state_changed_at = new Date();
    await eventBus.emit({
      event_type: 'document.scan_failed',
      document_id: version.document_id,
      metadata: { reason: scanResult.virus_names },
    });
  } else {
    version.state = 'CONVERTING';
    version.scan_status = 'clean';
    version.state_changed_at = new Date();

    // Queue next job
    await jobQueue.enqueue('preview.convert', { docVersionId });

    await eventBus.emit({
      event_type: 'document.scan_passed',
      document_id: version.document_id,
    });
  }

  await documentVersionRepo.update(version);
}
```

---

### 2. Document View Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Viewer clicks link or enters room URL                           │
│ Browser: GET /viewer/{roomId} or /public/{shareToken}           │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Middleware: Authentication & Tenancy                            │
│ ├─ If share link: validate token, password, expiry              │
│ ├─ If logged-in: validate session                               │
│ ├─ Attach organization_id to request context                    │
│ └─ Return 401 if not authenticated                              │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ API: GET /api/rooms/{roomId}/documents                          │
│ ├─ Get room via RoomRepository (scoped to organization)         │
│ ├─ Check room status (not closed)                               │
│ ├─ Get documents in room (scoped, ready_for_viewing=true)       │
│ └─ Return document list with preview URLs (not signed yet)      │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Render Viewer UI (Next.js/React)                                │
│ ├─ Folder navigation with breadcrumbs                           │
│ ├─ Document list                                                │
│ └─ PDF preview pane (initially empty)                           │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ User clicks on document                                         │
│ React state: selectedDocumentId = {docId}                       │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ API: GET /api/rooms/{roomId}/documents/{docId}                  │
│ ├─ PermissionEngine.canUserAccessDocument(viewer, doc, 'view')  │
│ │   ├─ Check share link permissions                             │
│ │   ├─ Check viewer role/group permissions                      │
│ │   ├─ Check document ACL                                       │
│ │   ├─ Check IP allowlist (if enabled)                          │
│ │   ├─ Check time-based access (if enabled)                     │
│ │   └─ Return: allowed=true or false + explanation              │
│ │                                                               │
│ ├─ If not allowed: return 403 Forbidden                         │
│ └─ If allowed: return document metadata                         │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ API: GET /api/rooms/{roomId}/documents/{docId}/preview          │
│ ├─ Check permissions again (canUserAccessDocument, 'view')      │
│ ├─ Fetch preview PDF from StorageProvider                       │
│ ├─ Apply watermark dynamically:                                 │
│ │   └─ Viewer email, IP, timestamp, custom text                 │
│ ├─ Return watermarked PDF as stream                             │
│ └─ Emit event: document.viewed                                  │
│    ├─ actor_id, ip_address, user_agent                          │
│    ├─ request_id, session_id (for grouping)                     │
│    └─ Store in events table                                     │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ React renders PDF in viewer                                     │
│ ├─ PDF.js library for rendering                                 │
│ ├─ Page navigation, zoom, search (in-document)                  │
│ └─ Track engagement: time per page, scroll depth                │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Periodically (every 30s):                                       │
│ ├─ Send engagement metrics to backend                           │
│ ├─ Current page, time spent, scroll depth                       │
│ └─ Update session last_activity_at                              │
└─────────────────────────────────────────────────────────────────┘
```

**Timing:**

- Room load → document list: ~100-200ms
- Click document → preview renders: ~300-500ms (network + rendering)

### 3. Room Creation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Admin navigates to "New Room" modal                              │
│ Form fields:                                                    │
│ ├─ Name (required)                                              │
│ ├─ Template (dropdown: investor, M&A, compliance, custom)       │
│ ├─ Folder structure (from template)                             │
│ └─ Initial permissions (role defaults)                          │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ API: POST /api/rooms                                            │
│ Body: { name, template_id }                                     │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Validate: user is admin, organization_id from context           │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ RoomService.createRoom():                                       │
│ 1. Create Room record                                           │
│    ├─ id, organization_id, name                                 │
│    ├─ status: 'draft'                                           │
│    ├─ created_by_user_id: {admin_id}                            │
│    └─ created_at: now()                                         │
│                                                                 │
│ 2. Load template (if provided)                                  │
│    ├─ Get template folder structure                             │
│    └─ Create folders for this room (recursive)                  │
│                                                                 │
│ 3. Set default permissions                                      │
│    ├─ Room admin: full permissions (creator)                    │
│    ├─ Viewers: no initial access (invite-based)                 │
│    └─ Groups: create "collaborators" group (optional)           │
│                                                                 │
│ 4. Emit event: room.created                                     │
│    └─ metadata: { name, template }                              │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Return room object to client                                    │
│ { id, name, status, created_at, folder_structure }              │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Admin is redirected to room detail page                         │
│ ├─ Documents tab (empty)                                        │
│ ├─ Members tab (only admin)                                     │
│ ├─ Settings tab (permissions, watermark, expiry, etc.)          │
│ └─ Ready to upload documents                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Timing:**

- Form submission → room created: ~100-200ms

### 4. Link Sharing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Admin clicks "Create Share Link"                                │
│ Modal opens with options:                                       │
│ ├─ Link type: public (anyone with link), restricted (invite)    │
│ ├─ Expiry: never, 7d, 30d, custom                               │
│ ├─ Password: optional                                           │
│ ├─ Permissions: view-only, download allowed, print allowed      │
│ └─ Scope: entire room, specific folder, specific document       │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ API: POST /api/rooms/{roomId}/links                             │
│ Body: { type, expires_in, password, permissions, scope_type,    │
│        scope_id }                                               │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Validate: user is admin of room                                 │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ ShareLinkService.createShareLink():                             │
│ 1. Generate unique token (crypto.randomBytes(32) → hex)         │
│ 2. Hash token for database (SHA-256)                            │
│ 3. Create ShareLink record:                                     │
│    ├─ token_hash (hashed for DB)                                │
│    ├─ room_id, organization_id                                  │
│    ├─ type: 'public' | 'restricted'                             │
│    ├─ scope_type: 'room' | 'folder' | 'document'                │
│    ├─ scope_id: {room_id} or {folder_id} or {document_id}       │
│    ├─ password_hash (bcrypt if provided)                        │
│    ├─ permissions: { can_view, can_download, can_print }        │
│    ├─ expires_at: now() + expires_in (or null)                  │
│    └─ created_at: now()                                         │
│                                                                 │
│ 4. Emit event: link.created                                     │
│    └─ metadata: { type, scope_type }                            │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Return response:                                                │
│ {                                                               │
│   token: "aB3cDeFgHijkLmnOpQrStUvWxYz123456",                  │
│   url: "https://dataroom.example.com/public/aB3cDeFg...",       │
│   expires_at: "2026-03-21T00:00:00Z"                            │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Admin copies link, shares with external party (email, Slack)    │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ External party clicks link                                      │
│ GET /public/{token}                                             │
│                                                                 │
│ ShareLinkService.validateShareLink(token):                      │
│ 1. Hash the token (same as stored hash)                         │
│ 2. Lookup in ShareLink table                                    │
│ 3. Checks:                                                      │
│    ├─ Token exists                                              │
│    ├─ Not expired (expires_at > now)                            │
│    ├─ Link not revoked (deleted_at is null)                     │
│    └─ Return link object with permissions                       │
│                                                                 │
│ 4. If password protected:                                       │
│    └─ Redirect to password entry form                           │
│                                                                 │
│ 5. Once authenticated, proceed as viewer                        │
│    └─ Attach link_id and link permissions to session            │
│    └─ PermissionEngine checks both viewer + link permissions    │
└─────────────────────────────────────────────────────────────────┘
```

**Timing:**

- Create link → return URL: ~100-150ms
- Click public link → password/email gate: ~50-100ms

---

## Directory Structure

**Proposed Next.js App Router project layout:**

```
vaultspace/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # Run tests, lint
│   │   ├── build.yml           # Build Docker image
│   │   └── deploy.yml          # Deploy to staging/prod
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md
│       └── feature_request.md
│
├── app/                         # Next.js App Router
│   ├── layout.tsx              # Root layout (fonts, providers)
│   ├── globals.css             # TailwindCSS + custom styles
│   ├── not-found.tsx
│   ├── error.tsx
│   │
│   ├── (auth)/
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── logout/page.tsx
│   │   ├── register/page.tsx
│   │   └── reset-password/page.tsx
│   │
│   ├── (admin)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── rooms/
│   │   │   ├── page.tsx        # Room list
│   │   │   ├── [roomId]/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx    # Room detail
│   │   │   │   ├── documents/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   └── [docId]/page.tsx
│   │   │   │   ├── members/page.tsx
│   │   │   │   ├── settings/page.tsx
│   │   │   │   ├── analytics/page.tsx
│   │   │   │   ├── audit/page.tsx
│   │   │   │   └── export/page.tsx
│   │   │   └── new/page.tsx    # Create room
│   │   ├── users/
│   │   │   ├── page.tsx        # User list
│   │   │   ├── [userId]/page.tsx
│   │   │   └── invite/page.tsx
│   │   ├── settings/
│   │   │   ├── page.tsx        # Organization settings
│   │   │   ├── security/page.tsx
│   │   │   ├── email/page.tsx
│   │   │   └── advanced/page.tsx
│   │   └── templates/
│   │       └── page.tsx
│   │
│   ├── (viewer)/
│   │   ├── layout.tsx
│   │   ├── [roomId]/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx        # Viewer UI
│   │   └── [roomId]/[docId]/page.tsx
│   │
│   ├── public/
│   │   ├── layout.tsx
│   │   ├── [shareToken]/
│   │   │   ├── page.tsx        # Password gate / email verify
│   │   │   └── viewer/page.tsx # Viewer (after auth)
│   │   └── email-verify/page.tsx
│   │
│   ├── api/
│   │
│   │   ### MVP Route Tree (Phase 0-6, 63 features)
│   │
│   │   ├── auth/
│   │   │   ├── login/route.ts
│   │   │   ├── logout/route.ts
│   │   │   ├── session/route.ts
│   │   │   └── [...routes]/route.ts
│   │   ├── rooms/
│   │   │   ├── route.ts
│   │   │   └── [roomId]/
│   │   │       ├── route.ts
│   │   │       ├── documents/
│   │   │       │   ├── route.ts
│   │   │       │   └── [docId]/
│   │   │       │       ├── route.ts
│   │   │       │       ├── versions/route.ts
│   │   │       │       ├── download/route.ts
│   │   │       │       ├── preview/route.ts
│   │   │       │       └── archive/route.ts
│   │   │       ├── members/route.ts
│   │   │       ├── links/route.ts
│   │   │       ├── audit/route.ts
│   │   │       ├── export/route.ts
│   │   │       └── settings/route.ts
│   │   ├── users/
│   │   │   ├── route.ts
│   │   │   └── [userId]/route.ts
│   │   ├── health/route.ts
│   │
│   │   ### V1+ Route Tree (DO NOT scaffold during MVP)
│   │
│   │   The following routes are defined here for architectural reference only.
│   │   AI agents MUST NOT create these files during MVP phases.
│   │
│   │   ├── auth/
│   │   │   └── sso/route.ts           # F072 - Single Sign-On (V1+)
│   │   ├── [roomId]/[docId]/
│   │   │   └── watermark/route.ts     # F023 - Document watermarking (V1+)
│   │   ├── webhooks/route.ts          # F058 - Webhook system (V1+)
│   │   ├── search/route.ts            # F011 - Full-text search (V1+)
│   │   ├── metrics/route.ts           # F067 - Usage metrics (V1+)
│   │
│   └── middleware.ts           # Auth, tenancy, CORS, rate limiting
│
├── components/
│   ├── admin/
│   │   ├── RoomList.tsx
│   │   ├── RoomDetail.tsx
│   │   ├── DocumentUpload.tsx
│   │   ├── DocumentList.tsx
│   │   ├── PermissionManager.tsx
│   │   ├── UserManager.tsx
│   │   ├── ShareLinkManager.tsx
│   │   ├── AuditViewer.tsx
│   │   └── AnalyticsDashboard.tsx
│   │
│   ├── viewer/
│   │   ├── ViewerLayout.tsx
│   │   ├── DocumentViewer.tsx  # PDF.js wrapper
│   │   ├── FolderBreadcrumb.tsx
│   │   ├── DocumentList.tsx
│   │   ├── Watermark.tsx
│   │   ├── PageNavigation.tsx
│   │   └── SearchBar.tsx
│   │
│   ├── common/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Modal.tsx
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Toast.tsx
│   │   ├── Loading.tsx
│   │   ├── ErrorBoundary.tsx
│   │   └── ConfirmDialog.tsx
│   │
│   └── forms/
│       ├── LoginForm.tsx
│       ├── RoomForm.tsx
│       ├── DocumentUploadForm.tsx
│       ├── InviteUsersForm.tsx
│       └── ShareLinkForm.tsx
│
├── lib/
│   ├── auth/
│   │   ├── session.ts          # Session handling
│   │   ├── jwt.ts              # JWT utility
│   │   ├── password.ts         # Hash/verify
│   │   └── rateLimit.ts        # Rate limiting
│   │
│   ├── db/
│   │   ├── prisma.ts           # Prisma singleton
│   │   ├── middleware.ts       # Tenant scoping
│   │   └── repositories/
│   │       ├── RoomRepository.ts
│   │       ├── DocumentRepository.ts
│   │       ├── UserRepository.ts
│   │       ├── PermissionRepository.ts
│   │       ├── EventRepository.ts
│   │       ├── ShareLinkRepository.ts
│   │       └── SearchIndexRepository.ts
│   │
│   ├── services/                # CoreService Layer (F148 extension)
│   │   ├── CoreServiceContext.ts # DI container for all services
│   │   ├── RoomService.ts        # All business logic here
│   │   ├── DocumentService.ts
│   │   ├── UserService.ts
│   │   ├── PermissionService.ts
│   │   ├── PreviewService.ts
│   │   ├── ShareLinkService.ts
│   │   ├── AuditService.ts
│   │   ├── NotificationService.ts
│   │   ├── ExportService.ts
│   │   ├── SearchService.ts
│   │   ├── WebhookService.ts
│   │   ├── EventBusService.ts
│   │   └── index.ts             # Factory for service instantiation
│   │
│   ├── providers/
│   │   ├── storage/
│   │   │   ├── StorageProvider.ts
│   │   │   ├── LocalStorageProvider.ts
│   │   │   ├── S3StorageProvider.ts
│   │   │   ├── AzureBlobProvider.ts
│   │   │   └── factory.ts
│   │   ├── email/
│   │   │   ├── EmailProvider.ts
│   │   │   ├── SmtpEmailProvider.ts
│   │   │   ├── SendGridEmailProvider.ts
│   │   │   ├── AzureCommsProvider.ts
│   │   │   └── factory.ts
│   │   ├── cache/
│   │   │   ├── CacheProvider.ts
│   │   │   ├── RedisCacheProvider.ts
│   │   │   ├── InMemoryCacheProvider.ts
│   │   │   └── factory.ts
│   │   ├── job/
│   │   │   ├── JobProvider.ts
│   │   │   ├── BullMqJobProvider.ts
│   │   │   ├── InProcessJobProvider.ts
│   │   │   └── factory.ts
│   │   ├── preview/
│   │   │   ├── PreviewProvider.ts
│   │   │   ├── GotenbergPreviewProvider.ts
│   │   │   └── factory.ts
│   │   ├── scan/
│   │   │   ├── ScanProvider.ts
│   │   │   ├── ClamAvScanProvider.ts
│   │   │   └── factory.ts
│   │   ├── search/
│   │   │   ├── SearchProvider.ts
│   │   │   ├── PostgresFtsSearchProvider.ts
│   │   │   ├── MeilisearchProvider.ts
│   │   │   └── factory.ts
│   │   ├── encryption/
│   │   │   ├── EncryptionProvider.ts
│   │   │   ├── AesEncryptionProvider.ts
│   │   │   ├── VaultEncryptionProvider.ts
│   │   │   └── factory.ts
│   │   ├── auth/
│   │   │   ├── AuthSSOProvider.ts
│   │   │   ├── OidcAuthProvider.ts
│   │   │   ├── LdapAuthProvider.ts
│   │   │   └── factory.ts
│   │   ├── monitoring/
│   │   │   ├── MonitoringProvider.ts
│   │   │   ├── ConsoleMonitoringProvider.ts
│   │   │   ├── OtelMonitoringProvider.ts
│   │   │   └── factory.ts
│   │   ├── cdn/
│   │   │   ├── CDNProvider.ts
│   │   │   ├── DirectServeCDNProvider.ts
│   │   │   ├── AzureCdnProvider.ts
│   │   │   └── factory.ts
│   │   └── factory.ts          # Central provider factory
│   │
│   ├── types/
│   │   ├── models.ts           # Prisma-generated types
│   │   ├── events.ts           # Event types
│   │   ├── api.ts              # API request/response types
│   │   ├── permissions.ts      # Permission types
│   │   └── providers.ts        # Provider interface definitions
│   │
│   ├── utils/
│   │   ├── crypto.ts           # Hash, encryption, random
│   │   ├── validators.ts       # Input validation
│   │   ├── format.ts           # Date/number formatting
│   │   ├── logger.ts           # Logging utility
│   │   └── errors.ts           # Custom error classes
│   │
│   └── hooks/
│       ├── useAuth.ts          # Auth context hook
│       ├── useRoom.ts
│       ├── useDocument.ts
│       ├── usePermissions.ts
│       └── useSearch.ts
│
├── prisma/
│   ├── schema.prisma           # Database schema
│   ├── migrations/             # Auto-generated by Prisma
│   └── seed.ts                 # Demo data seeding
│
├── public/
│   ├── favicon.ico
│   ├── logo.svg
│   ├── icons/
│   └── fonts/
│
├── scripts/
│   ├── seed.ts                 # Seed database
│   ├── migrate.ts              # Run migrations
│   ├── worker.ts               # Start background worker (dispatcher)
│   └── setup.ts                # Initial setup
│
├── workers/                     # Background job processors (use CoreService)
│   ├── general-worker.ts       # Email, notifications, search indexing (normal priority)
│   ├── preview-worker.ts       # Preview generation, OCR (high priority)
│   ├── scan-worker.ts          # Virus scanning (high priority)
│   ├── report-worker.ts        # Reports, ZIP/PDF export (low priority)
│   └── scheduled-jobs.ts       # Scheduled tasks (retention, partition creation, etc.)
│
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   ├── providers/
│   │   └── utils/
│   ├── integration/
│   │   ├── api/
│   │   ├── flows/
│   │   └── permissions/
│   ├── e2e/
│   │   ├── viewer.spec.ts
│   │   ├── admin.spec.ts
│   │   └── security.spec.ts
│   └── fixtures/
│       └── test-data.ts
│
├── docs/
│   ├── ARCHITECTURE.md          # This file
│   ├── DATABASE_SCHEMA.md       # F152
│   ├── EVENT_MODEL.md           # F153
│   ├── PERMISSION_MODEL.md      # F154
│   ├── DEPLOYMENT.md            # F155
│   ├── API.md                   # API documentation
│   ├── SECURITY.md              # F147
│   ├── CONTRIBUTING.md          # F146
│   ├── CODE_OF_CONDUCT.md       # F149
│   └── ROADMAP.md               # F150
│
├── docker/
│   ├── Dockerfile              # App image
│   ├── Dockerfile.worker       # Worker image
│   ├── docker-compose.yml      # Dev environment
│   ├── docker-compose.prod.yml # Production config
│   └── nginx.conf              # Reverse proxy config
│
├── .env.example                # Environment template
├── .env.test                   # Test environment
├── .eslintrc.json              # Linting
├── .prettierrc                 # Code formatting
├── tsconfig.json               # TypeScript config
├── next.config.js              # Next.js config
├── jest.config.js              # Test config
├── package.json
├── package-lock.json
├── README.md
├── LICENSE                     # AGPLv3
└── .gitignore
```

---

## Build Order

**Reference: Feature Matrix MVP Layer Structure (Lines 370-437)**

### Layer 0 - Zero Dependencies (Build First)

**Features:** F004, F059, F062, F064, F065, F146, F147, F148, F149

**Tasks:**

1. Set up Next.js 14+ project with TypeScript, React 18+, TailwindCSS
2. Set up PostgreSQL database (local development)
3. Set up local disk storage (for development)
4. Define role system (admin, viewer)
5. Create CONTRIBUTING.md, SECURITY.md, ARCHITECTURE.md (this file), CODE_OF_CONDUCT.md
6. Set up Docker Compose with app, PostgreSQL, Redis

### Layer 1 - Infrastructure Primitives & Design Docs

**Features:** F063, F066, F068, F070, F100, F102, F103, F141, F142, F152, F153, F154, F155

**Tasks:**

1. Environment variable configuration system (F063)
2. Reverse proxy configuration (Nginx/Caddy) (F066)
3. Prisma migrations (F068)
4. Local storage provider (F070)
5. BullMQ job queue with Redis (F100)
6. EventBus with database event log (F102)
7. Redis cache layer (F103)
8. PermissionEngine core logic (F141)
9. Multi-tenant organization model with Prisma middleware (F142)
10. Write DATABASE_SCHEMA.md (F152)
11. Write EVENT_MODEL.md (F153)
12. Write PERMISSION_MODEL.md (F154)
13. Write DEPLOYMENT.md (F155)

### Layer 2 - Core Document Pipeline

**Features:** F006, F101, F104, F105, F020, F137

**Tasks:**

1. Upload document endpoint (F006)
2. Preview pipeline (scan → convert → extract text → thumbnails → index) (F101)
3. Rate limiting middleware (F104)
4. Session management (F105)
5. User groups (F020)
6. Backup/restore tooling (F137)

### Layer 3 - Document Features

**Features:** F008, F010, F106, F107, F109, F108, F007, F009, F110

**Tasks:**

1. In-browser document viewer (PDF.js wrapper) (F008)
2. Document indexing and auto-numbering (F010)
3. File integrity hash (SHA-256) (F106)
4. Virus scanning (ClamAV) (F107)
5. Room templates (investor, M&A, compliance, custom) (F109)
6. Room lifecycle (draft, active, archived, closed) (F108)
7. Drag-and-drop upload (F007)
8. Multi-format support (PDF, DOCX, XLSX, PPTX, images) (F009)
9. Document tagging and metadata (F110)

### Layer 4 - Access Control & Audit

**Features:** F002, F005, F025, F016, F017, F019, F014, F113, F114, F116

**Tasks:**

1. Document version control with hash chain (F002)
2. Per-document and folder ACLs (F005)
3. Audit trail (immutable event log via EventBus) (F025)
4. Email verification (F016)
5. Password-protected rooms and links (F017)
6. Permission levels (view, download, print) (F019)
7. Download enable/disable per document (F014)
8. Archive/export room as ZIP (F113)
9. Trash/soft delete with recovery (F114)
10. Granular link permissions (F116)

### Layer 5 - User-Facing Features

**Features:** F001, F003, F033, F034, F035, F039, F121, F124, F130

**Tasks:**

1. Custom domain support (F001)
2. Email notifications (F003)
3. Branded viewer (white-label) (F033)
4. Mobile-responsive design (F034)
5. No account required for viewers (link-based) (F035)
6. Multi-admin support (F039)
7. Room activity dashboard (F121)
8. Breadcrumb navigation (F124)
9. Configurable room-level settings (F130)

### Layer 6 - Admin Features & Onboarding

**Features:** F040, F043, F044, F052, F128, F143

**Tasks:**

1. Admin activity log (F040)
2. Notification preferences per admin (F043)
3. Team member invite and role assignment (F044)
4. GDPR-compliant data deletion (F052)
5. Admin setup wizard (F128)
6. Demo seed data and sample room (F143)

---

## Cross-References

- **DATABASE_SCHEMA.md** (F152): Complete database schema, Document Object Model, SearchIndex design, Event partitioning strategy
- **EVENT_MODEL.md** (F153): Event type catalog, event schema, subscribers (audit, analytics, webhooks, notifications), retention/archival policies
- **PERMISSION_MODEL.md** (F154): Role hierarchy, group membership, ACL evaluation order, explainPermission diagnostic, IP rules, time-based access
- **DEPLOYMENT.md** (F155): Step-by-step Docker Compose, environment configuration, SSL/TLS, first-run wizard, upgrade procedures, troubleshooting

### Feature Dependencies

- **F148 (this ARCHITECTURE.md)** is referenced by F152, F153, F154, F155 as the base technical specification
- **F100 (job queue)** enables F101 (preview pipeline), F107 (scanning), F113 (ZIP export), F137 (backup/restore)
- **F102 (event bus)** enables F025 (audit trail), F003 (notifications), F058 (webhooks), F121 (analytics)
- **F141 (permission engine)** enables F005 (ACLs), F116 (link permissions), F019 (permission levels), F021 (IP rules), F022 (time-based)
- **F101 (preview pipeline)** enables F008 (viewer), F011 (search), F023 (watermarking)

### External Standards & References

- **AGPLv3 License:** https://www.gnu.org/licenses/agpl-3.0.html
- **GDPR Compliance:** Articles on data deletion (F052), data export, retention policies
- **OpenAPI/Swagger:** For REST API documentation (F061, future V1)
- **OpenTelemetry:** Vendor-neutral observability standard (F071)
- **WCAG 2.1 AA:** Accessibility compliance (F127, future V1)

---

**End of ARCHITECTURE.md**

This document is the authoritative specification for VaultSpace MVP implementation. Refer to linked design documents (DATABASE_SCHEMA.md, EVENT_MODEL.md, PERMISSION_MODEL.md, DEPLOYMENT.md) for detailed specifications of major subsystems.
