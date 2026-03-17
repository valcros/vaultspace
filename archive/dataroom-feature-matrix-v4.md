# DataRoomPlus - Feature Priority Matrix v4

## Project Metadata

| Field                   | Value                                                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project Name**        | DataRoomPlus                                                                                                                                                                                                                                          |
| **License**             | AGPLv3 (GNU Affero General Public License v3)                                                                                                                                                                                                         |
| **Commercial Strategy** | Core server is AGPLv3. Optional commercial offerings: hosted SaaS, enterprise support/SLA, and clearly separated enterprise-only add-ons. Anyone may self-host, modify, and use internally. Modified hosted versions must publish source under AGPL.  |
| **Tech Stack**          | Next.js 14+ (App Router), TypeScript, React 18+, Prisma ORM, PostgreSQL 15+, TailwindCSS, Redis (optional, for jobs/cache)                                                                                                                            |
| **Target Scale**        | Small (< 50 users, < 10K documents) for initial deployment. Architecture must support horizontal scaling without rewrites.                                                                                                                            |
| **Tenancy Model**       | Multi-tenant from day one. Every database entity includes organization_id. Single-org self-hosted installs have one default organization. Enables future hosted SaaS without schema migration.                                                        |
| **MVP UI**              | Full admin web UI and branded viewer UI included in MVP. No API-only phase.                                                                                                                                                                           |
| **Positioning**         | General-purpose secure document room platform. Use cases include investor data rooms, M&A due diligence, legal discovery, board portals, compliance document sharing, vendor/partner document exchange, and internal confidential document libraries. |
| **Repository**          | TBD (GitHub public repo)                                                                                                                                                                                                                              |

---

## Priority Levels

- **MVP** - Functional, deployable, self-hostable secure data room with admin UI and viewer experience
- **V1** - Aggressively competitive with commercial VDR products (Datasite, Intralinks, Firmex tier)
- **V2** - Advanced features: e-signatures, AI capabilities, deep analytics, extended compliance
- **V3** - Cloud provider-specific optional adapters (post-stable, community-contributable)

## Adapter Types

- **Core** - Built-in, no abstraction layer needed
- **Generic** - Implemented behind a provider interface; swappable via environment config
- **Cloud-Specific** - Optional adapter for a specific cloud provider

---

## Feature Matrix

### Platform Foundation

Infrastructure primitives that other features build on. These must be implemented first.

| ID   | Feature                                      | Priority | Adapter Type | Depends On       | Notes                                                                                                                                                                                                                                                                                                                                               |
| ---- | -------------------------------------------- | -------- | ------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F100 | Background job queue                         | MVP      | Generic      | F062             | JobProvider interface. Default: BullMQ + Redis. Fallback: in-process queue for small installs. Job classification: High (preview generation, virus scan), Normal (email dispatch, notifications), Low (analytics aggregation, report generation), Scheduled (retention cleanup, expiry checks).                                                     |
| F101 | Document preview/conversion pipeline         | MVP      | Generic      | F100, F065       | PreviewProvider interface. Multi-stage pipeline, each stage a job: (1) Scan via ScanProvider, (2) Convert to PDF via LibreOffice headless/Gotenberg, (3) Extract text for search index, (4) Generate page thumbnails, (5) Index metadata. Watermark overlay applied at render time, not baked into stored preview.                                  |
| F102 | Internal event bus                           | MVP      | Core         | F064             | EventBus system. All state changes emit events. Database-backed event log. Event schema: event_id, event_type, timestamp, actor_id, actor_type (admin/viewer/system), organization_id, room_id, document_id (nullable), metadata_json, ip_address, user_agent. This schema is the backbone for audit trail, notifications, webhooks, and analytics. |
| F103 | Cache layer                                  | MVP      | Generic      | F062             | **NEW.** CacheProvider interface. Default: Redis. Fallback: in-memory LRU. Used for session data, preview cache, rate limiting, and frequently accessed metadata.                                                                                                                                                                                   |
| F104 | Rate limiting and abuse prevention           | MVP      | Core         | F103             | **NEW.** Per-IP and per-user rate limits on API and viewer endpoints. Prevents brute-force attacks on password-protected rooms.                                                                                                                                                                                                                     |
| F105 | Session management                           | MVP      | Core         | F004, F103       | **NEW.** Secure session handling for admin and viewer sessions. Configurable session duration. Force logout capability.                                                                                                                                                                                                                             |
| F106 | File integrity verification (hash on upload) | MVP      | Core         | F006             | **NEW.** SHA-256 hash computed and stored on every upload. Enables tamper detection across versions.                                                                                                                                                                                                                                                |
| F107 | Virus/malware scanning on upload             | MVP      | Generic      | F006, F100       | **Promoted from V1.** ScanProvider interface. Default: ClamAV. Scans uploaded files as background job before making available to viewers. Quarantine flow for flagged files. Security is a trust fundamental.                                                                                                                                       |
| F141 | Centralized permission engine                | MVP      | Core         | F004             | **NEW.** Single module evaluates all access decisions: canUserAccessDocument(user, document, action). Actions: view, download, print, share, comment, sign. Consumes roles (F004), groups (F020), per-doc ACLs (F005), link-level permissions (F116), IP rules (F021), time limits (F022). Prevents permission logic duplication across codebase.   |
| F142 | Multi-tenant organization model              | MVP      | Core         | F064             | **NEW.** Every database entity includes organization_id. Default org created on first-run. Enables future multi-org hosting. Tenant isolation enforced at query layer via Prisma middleware or row-level security.                                                                                                                                  |
| F143 | Demo seed data and sample room               | MVP      | Core         | F128, F006, F108 | **NEW.** First-run setup wizard optionally installs a demo data room with sample folder structure, placeholder documents, and viewer accounts. Lets users experience the platform immediately after docker compose up. Uses hardcoded default structure; room templates (F109, V1) extend this later.                                               |

### Core Features

| ID   | Feature                                                     | Priority | Adapter Type | Depends On             | Notes                                                                                                                                                 |
| ---- | ----------------------------------------------------------- | -------- | ------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| F001 | Custom domain support                                       | MVP      | Core         | F066                   | Reverse proxy config (Nginx/Caddy)                                                                                                                    |
| F002 | Document version control with revision history              | MVP      | Core         | F006, F010, F106       | Track all revisions per document. Hash chain across versions (each version's hash includes parent hash) for legal defensibility and tamper detection. |
| F003 | Email notifications on document view/update                 | MVP      | Generic      | F059, F043, F102       | Triggered by EventBus. Uses EmailProvider interface.                                                                                                  |
| F004 | Role separation: admin vs. viewer                           | MVP      | Core         | —                      | Foundation for all access control. No dependencies.                                                                                                   |
| F005 | Per-document and per-folder access controls                 | MVP      | Core         | F004, F010, F020, F141 | Granular permissions on folders and files. Evaluated via centralized PermissionEngine (F141).                                                         |
| F108 | Room lifecycle management (draft, active, archived, closed) | MVP      | Core         | F004                   | **NEW.** Rooms have states. Archived rooms are read-only. Closed rooms deny all viewer access.                                                        |
| F109 | Room templates (M&A, investor, board, compliance, custom)   | V1       | Core         | F108, F006             | **NEW.** Pre-built folder structures, permission defaults, and checklists per use case. Users can create custom templates from existing rooms.        |

### Document Management

| ID   | Feature                                                   | Priority | Adapter Type | Depends On             | Notes                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------- | -------- | ------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F006 | Bulk upload with folder structure preservation            | MVP      | Core         | F065                   | Uses StorageProvider interface                                                                                                                                                                                                     |
| F007 | Drag-and-drop upload                                      | MVP      | Core         | F006                   | Frontend enhancement to upload flow                                                                                                                                                                                                |
| F008 | In-browser document viewer (no download required)         | MVP      | Core         | F101                   | Renders preview PDFs generated by conversion pipeline. Not limited to PDF uploads.                                                                                                                                                 |
| F009 | Multi-format support (PDF, DOCX, XLSX, PPTX, images)      | MVP      | Core         | F008, F101             | Conversion pipeline handles all formats. Original files stored as-is.                                                                                                                                                              |
| F010 | Document indexing and auto-numbering                      | MVP      | Core         | F006                   | Foundation for version control and search. Bates-style numbering option.                                                                                                                                                           |
| F011 | Full-text search across documents                         | V1       | Generic      | F006, F009, F010, F100 | **Updated.** SearchProvider interface. MVP default: PostgreSQL FTS. V1 alternative: Meilisearch. V2: OpenSearch/Elasticsearch. Search engines eventually require separate scaling. Text extraction runs as pipeline stage in F101. |
| F012 | Document expiry dates                                     | V1       | Core         | F005, F100             | Background job checks and auto-revokes access after date                                                                                                                                                                           |
| F013 | Replace document without changing share link              | V1       | Core         | F002, F006             | Stable URLs across versions                                                                                                                                                                                                        |
| F014 | Download enable/disable per document                      | MVP      | Core         | F005                   | Per-document permission flag                                                                                                                                                                                                       |
| F015 | Print enable/disable per document                         | V1       | Core         | F005, F008             | Per-document permission flag                                                                                                                                                                                                       |
| F110 | Document tagging and custom metadata                      | MVP      | Core         | F010                   | **NEW.** Admin-defined tags and key-value metadata on documents. Filterable in UI. Supports use-case-specific taxonomies (financial, legal, technical, HR, etc.).                                                                  |
| F111 | Folder and document drag-and-drop reordering              | V1       | Core         | F010                   | **NEW.** Rearrange folder hierarchy and document order within folders via drag-and-drop in admin UI.                                                                                                                               |
| F112 | Document comparison (diff between versions)               | V1       | Core         | F002, F101             | **NEW.** Visual side-by-side or overlay diff of two document versions. Text-based diff for supported formats.                                                                                                                      |
| F113 | Archive/export entire room as ZIP                         | V1       | Core         | F006, F100, F108       | **NEW.** Background job packages all room documents with folder structure into downloadable ZIP. Includes index manifest.                                                                                                          |
| F114 | Trash/soft delete with recovery                           | MVP      | Core         | F006, F025             | **NEW.** Deleted documents go to trash for configurable period before permanent removal. Admin can restore. Audit logged.                                                                                                          |
| F115 | Document annotations and comments (admin-side)            | V1       | Core         | F008, F004             | **NEW.** Admins can add internal annotations to documents visible only to other admins. Not exposed to viewers.                                                                                                                    |
| F144 | Bulk document operations (move, tag, delete, permissions) | V1       | Core         | F005, F010, F110, F114 | **NEW.** Select multiple documents/folders and apply actions in batch: move to folder, apply tags, set permissions, soft delete. Essential admin productivity for large rooms.                                                     |

### Access Control & Security

| ID   | Feature                                                             | Priority | Adapter Type | Depends On       | Notes                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------- | -------- | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F016 | Email verification before access                                    | MVP      | Generic      | F059             | Uses EmailProvider interface                                                                                                                                                                                                                           |
| F017 | Password-protected rooms and links                                  | MVP      | Core         | F104             | Room-level and link-level passwords. Rate limited against brute force.                                                                                                                                                                                 |
| F018 | NDA/agreement gate before room access                               | V1       | Core         | F016             | Must verify email before presenting NDA                                                                                                                                                                                                                |
| F019 | Per-user and per-group permission levels                            | MVP      | Core         | F004, F020       | View, download, print granularity                                                                                                                                                                                                                      |
| F020 | User group management                                               | MVP      | Core         | F004             | Create/manage groups for batch permissions                                                                                                                                                                                                             |
| F021 | IP allowlist/blocklist                                              | V1       | Core         | F004             | Standard security feature                                                                                                                                                                                                                              |
| F022 | Time-limited access with auto-revocation                            | V1       | Core         | F005, F019, F100 | Background job revokes access on expiry                                                                                                                                                                                                                |
| F023 | Dynamic watermarking (viewer email/IP on pages)                     | V1       | Core         | F008, F016       | **Enhanced.** Overlay per page at render time (not baked into stored preview). Configurable fields: viewer name, email, IP address, timestamp, room name, custom text. Diagonal and margin placement options. Applied via PreviewProvider render path. |
| F024 | Screenshot protection                                               | V2       | Core         | F008             | CSS/JS-based deterrent (not foolproof)                                                                                                                                                                                                                 |
| F025 | Audit trail of all user activity                                    | MVP      | Core         | F004, F102       | **Updated.** Built on EventBus. Every action recorded with actor, timestamp, IP, user-agent. Immutable log.                                                                                                                                            |
| F026 | Two-factor authentication for admin users                           | V1       | Core         | F004             | TOTP-based 2FA                                                                                                                                                                                                                                         |
| F116 | Granular link permissions (per-link expiry, password, access scope) | MVP      | Core         | F005, F017       | **NEW.** Each share link can have independent expiry, password, and document scope. Multiple links per room with different access levels.                                                                                                              |
| F117 | Viewer invitation management (invite, remind, revoke in batch)      | V1       | Core         | F016, F019, F059 | **NEW.** Bulk invite viewers via CSV or email list. Batch send reminders. Bulk revoke access.                                                                                                                                                          |
| F118 | Access request workflow                                             | V1       | Core         | F016, F044       | **NEW.** Uninvited users can request access. Admin approves/denies. Email notification on request.                                                                                                                                                     |
| F119 | Device and browser fingerprinting for sessions                      | V2       | Core         | F025, F105       | **NEW.** Track which devices accessed the room. Alert on new/unknown devices.                                                                                                                                                                          |
| F120 | Encryption at rest (document-level)                                 | V1       | Generic      | F065, F106       | **NEW.** EncryptionProvider interface. Documents encrypted before storage. Key management via config or external vault.                                                                                                                                |
| F145 | Document redaction tool                                             | V2       | Core         | F008, F101, F025 | **NEW.** Admin can redact sensitive information (draw redaction boxes over content) before sharing with viewers. Redacted version stored separately; original preserved with admin-only access. Audit-logged. Critical for legal and M&A use cases.    |

### Analytics & Reporting

| ID   | Feature                                       | Priority | Adapter Type | Depends On       | Notes                                                                                                                                                                                      |
| ---- | --------------------------------------------- | -------- | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F027 | Page-level engagement tracking                | V1       | Core         | F008, F025       | Time per page, scroll depth                                                                                                                                                                |
| F028 | Per-viewer activity dashboard                 | V1       | Core         | F025, F027       | Admin view of individual viewer activity                                                                                                                                                   |
| F029 | Document view heatmaps                        | V2       | Core         | F027, F028       | Visual representation of engagement                                                                                                                                                        |
| F030 | Real-time notification on viewer open/revisit | V1       | Generic      | F003, F025       | Push or email alert to admins                                                                                                                                                              |
| F031 | Exportable activity reports (CSV/PDF)         | V1       | Core         | F025, F028, F100 | Background job generates reports                                                                                                                                                           |
| F032 | Aggregate vs. individual viewer analytics     | V2       | Core         | F027, F028       | Compare cohort behavior                                                                                                                                                                    |
| F121 | Room activity summary dashboard               | MVP      | Core         | F025             | **NEW.** Basic MVP analytics: total views, unique viewers, most viewed documents, recent activity. Visible on room admin page.                                                             |
| F122 | Activity digest emails (daily/weekly)         | V1       | Generic      | F025, F059, F100 | **NEW.** Scheduled background job sends admin summary of room activity. Configurable frequency per admin.                                                                                  |
| F123 | Due diligence checklist tracking              | V1       | Core         | F110, F108       | **NEW.** Define checklist items per room. Track which documents satisfy which checklist items. Progress percentage visible to admins and optionally to viewers. Critical for M&A use case. |

### Viewer Experience

| ID   | Feature                                      | Priority | Adapter Type | Depends On | Notes                                                                                                                                                                         |
| ---- | -------------------------------------------- | -------- | ------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F033 | Branded viewer with no third-party branding  | MVP      | Core         | F001       | White-label experience. Custom logo, colors, favicon.                                                                                                                         |
| F034 | Mobile-responsive document viewer            | MVP      | Core         | F008       | Touch-friendly, responsive layout                                                                                                                                             |
| F035 | No account required for viewers (link-based) | MVP      | Core         | F016, F017 | Email verification without account creation                                                                                                                                   |
| F036 | Optional viewer login portal                 | V1       | Core         | F035, F019 | Persistent access for repeat visitors                                                                                                                                         |
| F037 | Q&A module (viewer questions routed to team) | V2       | Core         | F036, F059 | In-room communication channel                                                                                                                                                 |
| F038 | Document request tracking                    | V2       | Core         | F037       | Viewers can request missing documents                                                                                                                                         |
| F124 | Breadcrumb navigation in folder hierarchy    | MVP      | Core         | F010       | **NEW.** Viewers see folder path and can navigate up. Essential for rooms with deep folder structures.                                                                        |
| F125 | Viewer-side document bookmarking             | V1       | Core         | F036       | **NEW.** Logged-in viewers can bookmark documents for quick access. Stored server-side.                                                                                       |
| F126 | Multi-language UI (i18n framework)           | V1       | Core         | —          | **NEW.** UI strings externalized for translation. Ship with English. Community can contribute translations. Framework must be in place even if only one language ships in V1. |
| F127 | Accessibility compliance (WCAG 2.1 AA)       | V1       | Core         | F008, F034 | **NEW.** Keyboard navigation, screen reader support, sufficient contrast, ARIA labels. Applies to both admin and viewer UIs.                                                  |

### Administration

| ID   | Feature                                      | Priority | Adapter Type | Depends On       | Notes                                                                                                                                  |
| ---- | -------------------------------------------- | -------- | ------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| F039 | Multi-admin support                          | MVP      | Core         | F004             | Multiple admin users per deployment                                                                                                    |
| F040 | Admin activity log                           | MVP      | Core         | F025, F039       | What admins changed and when                                                                                                           |
| F041 | Room duplication (clone for new deal)        | V1       | Core         | F005, F006, F108 | Copy room structure, permissions, docs                                                                                                 |
| F042 | Multiple simultaneous data rooms             | V1       | Core         | F004, F005, F108 | Isolated rooms with separate access                                                                                                    |
| F043 | Notification preferences per admin user      | MVP      | Core         | F039             | Per-admin email/alert settings                                                                                                         |
| F044 | Team member invite and role assignment       | MVP      | Core         | F004, F039       | Invite via email, assign admin/viewer role                                                                                             |
| F128 | Admin setup wizard (first-run configuration) | MVP      | Core         | F062, F063       | **NEW.** Guided setup on first deployment: create admin account, configure email, set organization name/logo, test storage connection. |
| F129 | Multi-room admin dashboard                   | V1       | Core         | F042, F121       | **NEW.** Overview of all rooms with status, activity, and alerts. Quick access to any room.                                            |
| F130 | Configurable room-level settings             | MVP      | Core         | F108             | **NEW.** Per-room configuration: allow downloads, require NDA, enable watermark, set default expiry. Distinct from global settings.    |
| F131 | Bulk viewer management (CSV import/export)   | V1       | Core         | F117             | **NEW.** Import viewer lists from CSV. Export current viewer list with access status.                                                  |

### E-Signatures

| ID   | Feature                                             | Priority | Adapter Type | Depends On       | Notes                                                          |
| ---- | --------------------------------------------------- | -------- | ------------ | ---------------- | -------------------------------------------------------------- |
| F045 | Built-in basic e-signature (draw/type signature)    | V2       | Core         | F008, F016, F025 | Simple signature capture on documents                          |
| F046 | Signature request workflow (request, remind, track) | V2       | Core         | F045, F059       | Admin sends signature requests to viewers                      |
| F047 | Signed document storage with tamper-evident hash    | V2       | Core         | F045, F002, F106 | Immutable record of signed version. Chain of custody via hash. |
| F048 | DocuSign integration adapter                        | V2       | Generic      | F045, F057       | External e-signature provider via API                          |
| F049 | Signature audit trail with timestamps               | V2       | Core         | F045, F025       | Who signed what and when                                       |
| F050 | Counter-signature support (multi-party signing)     | V2       | Core         | F046             | Multiple signers in sequence or parallel                       |
| F051 | Signature status dashboard                          | V2       | Core         | F046, F028       | Track pending, completed, expired signatures                   |

### AI Features

| ID   | Feature                                         | Priority | Adapter Type | Depends On       | Notes                                                                                         |
| ---- | ----------------------------------------------- | -------- | ------------ | ---------------- | --------------------------------------------------------------------------------------------- |
| F074 | AI document auto-categorization on upload       | V2       | Generic      | F006, F010, F100 | Uses AIProvider interface. Classify by type (financial, legal, etc.). Runs as background job. |
| F075 | AI document summarization                       | V2       | Generic      | F009, F011       | Generate summaries for admin review                                                           |
| F076 | AI-powered semantic search                      | V2       | Generic      | F011, F074       | Natural language search across all documents. Vector embeddings stored alongside text index.  |
| F077 | AI-suggested access permissions                 | V2       | Generic      | F005, F074       | Recommend permissions based on doc type and past patterns                                     |
| F078 | AI redaction detection (flag sensitive content) | V2       | Generic      | F009, F074       | Identify PII, financial data, or confidential markers                                         |
| F079 | AI Q&A assistant for viewers                    | V2       | Generic      | F037, F075       | Viewers ask questions, AI answers from room docs                                              |
| F132 | AI-powered OCR for scanned documents            | V2       | Generic      | F101, F074       | **NEW.** Extract text from scanned PDFs and images. Makes scanned documents searchable.       |

### Compliance & Legal

| ID   | Feature                                    | Priority | Adapter Type | Depends On       | Notes                                                                                                                                                       |
| ---- | ------------------------------------------ | -------- | ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F052 | GDPR-compliant data handling and deletion  | MVP      | Core         | F006, F025, F114 | Right to erasure, data export. Trash/soft delete supports recovery period.                                                                                  |
| F053 | Data residency selection (EU, US, etc.)    | V2       | Generic      | F065             | Storage region configuration                                                                                                                                |
| F054 | SOC 2 aligned audit logging                | V2       | Core         | F025, F040       | Structured logs meeting SOC 2 requirements                                                                                                                  |
| F055 | Legally timestamped NDA acceptance records | V1       | Core         | F018             | Cryptographic timestamp on acceptance                                                                                                                       |
| F056 | Configurable data retention policies       | V2       | Core         | F052, F100       | Background job enforces auto-delete after configurable period                                                                                               |
| F133 | Export compliance package (audit bundle)   | V1       | Core         | F025, F040, F100 | **NEW.** Export complete audit trail, NDA records, access logs, and document manifest as a signed compliance package. For legal and regulatory submissions. |
| F134 | Chain of custody report per document       | V1       | Core         | F002, F025, F106 | **NEW.** Full history of a document: upload, every version, every viewer, every download, hash verification. Exportable.                                    |

### Integration & API

| ID   | Feature                                          | Priority | Adapter Type | Depends On       | Notes                                                                                                    |
| ---- | ------------------------------------------------ | -------- | ------------ | ---------------- | -------------------------------------------------------------------------------------------------------- |
| F057 | REST API for room/document management            | V1       | Core         | F004, F005, F006 | Programmatic access to all core functions                                                                |
| F058 | Webhook support for external event notifications | V1       | Generic      | F057, F102       | **Moved from V2.** HTTP callbacks on room/doc/user events. Built on EventBus. Critical for integrations. |
| F059 | SMTP-agnostic email (any provider)               | MVP      | Generic      | —                | EmailProvider interface. Default: SMTP                                                                   |
| F060 | Slack/Teams notification integration             | V2       | Generic      | F058             | Webhook-based channel notifications                                                                      |
| F061 | OpenAPI/Swagger specification                    | V1       | Core         | F057             | Auto-generated API docs                                                                                  |
| F135 | API key management (per-admin, per-integration)  | V1       | Core         | F057, F004       | **NEW.** Create, rotate, and revoke API keys. Scoped permissions per key. Audit log of API key usage.    |
| F136 | Embeddable viewer widget (iframe)                | V2       | Core         | F008, F057       | **NEW.** Embed document viewer into external websites via iframe with token-based auth.                  |

### Deployment & Self-Hosting

| ID   | Feature                                          | Priority | Adapter Type | Depends On       | Notes                                                                                                                                                                                                 |
| ---- | ------------------------------------------------ | -------- | ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F062 | Docker Compose single-command deployment         | MVP      | Core         | —                | Primary deployment method. Includes app, PostgreSQL, Redis.                                                                                                                                           |
| F063 | Environment variable-based configuration         | MVP      | Core         | F062             | All config via .env, no code changes                                                                                                                                                                  |
| F064 | PostgreSQL database support                      | MVP      | Generic      | —                | Primary database via Prisma ORM                                                                                                                                                                       |
| F065 | S3-compatible storage (AWS S3, MinIO, Backblaze) | MVP      | Generic      | —                | StorageProvider interface. No dependency on F006 (interface defined independently).                                                                                                                   |
| F066 | Reverse proxy ready (Nginx, Caddy, Traefik)      | MVP      | Core         | F062             | SSL termination, custom domains. Example configs included.                                                                                                                                            |
| F067 | Health check endpoints                           | V1       | Core         | F062             | Readiness and liveness probes                                                                                                                                                                         |
| F068 | Automated database migrations on upgrade         | MVP      | Core         | F064             | **Promoted from V1.** Prisma migrate on container start. Essential for safe upgrades.                                                                                                                 |
| F069 | MySQL/MariaDB support                            | V2       | Generic      | F064             | Alternative DB via Prisma adapter                                                                                                                                                                     |
| F070 | Local disk storage adapter (dev/small installs)  | MVP      | Generic      | F065             | StorageProvider for local filesystem                                                                                                                                                                  |
| F071 | OpenTelemetry monitoring (vendor-neutral)        | V1       | Generic      | F062             | MonitoringProvider interface                                                                                                                                                                          |
| F137 | Backup and restore tooling                       | MVP      | Core         | F064, F065, F100 | **Promoted from V1.** CLI command or admin UI action to backup database + storage to archive. Restore from backup. Documented procedure. Admins will not trust a data room without backup capability. |
| F138 | Helm chart for Kubernetes deployment             | V2       | Core         | F062             | **NEW.** K8s deployment option for production environments.                                                                                                                                           |
| F139 | Horizontal scaling documentation and support     | V2       | Core         | F062, F100, F103 | **NEW.** Documented architecture for running multiple app instances behind a load balancer. Requires Redis for shared sessions and job queue.                                                         |

### SSO & Identity

| ID   | Feature                                 | Priority | Adapter Type | Depends On | Notes                                                                           |
| ---- | --------------------------------------- | -------- | ------------ | ---------- | ------------------------------------------------------------------------------- |
| F072 | Generic OIDC/OAuth2 SSO for admin login | V1       | Generic      | F004, F026 | AuthSSOProvider interface                                                       |
| F073 | LDAP/Active Directory integration       | V2       | Generic      | F072       | Enterprise directory sync                                                       |
| F140 | SAML 2.0 SSO support                    | V2       | Generic      | F072       | **NEW.** Many enterprises require SAML. Implemented as AuthSSOProvider adapter. |

### Project Governance & Community

| ID   | Feature                                          | Priority | Adapter Type | Depends On | Notes                                                                                                                                                                  |
| ---- | ------------------------------------------------ | -------- | ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F146 | CONTRIBUTING.md and developer onboarding guide   | MVP      | Core         | —          | **NEW.** How to set up dev environment, run tests, submit PRs. Essential for community contributions from day one.                                                     |
| F147 | SECURITY.md and vulnerability disclosure process | MVP      | Core         | —          | **NEW.** Responsible disclosure instructions, security contact, PGP key. Required for any security-sensitive open-source project.                                      |
| F148 | ARCHITECTURE.md system design overview           | MVP      | Core         | —          | **NEW.** High-level architecture diagram, module descriptions, data flow, interface contracts. Enables contributors to understand the system without reading all code. |
| F149 | CODE_OF_CONDUCT.md                               | MVP      | Core         | —          | **NEW.** Community behavior standards. Contributor Covenant or equivalent.                                                                                             |
| F150 | ROADMAP.md with public feature timeline          | V1       | Core         | —          | **NEW.** Public-facing roadmap aligned with this feature matrix. Updated per release.                                                                                  |
| F151 | RFC process for major feature proposals          | V1       | Core         | F146       | **NEW.** Documented process for community members to propose significant changes. Template, review process, and decision criteria.                                     |

### Cloud Adapters: Azure

| ID   | Feature                                       | Priority | Adapter Type   | Depends On | Notes                                |
| ---- | --------------------------------------------- | -------- | -------------- | ---------- | ------------------------------------ |
| F080 | Native Azure Blob Storage adapter             | V3       | Cloud-Specific | F065       | Optimized SDK vs. S3-compat layer    |
| F081 | Azure Entra ID SSO adapter                    | V3       | Cloud-Specific | F072       | Azure-specific OIDC extension        |
| F082 | Azure Key Vault secrets adapter               | V3       | Cloud-Specific | F080       | Secrets management                   |
| F083 | Azure CDN delivery adapter                    | V3       | Cloud-Specific | F080       | CDNProvider interface                |
| F084 | Azure App Service / Container Apps deployment | V3       | Cloud-Specific | F062       | Platform-specific deployment configs |
| F085 | Azure Application Insights adapter            | V3       | Cloud-Specific | F071       | MonitoringProvider for Azure         |
| F086 | Azure Communication Services email adapter    | V3       | Cloud-Specific | F059       | EmailProvider for Azure              |
| F087 | Azure Bicep/ARM deployment templates          | V3       | Cloud-Specific | F084       | Infrastructure as code               |

### Cloud Adapters: AWS

| ID   | Feature                           | Priority | Adapter Type   | Depends On | Notes                  |
| ---- | --------------------------------- | -------- | -------------- | ---------- | ---------------------- |
| F090 | AWS S3 native adapter (optimized) | V3       | Cloud-Specific | F065       | Direct SDK integration |
| F091 | AWS SES email adapter             | V3       | Cloud-Specific | F059       | EmailProvider for AWS  |
| F092 | AWS CloudFront CDN adapter        | V3       | Cloud-Specific | F090       | CDNProvider for AWS    |

### Cloud Adapters: GCP

| ID   | Feature                      | Priority | Adapter Type   | Depends On | Notes                   |
| ---- | ---------------------------- | -------- | -------------- | ---------- | ----------------------- |
| F093 | Google Cloud Storage adapter | V3       | Cloud-Specific | F065       | StorageProvider for GCP |
| F094 | Google Cloud CDN adapter     | V3       | Cloud-Specific | F093       | CDNProvider for GCP     |

---

## Summary by Priority

| Priority  | Feature Count | Description                                                                                                                                                                                                                  |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP       | 56            | Functional, self-hostable secure data room with admin UI, viewer experience, job queue, preview pipeline, event bus, permission engine, multi-tenant model, audit trail, virus scanning, backup/restore, and governance docs |
| V1        | 44            | Aggressively competitive with commercial VDRs: search, watermarking, NDA gates, analytics dashboards, webhooks, checklists, compliance exports, bulk operations, accessibility, RFC process                                  |
| V2        | 31            | E-signatures, AI capabilities, deep analytics, document redaction, extended compliance, Kubernetes, SAML                                                                                                                     |
| V3        | 13            | Cloud provider adapters, all optional and unbundled                                                                                                                                                                          |
| **Total** | **144**       |                                                                                                                                                                                                                              |

## Summary by Adapter Type

| Adapter Type   | Feature Count | Description                                                |
| -------------- | ------------- | ---------------------------------------------------------- |
| Core           | 101           | Built directly into the application                        |
| Generic        | 30            | Interface-defined, provider swappable via env config       |
| Cloud-Specific | 13            | Optional, post-stable, community or maintainer contributed |

## Summary by Category

| Category                       | MVP | V1  | V2  | V3  | Total |
| ------------------------------ | --- | --- | --- | --- | ----- |
| Platform Foundation            | 11  | 0   | 0   | 0   | 11    |
| Core Features                  | 6   | 1   | 0   | 0   | 7     |
| Document Management            | 8   | 9   | 0   | 0   | 17    |
| Access Control & Security      | 6   | 8   | 3   | 0   | 17    |
| Analytics & Reporting          | 1   | 6   | 2   | 0   | 9     |
| Viewer Experience              | 4   | 4   | 2   | 0   | 10    |
| Administration                 | 6   | 4   | 0   | 0   | 10    |
| E-Signatures                   | 0   | 0   | 7   | 0   | 7     |
| AI Features                    | 0   | 0   | 7   | 0   | 7     |
| Compliance & Legal             | 1   | 3   | 3   | 0   | 7     |
| Integration & API              | 1   | 4   | 2   | 0   | 7     |
| Deployment & Self-Hosting      | 8   | 2   | 3   | 0   | 13    |
| SSO & Identity                 | 0   | 1   | 2   | 0   | 3     |
| Project Governance & Community | 4   | 2   | 0   | 0   | 6     |
| Cloud Adapters                 | 0   | 0   | 0   | 13  | 13    |

---

## Generic Interface Summary

The following interfaces must be defined in MVP architecture to allow adapter swapping:

| Interface            | MVP Default                             | V1 Alternatives        | V2 Additions                                   | V3 Cloud Adapters                                   |
| -------------------- | --------------------------------------- | ---------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `StorageProvider`    | Local disk (F070), S3-compatible (F065) | —                      | —                                              | Azure Blob (F080), AWS S3 (F090), GCP (F093)        |
| `EmailProvider`      | SMTP (F059)                             | Resend, SendGrid       | —                                              | Azure Comms (F086), AWS SES (F091)                  |
| `AuthSSOProvider`    | Built-in (email + password)             | OIDC/OAuth2 (F072)     | LDAP (F073), SAML (F140)                       | Azure Entra (F081)                                  |
| `MonitoringProvider` | Stdout logging                          | OpenTelemetry (F071)   | —                                              | Azure Insights (F085)                               |
| `CDNProvider`        | Direct serve (no CDN)                   | —                      | —                                              | Azure CDN (F083), CloudFront (F092), GCP CDN (F094) |
| `JobProvider`        | BullMQ + Redis (F100)                   | In-process fallback    | —                                              | —                                                   |
| `CacheProvider`      | Redis (F103)                            | In-memory LRU fallback | —                                              | —                                                   |
| `PreviewProvider`    | LibreOffice headless / Gotenberg (F101) | —                      | —                                              | —                                                   |
| `ScanProvider`       | None (skip)                             | ClamAV (F107)          | —                                              | —                                                   |
| `EncryptionProvider` | AES-256 file-level (F120)               | —                      | —                                              | Azure Key Vault (F082)                              |
| `SearchProvider`     | PostgreSQL FTS (F011)                   | Meilisearch            | OpenSearch/Elasticsearch                       | —                                                   |
| `AIProvider`         | None                                    | —                      | OpenAI, Anthropic, local LLM (F074-F079, F132) | Azure OpenAI                                        |
| `SignatureProvider`  | None                                    | —                      | Built-in (F045), DocuSign (F048)               | —                                                   |

---

## MVP Feature IDs (Quick Reference)

**Platform Foundation:** F100, F101, F102, F103, F104, F105, F106, F107, F141, F142, F143

**Core:** F001, F002, F003, F004, F005, F108

**Document Management:** F006, F007, F008, F009, F010, F014, F110, F114

**Access Control:** F016, F017, F019, F020, F025, F116

**Analytics:** F121

**Viewer Experience:** F033, F034, F035, F124

**Administration:** F039, F040, F043, F044, F128, F130

**Compliance:** F052

**Integration:** F059

**Deployment:** F062, F063, F064, F065, F066, F068, F070, F137

**Project Governance:** F146, F147, F148, F149

(56 features)

---

## Critical Dependency Chains

These are the longest dependency paths that determine build order within each priority tier.

### MVP Build Order

**Layer 0 - Zero dependencies (build first):**
F004 (Roles), F008 (Viewer shell), F017 (Passwords), F059 (Email), F062 (Docker), F064 (PostgreSQL), F065 (S3-compat storage), F146 (CONTRIBUTING.md), F147 (SECURITY.md), F148 (ARCHITECTURE.md), F149 (CODE_OF_CONDUCT.md)

**Layer 1 - Infrastructure primitives:**
F063 (Env config) ← F062
F066 (Reverse proxy) ← F062
F068 (DB migrations) ← F064
F070 (Local storage) ← F065
F100 (Job queue) ← F062
F102 (Event bus) ← F064
F103 (Cache) ← F062
F141 (Permission engine) ← F004
F142 (Multi-tenant model) ← F064

**Layer 2 - Core document pipeline:**
F006 (Upload) ← F065
F101 (Preview pipeline) ← F100, F065
F104 (Rate limiting) ← F103
F105 (Sessions) ← F004, F103
F020 (Groups) ← F004
F137 (Backup/restore) ← F064, F065, F100

**Layer 3 - Document features:**
F010 (Indexing) ← F006
F106 (File hashing) ← F006
F107 (Virus scanning) ← F006, F100
F110 (Tagging) ← F010
F114 (Trash) ← F006, F025
F009 (Multi-format) ← F008, F101
F007 (Drag-drop) ← F006

**Layer 4 - Access and audit:**
F002 (Version control) ← F006, F010, F106
F005 (ACLs) ← F004, F010, F020, F141
F025 (Audit trail) ← F004, F102
F016 (Email verify) ← F059
F019 (Permission levels) ← F004, F020
F116 (Link permissions) ← F005, F017
F108 (Room lifecycle) ← F004

**Layer 5 - User-facing:**
F001 (Custom domain) ← F066
F003 (Notifications) ← F059, F043, F102
F014 (Download control) ← F005
F033 (Branded viewer) ← F001
F034 (Mobile responsive) ← F008
F035 (Link-based access) ← F016, F017
F039 (Multi-admin) ← F004
F121 (Activity dashboard) ← F025
F124 (Breadcrumbs) ← F010
F130 (Room settings) ← F108

**Layer 6 - Admin features and onboarding:**
F040 (Admin log) ← F025, F039
F043 (Notif prefs) ← F039
F044 (Team invite) ← F004, F039
F052 (GDPR) ← F006, F025, F114
F128 (Setup wizard) ← F062, F063
F143 (Demo seed data) ← F128, F109

### V1 Critical Paths

**Analytics:** F025 → F027 → F028 → F031 (reports), F029 (heatmaps)
**Compliance:** F016 → F018 (NDA) → F055 (timestamped NDA) → F133 (compliance export)
**Document chain:** F002 → F112 (diff), F013 (replace)
**API chain:** F057 → F061 (OpenAPI), F058 (webhooks), F135 (API keys)
**Search:** F011 → full-text search via SearchProvider
**Checklists:** F110 → F123 (due diligence tracking)
**Bulk ops:** F144 (bulk move/tag/delete/permissions)

### V2 Critical Paths

**E-signatures:** F045 → F046 → F050 (counter-sig), F047 (tamper-evident), F049 (audit)
**AI:** F074 (categorization) → F075 (summarization) → F076 (semantic search), F079 (Q&A)
**Redaction:** F145 (redaction tool) → F078 (AI redaction detection)

---

## Changes from v3

### License Change

Switched from BSL 1.1 to AGPLv3 per Enhancement Proposal recommendation. AGPLv3 is a true open-source license that prevents closed SaaS forks while allowing full internal use, modification, and redistribution. Commercial strategy: hosted SaaS, enterprise support, and clearly separated enterprise add-ons.

### Positioning Expansion

DataRoomPlus is no longer positioned solely as an investor data room. Use cases now include M&A due diligence, legal discovery, board portals, compliance document sharing, vendor/partner exchange, and internal confidential libraries. This is reflected in new features for room templates (F109), due diligence checklists (F123), room lifecycle management (F108), and document tagging taxonomies (F110).

### New Platform Foundation Category (8 features)

Added critical infrastructure primitives that were implicit but missing from v3:

- F100: Background job queue (JobProvider)
- F101: Document preview/conversion pipeline (PreviewProvider)
- F102: Internal event bus (EventBus)
- F103: Cache layer (CacheProvider)
- F104: Rate limiting
- F105: Session management
- F106: File integrity verification (hashing)
- F107: Virus/malware scanning (V1)

### New Features Added (28 total new features)

- **Platform Foundation:** F100-F107 (8 features)
- **Core:** F108 room lifecycle, F109 room templates
- **Document Management:** F110 tagging, F111 reordering, F112 diff, F113 ZIP export, F114 trash, F115 annotations
- **Access Control:** F116 granular links, F117 bulk viewer management, F118 access requests, F119 device fingerprinting, F120 encryption at rest
- **Analytics:** F121 room dashboard, F122 digest emails, F123 due diligence checklists
- **Viewer:** F124 breadcrumbs, F125 bookmarks, F126 i18n, F127 accessibility
- **Administration:** F128 setup wizard, F129 multi-room dashboard, F130 room settings, F131 CSV import/export
- **AI:** F132 OCR
- **Compliance:** F133 compliance export, F134 chain of custody
- **Integration:** F135 API keys, F136 embeddable widget
- **Deployment:** F137 backup/restore, F138 Helm chart, F139 horizontal scaling docs
- **SSO:** F140 SAML 2.0

### Priority Adjustments

- F058 (Webhooks) moved from V2 to V1. Built on EventBus, critical for integrations.
- F068 (DB migrations) promoted from V1 to MVP. Essential for safe upgrades.
- F065 (S3 storage) dependency on F006 removed. Interface defined independently.

### Architecture Alignment

Per Enhancement Proposal recommendation #5, the architecture now prioritizes:

1. **Auditability** - EventBus (F102) as foundation. Every action emits events. Audit trail (F025) consumes events. Compliance exports (F133, F134) built on audit data.
2. **Permissions** - Layered: roles (F004) → groups (F020) → per-doc ACLs (F005) → link-level (F116). All permission checks unified.
3. **Previews** - PreviewProvider (F101) as first-class pipeline. All document viewing goes through conversion. Enables watermarking, page tracking, and screenshot protection.
4. **Jobs** - JobProvider (F100) handles all async work: document processing, email dispatch, scheduled cleanup, report generation, virus scanning.

### Interface Expansion

Generic interface table expanded from 7 to 13 interfaces:

- Added: JobProvider, CacheProvider, PreviewProvider, ScanProvider, EncryptionProvider, SearchProvider

### Total Feature Count

87 features (v3) → 133 features (v4). Net addition of 46 features plus priority adjustments.

---

## v4 Revision (Assessment Integration)

Changes made based on external assessment review:

### Architecture Enhancements

- **F141 (PermissionEngine)** added as MVP Platform Foundation. Centralized permission evaluation: canUserAccessDocument(user, document, action). Prevents permission logic duplication. All access checks route through this single module.
- **F142 (Multi-tenant org model)** added as MVP Platform Foundation. organization_id on every entity from day one. Prevents painful schema migration if SaaS offering is pursued later.
- **F143 (Demo seed data)** added as MVP. Sample room with folder structure and documents created on first-run. Users see a working data room immediately after docker compose up.
- **SearchProvider** interface added. PostgreSQL FTS (MVP default) → Meilisearch (V1) → OpenSearch/Elasticsearch (V2). F011 updated to Generic adapter type.

### Priority Promotions

- **F107** (virus/malware scanning) promoted from V1 to MVP. Security is a trust fundamental.
- **F137** (backup/restore) promoted from V1 to MVP. Admins will not deploy a data room without backup capability.

### New Features

- **F144** (bulk document operations) added at V1. Bulk move, tag, delete, permissions. Essential admin productivity for large rooms.
- **F145** (document redaction tool) added at V2. Admin redacts sensitive content before sharing. Original preserved. Critical for legal/M&A use cases.
- **F146-F149** (governance docs) added as MVP. CONTRIBUTING.md, SECURITY.md, ARCHITECTURE.md, CODE_OF_CONDUCT.md. Required for credible open-source project from day one.
- **F150-F151** (ROADMAP.md, RFC process) added at V1. Community governance framework.

### Existing Feature Enrichment

- **F100** (job queue): Added job classification system (high/normal/low/scheduled priorities)
- **F101** (preview pipeline): Expanded to multi-stage pipeline: scan → convert → extract text → generate thumbnails → index metadata. Watermark overlay at render time, not baked.
- **F102** (event bus): Documented event schema: event_id, event_type, timestamp, actor_id, actor_type, organization_id, room_id, document_id, metadata_json, ip_address, user_agent
- **F002** (version control): Hash chain strengthened (each version's hash includes parent hash for legal defensibility)
- **F005** (ACLs): Now routes through PermissionEngine (F141)
- **F023** (watermarking): Enhanced with configurable overlay fields (name, email, IP, timestamp, room name, custom text) and placement options
- **F011** (search): Changed to Generic adapter type with SearchProvider interface
