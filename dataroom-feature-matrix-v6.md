# VaultSpace - Feature Priority Matrix v6

## Project Metadata

| Field                     | Value                                                                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project Name**          | VaultSpace                                                                                                                                                                                                                                            |
| **License**               | AGPLv3 (GNU Affero General Public License v3)                                                                                                                                                                                                         |
| **Commercial Strategy**   | Core server is AGPLv3. Optional commercial offerings: hosted SaaS, enterprise support/SLA, and clearly separated enterprise-only add-ons. Anyone may self-host, modify, and use internally. Modified hosted versions must publish source under AGPL.  |
| **Tech Stack**            | Next.js 14+ (App Router), TypeScript, React 18+, Prisma ORM, PostgreSQL 15+, TailwindCSS, Redis (optional, for jobs/cache)                                                                                                                            |
| **Target Scale**          | Small (< 50 users, < 10K documents) for initial deployment. Architecture must support horizontal scaling without rewrites.                                                                                                                            |
| **Tenancy Model**         | Multi-tenant from day one. Every database entity includes organization_id. Single-org self-hosted installs have one default organization. Enables future hosted SaaS without schema migration.                                                        |
| **MVP UI**                | Full admin web UI and branded viewer UI included in MVP. No API-only phase.                                                                                                                                                                           |
| **Positioning**           | General-purpose secure document room platform. Use cases include investor data rooms, M&A due diligence, legal discovery, board portals, compliance document sharing, vendor/partner document exchange, and internal confidential document libraries. |
| **Document Object Model** | Document → DocumentVersion → FileBlob + PreviewAsset + ExtractedText + Hash. Each version is an immutable snapshot. Originals stored as-is; previews generated asynchronously. Defined in DATABASE_SCHEMA.md (F152).                                  |
| **Repository**            | TBD (GitHub public repo)                                                                                                                                                                                                                              |

---

## Priority Levels

- **MVP** - Functional, deployable, self-hostable secure data room with admin UI, viewer experience, and complete design documentation
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

| ID   | Feature                                      | Priority | Adapter Type | Depends On             | Compliance              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | -------------------------------------------- | -------- | ------------ | ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F100 | Background job queue                         | MVP      | Generic      | F062                   | —                       | JobProvider interface. Default: BullMQ + Redis. Fallback: in-process queue for small installs. Job classification: High (preview generation, virus scan), Normal (email dispatch, notifications), Low (analytics aggregation, report generation), Scheduled (retention cleanup, expiry checks). Supports 4 dedicated worker types: general (email, notifications, search indexing), preview (conversion, OCR), scan (virus scanning), report (exports, analytics).                                                                                   |
| F101 | Document preview/conversion pipeline         | MVP      | Generic      | F100, F065             | CC7.1                   | PreviewProvider interface. Multi-stage pipeline, each stage a job: (1) Scan via ScanProvider, (2) Convert to PDF via LibreOffice headless/Gotenberg, (3) Extract text for search index, (4) Generate page thumbnails, (5) Index metadata. Watermark overlay applied at render time, not baked into stored preview. Supports multiple preview workers and job concurrency control for scaling.                                                                                                                                                        |
| F102 | Internal event bus                           | MVP      | Core         | F064                   | CC7.2, HIPAA-164.312(b) | EventBus system. All state changes emit events. Database-backed event log. Event schema: event_id, event_type, timestamp, actor_id, actor_type (admin/viewer/system), organization_id, room_id, document_id (nullable), request_id, session_id, metadata_json, ip_address, user_agent. request_id and session_id enable grouping events across a single request for debugging and security forensics. Event table should use PostgreSQL time-based partitioning (monthly) from day one. Retention and archival policy configurable per organization. |
| F103 | Cache layer                                  | MVP      | Generic      | F062                   | —                       | CacheProvider interface. Default: Redis. Fallback: in-memory LRU. Used for session data, preview cache, rate limiting, and frequently accessed metadata.                                                                                                                                                                                                                                                                                                                                                                                             |
| F104 | Rate limiting and abuse prevention           | MVP      | Core         | F103                   | CC7.2                   | Per-IP and per-user rate limits on API and viewer endpoints. Prevents brute-force attacks on password-protected rooms.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F105 | Session management                           | MVP      | Core         | F004, F103             | HIPAA-164.312(d)        | Secure session handling for admin and viewer sessions. Configurable session duration. Force logout capability.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F106 | File integrity verification (hash on upload) | MVP      | Core         | F006                   | CC7.1                   | SHA-256 hash computed and stored on every upload. Enables tamper detection across versions.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F107 | Virus/malware scanning on upload             | MVP      | Generic      | F006, F100             | CC7.1                   | ScanProvider interface. Default: ClamAV. Scans uploaded files as background job before making available to viewers. Quarantine flow for flagged files. Security is a trust fundamental.                                                                                                                                                                                                                                                                                                                                                              |
| F141 | Centralized permission engine                | MVP      | Core         | F004                   | CC6.1, HIPAA-164.312(a) | Single module evaluates all access decisions: canUserAccessDocument(user, document, action). Actions: view, download, print, share, comment, sign. Consumes roles (F004), groups (F020), per-doc ACLs (F005), link-level permissions (F116), IP rules (F021), time limits (F022). Includes explainPermission(user, document, action) that returns human-readable reasoning chain (e.g., "Allowed: user in group 'Investors', group has read on folder, no ACL override"). Prevents permission logic duplication across codebase.                     |
| F142 | Multi-tenant organization model              | MVP      | Core         | F064                   | CC6.1                   | Every database entity includes organization_id. Default org created on first-run. Enables future multi-org hosting. Tenant isolation enforced at query layer via Prisma middleware or row-level security.                                                                                                                                                                                                                                                                                                                                            |
| F143 | Demo seed data and sample room               | MVP      | Core         | F128, F006, F108, F109 | —                       | Pre-populated 'Series A Funding Room' with sample documents (term sheet, cap table, financials, board minutes), folder structure, viewer permissions (NDA gate is V1; MVP seed data omits NDA configuration), and simulated activity history. Docker Compose demo launches with this room ready for exploration. First-run setup wizard optionally installs a demo data room with sample folder structure (using room template), placeholder documents, and viewer accounts. Lets users experience the platform immediately after docker compose up. |

### Core Features

| ID   | Feature                                                     | Priority | Adapter Type | Depends On             | Compliance              | Notes                                                                                                                                                                                                                                                                             |
| ---- | ----------------------------------------------------------- | -------- | ------------ | ---------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F001 | Custom domain support                                       | MVP      | Core         | F066                   | —                       | Reverse proxy config (Nginx/Caddy)                                                                                                                                                                                                                                                |
| F002 | Document version control with revision history              | MVP      | Core         | F006, F010, F106       | CC7.1                   | Track all revisions per document. Hash chain across versions (each version's hash includes parent hash) for legal defensibility and tamper detection. Each version stored as immutable DocumentVersion with linked FileBlob and PreviewAsset.                                     |
| F003 | Email notifications on document view/update                 | MVP      | Generic      | F059, F043, F102       | —                       | Triggered by EventBus. Uses EmailProvider interface.                                                                                                                                                                                                                              |
| F004 | Role separation: admin vs. viewer                           | MVP      | Core         | —                      | CC6.1, HIPAA-164.312(a) | Foundation for all access control. No dependencies.                                                                                                                                                                                                                               |
| F005 | Per-document and per-folder access controls                 | MVP      | Core         | F004, F010, F020, F141 | CC6.1, HIPAA-164.312(a) | Granular permissions on folders and files. Evaluated via centralized PermissionEngine (F141).                                                                                                                                                                                     |
| F108 | Room lifecycle management (draft, active, archived, closed) | MVP      | Core         | F004                   | —                       | Rooms have states. Archived rooms are read-only. Closed rooms deny all viewer access.                                                                                                                                                                                             |
| F109 | Room templates (M&A, investor, board, compliance, custom)   | MVP      | Core         | F108, F006             | —                       | **Promoted from V1.** Pre-built folder structures, permission defaults, and checklists per use case. Users can create custom templates from existing rooms. Dramatically improves first-run usability. Ships with default templates for investor data room and M&A due diligence. |

### Document Management

| ID   | Feature                                                   | Priority | Adapter Type | Depends On             | Compliance | Notes                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------- | -------- | ------------ | ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F006 | Bulk upload with folder structure preservation            | MVP      | Core         | F065                   | —          | Uses StorageProvider interface                                                                                                                                                                                                                                                                                                                                                                                                  |
| F007 | Drag-and-drop upload                                      | MVP      | Core         | F006                   | —          | Frontend enhancement to upload flow                                                                                                                                                                                                                                                                                                                                                                                             |
| F008 | In-browser document viewer (no download required)         | MVP      | Core         | F101                   | —          | Renders preview PDFs generated by conversion pipeline. Not limited to PDF uploads.                                                                                                                                                                                                                                                                                                                                              |
| F009 | Multi-format support (PDF, DOCX, XLSX, PPTX, images)      | MVP      | Core         | F008, F101             | —          | Conversion pipeline handles all formats. Original files stored as-is.                                                                                                                                                                                                                                                                                                                                                           |
| F010 | Document indexing and auto-numbering                      | MVP      | Core         | F006                   | —          | Foundation for version control and search. Bates-style numbering option.                                                                                                                                                                                                                                                                                                                                                        |
| F011 | Full-text search across documents                         | V1       | Generic      | F006, F009, F010, F100 | —          | SearchProvider interface. V1 ships with PostgreSQL FTS as default engine (no external dependency). Later alternatives: Meilisearch (V1 adapter), OpenSearch/Elasticsearch (V2 adapter). Backed by SearchIndex model (document_id, version_id, organization_id, extracted_text, metadata, vector_embedding nullable). Allows search engine swaps without reprocessing documents. Text extraction runs as pipeline stage in F101. |
| F012 | Document expiry dates                                     | V1       | Core         | F005, F100             | CC6.3      | Background job checks and auto-revokes access after date                                                                                                                                                                                                                                                                                                                                                                        |
| F013 | Replace document without changing share link              | V1       | Core         | F002, F006             | —          | Stable URLs across versions                                                                                                                                                                                                                                                                                                                                                                                                     |
| F014 | Download enable/disable per document                      | MVP      | Core         | F005                   | CC6.1      | Per-document permission flag                                                                                                                                                                                                                                                                                                                                                                                                    |
| F015 | Print enable/disable per document                         | V1       | Core         | F005, F008             | CC6.1      | Per-document permission flag                                                                                                                                                                                                                                                                                                                                                                                                    |
| F110 | Document tagging and custom metadata                      | MVP      | Core         | F010                   | —          | Admin-defined tags and key-value metadata on documents. Filterable in UI. Supports use-case-specific taxonomies (financial, legal, technical, HR, etc.).                                                                                                                                                                                                                                                                        |
| F111 | Folder and document drag-and-drop reordering              | V1       | Core         | F010                   | —          | Rearrange folder hierarchy and document order within folders via drag-and-drop in admin UI.                                                                                                                                                                                                                                                                                                                                     |
| F112 | Document comparison (diff between versions)               | V1       | Core         | F002, F101             | —          | Visual side-by-side or overlay diff of two document versions. Text-based diff for supported formats.                                                                                                                                                                                                                                                                                                                            |
| F113 | Archive/export entire room as ZIP                         | MVP      | Core         | F006, F100, F108       | —          | **Promoted from V1.** Background job packages all room documents with folder structure into downloadable ZIP. Includes index manifest. Admins frequently need to download entire rooms.                                                                                                                                                                                                                                         |
| F114 | Trash/soft delete with recovery                           | MVP      | Core         | F006, F025             | CC6.3      | Deleted documents go to trash for configurable period before permanent removal. Admin can restore. Audit logged.                                                                                                                                                                                                                                                                                                                |
| F115 | Document annotations and comments (admin-side)            | V1       | Core         | F008, F004             | —          | Admins can add internal annotations to documents visible only to other admins. Not exposed to viewers.                                                                                                                                                                                                                                                                                                                          |
| F144 | Bulk document operations (move, tag, delete, permissions) | V1       | Core         | F005, F010, F110, F114 | —          | Select multiple documents/folders and apply actions in batch: move to folder, apply tags, set permissions, soft delete. Essential admin productivity for large rooms.                                                                                                                                                                                                                                                           |
| F156 | Document binder/index export (PDF)                        | V1       | Core         | F006, F101, F100       | —          | **NEW.** Export room as numbered PDF binder with table of contents, section dividers, and Bates-stamped pages. Critical for M&A data rooms where buyers need a single indexed document package. Background job generates binder.                                                                                                                                                                                                |

### Access Control & Security

| ID   | Feature                                                             | Priority | Adapter Type | Depends On       | Compliance              | Notes                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------- | -------- | ------------ | ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F016 | Email verification before access                                    | MVP      | Generic      | F059             | HIPAA-164.312(d)        | Uses EmailProvider interface                                                                                                                                                                                                                                                                      |
| F017 | Password-protected rooms and links                                  | MVP      | Core         | F104             | HIPAA-164.312(d)        | Room-level and link-level passwords. Rate limited against brute force.                                                                                                                                                                                                                            |
| F018 | NDA/agreement gate before room access                               | V1       | Core         | F016             | —                       | Must verify email before presenting NDA                                                                                                                                                                                                                                                           |
| F019 | Per-user and per-group permission levels                            | MVP      | Core         | F004, F020       | CC6.1, HIPAA-164.312(a) | View, download, print granularity                                                                                                                                                                                                                                                                 |
| F020 | User group management                                               | MVP      | Core         | F004             | CC6.1                   | Create/manage groups for batch permissions                                                                                                                                                                                                                                                        |
| F021 | IP allowlist/blocklist                                              | V1       | Core         | F004             | CC6.1                   | Standard security feature                                                                                                                                                                                                                                                                         |
| F022 | Time-limited access with auto-revocation                            | V1       | Core         | F005, F019, F100 | CC6.3                   | Background job revokes access on expiry                                                                                                                                                                                                                                                           |
| F023 | Dynamic watermarking (viewer email/IP on pages)                     | V1       | Core         | F008, F016       | —                       | Overlay per page at render time (not baked into stored preview). Configurable fields: viewer name, email, IP address, timestamp, room name, custom text. Diagonal and margin placement options. Applied via PreviewProvider render path.                                                          |
| F024 | Screenshot protection                                               | V2       | Core         | F008             | —                       | CSS/JS-based deterrent (not foolproof)                                                                                                                                                                                                                                                            |
| F025 | Audit trail of all user activity                                    | MVP      | Core         | F004, F102       | CC7.2, HIPAA-164.312(b) | Built on EventBus. Every action recorded with actor, timestamp, IP, user-agent. Immutable log.                                                                                                                                                                                                    |
| F026 | Two-factor authentication for admin users                           | V1       | Core         | F004             | HIPAA-164.312(d)        | TOTP-based 2FA                                                                                                                                                                                                                                                                                    |
| F116 | Granular link permissions (per-link expiry, password, access scope) | MVP      | Core         | F005, F017       | CC6.1, CC6.3            | Each share link can have independent expiry, password, and document scope. Multiple links per room with different access levels.                                                                                                                                                                  |
| F117 | Viewer invitation management (invite, remind, revoke in batch)      | V1       | Core         | F016, F019, F059 | CC6.3                   | Bulk invite viewers via CSV or email list. Batch send reminders. Bulk revoke access.                                                                                                                                                                                                              |
| F118 | Access request workflow                                             | V1       | Core         | F016, F044       | CC6.1                   | Uninvited users can request access. Admin approves/denies. Email notification on request.                                                                                                                                                                                                         |
| F119 | Device and browser fingerprinting for sessions                      | V2       | Core         | F025, F105       | CC7.2                   | Track which devices accessed the room. Alert on new/unknown devices.                                                                                                                                                                                                                              |
| F120 | Encryption at rest (document-level)                                 | V1       | Generic      | F065, F106       | CC6.1, HIPAA-164.312(c) | EncryptionProvider interface. MVP ships NoOpEncryptionProvider (no application-level encryption; relies on filesystem/cloud-provider encryption). V1 adds AES-256-GCM with key from environment variable. V1+: external KMS adapters (HashiCorp Vault, cloud KMS). Key rotation support required. |
| F145 | Document redaction tool                                             | V2       | Core         | F008, F101, F025 | —                       | Admin can redact sensitive information (draw redaction boxes over content) before sharing with viewers. Redacted version stored separately; original preserved with admin-only access. Audit-logged. Critical for legal and M&A use cases.                                                        |

### Analytics & Reporting

| ID   | Feature                                       | Priority | Adapter Type | Depends On       | Compliance   | Notes                                                                                                                                                                             |
| ---- | --------------------------------------------- | -------- | ------------ | ---------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F027 | Page-level engagement tracking                | V1       | Core         | F008, F025       | —            | Time per page, scroll depth                                                                                                                                                       |
| F028 | Per-viewer activity dashboard                 | V1       | Core         | F025, F027       | —            | Admin view of individual viewer activity                                                                                                                                          |
| F029 | Document view heatmaps                        | V2       | Core         | F027, F028       | —            | Visual representation of engagement                                                                                                                                               |
| F030 | Real-time notification on viewer open/revisit | V1       | Generic      | F003, F025       | —            | Push or email alert to admins                                                                                                                                                     |
| F031 | Exportable activity reports (CSV/PDF)         | V1       | Core         | F025, F028, F100 | —            | Background job generates reports                                                                                                                                                  |
| F032 | Aggregate vs. individual viewer analytics     | V2       | Core         | F027, F028       | —            | Compare cohort behavior                                                                                                                                                           |
| F121 | Room activity summary dashboard               | MVP      | Core         | F025             | CC7.2, CC7.3 | Basic MVP analytics: total views, unique viewers, most viewed documents, recent activity. Visible on room admin page.                                                             |
| F122 | Activity digest emails (daily/weekly)         | V1       | Generic      | F025, F059, F100 | —            | Scheduled background job sends admin summary of room activity. Configurable frequency per admin.                                                                                  |
| F123 | Due diligence checklist tracking              | V1       | Core         | F110, F108       | —            | Define checklist items per room. Track which documents satisfy which checklist items. Progress percentage visible to admins and optionally to viewers. Critical for M&A use case. |

### Viewer Experience

| ID   | Feature                                      | Priority | Adapter Type | Depends On | Compliance | Notes                                                                                                                                                                |
| ---- | -------------------------------------------- | -------- | ------------ | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F033 | Branded viewer with no third-party branding  | MVP      | Core         | F001       | —          | White-label experience. Custom logo, colors, favicon.                                                                                                                |
| F034 | Mobile-responsive document viewer            | MVP      | Core         | F008       | —          | Touch-friendly, responsive layout                                                                                                                                    |
| F035 | No account required for viewers (link-based) | MVP      | Core         | F016, F017 | —          | Email verification without account creation                                                                                                                          |
| F036 | Optional viewer login portal                 | V1       | Core         | F035, F019 | —          | Persistent access for repeat visitors                                                                                                                                |
| F037 | Q&A module (viewer questions routed to team) | V2       | Core         | F036, F059 | —          | In-room communication channel                                                                                                                                        |
| F038 | Document request tracking                    | V2       | Core         | F037       | —          | Viewers can request missing documents                                                                                                                                |
| F124 | Breadcrumb navigation in folder hierarchy    | MVP      | Core         | F010       | —          | Viewers see folder path and can navigate up. Essential for rooms with deep folder structures.                                                                        |
| F125 | Viewer-side document bookmarking             | V1       | Core         | F036       | —          | Logged-in viewers can bookmark documents for quick access. Stored server-side.                                                                                       |
| F126 | Multi-language UI (i18n framework)           | V1       | Core         | —          | —          | UI strings externalized for translation. Ship with English. Community can contribute translations. Framework must be in place even if only one language ships in V1. |
| F127 | Accessibility compliance (WCAG 2.1 AA)       | V1       | Core         | F008, F034 | —          | Keyboard navigation, screen reader support, sufficient contrast, ARIA labels. Applies to both admin and viewer UIs.                                                  |

### Administration

| ID   | Feature                                      | Priority | Adapter Type | Depends On       | Compliance | Notes                                                                                                                         |
| ---- | -------------------------------------------- | -------- | ------------ | ---------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| F039 | Multi-admin support                          | MVP      | Core         | F004             | —          | Multiple admin users per deployment                                                                                           |
| F040 | Admin activity log                           | MVP      | Core         | F025, F039       | CC7.2      | What admins changed and when                                                                                                  |
| F041 | Room duplication (clone for new deal)        | V1       | Core         | F005, F006, F108 | —          | Copy room structure, permissions, docs                                                                                        |
| F042 | Multiple simultaneous data rooms             | V1       | Core         | F004, F005, F108 | —          | Isolated rooms with separate access                                                                                           |
| F043 | Notification preferences per admin user      | MVP      | Core         | F039             | —          | Per-admin email/alert settings                                                                                                |
| F044 | Team member invite and role assignment       | MVP      | Core         | F004, F039       | —          | Invite via email, assign admin/viewer role                                                                                    |
| F128 | Admin setup wizard (first-run configuration) | MVP      | Core         | F062, F063       | —          | Guided setup on first deployment: create admin account, configure email, set organization name/logo, test storage connection. |
| F129 | Multi-room admin dashboard                   | V1       | Core         | F042, F121       | —          | Overview of all rooms with status, activity, and alerts. Quick access to any room.                                            |
| F130 | Configurable room-level settings             | MVP      | Core         | F108             | —          | Per-room configuration: allow downloads, require NDA, enable watermark, set default expiry. Distinct from global settings.    |
| F131 | Bulk viewer management (CSV import/export)   | V1       | Core         | F117             | —          | Import viewer lists from CSV. Export current viewer list with access status.                                                  |

### E-Signatures

| ID   | Feature                                             | Priority | Adapter Type | Depends On       | Compliance | Notes                                                          |
| ---- | --------------------------------------------------- | -------- | ------------ | ---------------- | ---------- | -------------------------------------------------------------- |
| F045 | Built-in basic e-signature (draw/type signature)    | V2       | Core         | F008, F016, F025 | —          | Simple signature capture on documents                          |
| F046 | Signature request workflow (request, remind, track) | V2       | Core         | F045, F059       | —          | Admin sends signature requests to viewers                      |
| F047 | Signed document storage with tamper-evident hash    | V2       | Core         | F045, F002, F106 | —          | Immutable record of signed version. Chain of custody via hash. |
| F048 | DocuSign integration adapter                        | V2       | Generic      | F045, F057       | —          | External e-signature provider via API                          |
| F049 | Signature audit trail with timestamps               | V2       | Core         | F045, F025       | —          | Who signed what and when                                       |
| F050 | Counter-signature support (multi-party signing)     | V2       | Core         | F046             | —          | Multiple signers in sequence or parallel                       |
| F051 | Signature status dashboard                          | V2       | Core         | F046, F028       | —          | Track pending, completed, expired signatures                   |

### AI Features

| ID   | Feature                                         | Priority | Adapter Type | Depends On       | Compliance | Notes                                                                                                                    |
| ---- | ----------------------------------------------- | -------- | ------------ | ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| F074 | AI document auto-categorization on upload       | V2       | Generic      | F006, F010, F100 | —          | Uses AIProvider interface. Classify by type (financial, legal, etc.). Runs as background job.                            |
| F075 | AI document summarization                       | V2       | Generic      | F009, F011       | —          | Generate summaries for admin review                                                                                      |
| F076 | AI-powered semantic search                      | V2       | Generic      | F011, F074       | —          | Natural language search across all documents. Vector embeddings stored in SearchIndex alongside text.                    |
| F077 | AI-suggested access permissions                 | V2       | Generic      | F005, F074       | —          | Recommend permissions based on doc type and past patterns                                                                |
| F078 | AI redaction detection (flag sensitive content) | V2       | Generic      | F009, F074       | —          | Identify PII, financial data, or confidential markers                                                                    |
| F079 | AI Q&A assistant for viewers                    | V2       | Generic      | F037, F075       | —          | Viewers ask questions, AI answers from room docs                                                                         |
| F132 | Basic OCR for scanned documents (Tesseract)     | MVP      | Generic      | F101             | CC7.1      | Basic OCR via Tesseract for scanned documents. Enables full-text search on image-based PDFs. Advanced AI OCR remains V2. |

### Compliance & Legal

| ID   | Feature                                            | Priority | Adapter Type | Depends On       | Compliance | Notes                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------- | -------- | ------------ | ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F052 | GDPR-compliant data handling and deletion          | MVP      | Core         | F006, F025, F114 | CC9.1      | Right to erasure, data export. Trash/soft delete supports recovery period.                                                                                                                                                                                                                                      |
| F053 | Data residency selection (EU, US, etc.)            | V2       | Generic      | F065             | —          | Storage region configuration                                                                                                                                                                                                                                                                                    |
| F054 | SOC 2 aligned audit logging                        | V2       | Core         | F025, F040       | CC7.2      | Structured logs meeting SOC 2 requirements                                                                                                                                                                                                                                                                      |
| F055 | Legally timestamped NDA acceptance records         | V1       | Core         | F018             | —          | Cryptographic timestamp on acceptance                                                                                                                                                                                                                                                                           |
| F056 | Configurable data retention policies               | V2       | Core         | F052, F100       | —          | Background job enforces auto-delete after configurable period                                                                                                                                                                                                                                                   |
| F133 | Export compliance package (audit bundle)           | V1       | Core         | F025, F040, F100 | CC7.2      | Export complete audit trail, NDA records, access logs, and document manifest as a signed compliance package. For legal and regulatory submissions.                                                                                                                                                              |
| F134 | Chain of custody report per document               | V1       | Core         | F002, F025, F106 | CC7.1      | Full history of a document: upload, every version, every viewer, every download, hash verification. Exportable.                                                                                                                                                                                                 |
| F157 | Legal hold (prevent deletion during investigation) | V1       | Core         | F114, F025, F108 | —          | **NEW.** Admin places a legal hold on a room or specific documents. Prevents soft delete, hard delete, and retention policy execution on held items. Audit logged. Required for litigation and regulatory compliance. Hold can be applied to individual documents or entire rooms.                              |
| F158 | External organization/participant model            | V1       | Core         | F020, F142       | —          | **NEW.** Viewers can be grouped by external organization (e.g., "Goldman Sachs", "PwC"). Permissions can be set per-organization. Activity reports grouped by firm. Enables multi-party deal rooms where each firm sees only their authorized documents. Extends group model (F020) with organization metadata. |

### Integration & API

| ID   | Feature                                          | Priority | Adapter Type | Depends On       | Compliance | Notes                                                                                        |
| ---- | ------------------------------------------------ | -------- | ------------ | ---------------- | ---------- | -------------------------------------------------------------------------------------------- |
| F057 | REST API for room/document management            | V1       | Core         | F004, F005, F006 | —          | Programmatic access to all core functions                                                    |
| F058 | Webhook support for external event notifications | V1       | Generic      | F057, F102       | —          | HTTP callbacks on room/doc/user events. Built on EventBus. Critical for integrations.        |
| F059 | SMTP-agnostic email (any provider)               | MVP      | Generic      | —                | —          | EmailProvider interface. Default: SMTP                                                       |
| F060 | Slack/Teams notification integration             | V2       | Generic      | F058             | —          | Webhook-based channel notifications                                                          |
| F061 | OpenAPI/Swagger specification                    | V1       | Core         | F057             | —          | Auto-generated API docs                                                                      |
| F135 | API key management (per-admin, per-integration)  | V1       | Core         | F057, F004       | —          | Create, rotate, and revoke API keys. Scoped permissions per key. Audit log of API key usage. |
| F136 | Embeddable viewer widget (iframe)                | V2       | Core         | F008, F057       | —          | Embed document viewer into external websites via iframe with token-based auth.               |

### Deployment & Self-Hosting

| ID   | Feature                                          | Priority | Adapter Type | Depends On       | Compliance | Notes                                                                                                                                |
| ---- | ------------------------------------------------ | -------- | ------------ | ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| F062 | Docker Compose single-command deployment         | MVP      | Core         | —                | —          | Primary deployment method. Includes app, PostgreSQL, Redis.                                                                          |
| F063 | Environment variable-based configuration         | MVP      | Core         | F062             | —          | All config via .env, no code changes                                                                                                 |
| F064 | PostgreSQL database support                      | MVP      | Generic      | —                | —          | Primary database via Prisma ORM                                                                                                      |
| F065 | S3-compatible storage (AWS S3, MinIO, Backblaze) | MVP      | Generic      | —                | —          | StorageProvider interface.                                                                                                           |
| F066 | Reverse proxy ready (Nginx, Caddy, Traefik)      | MVP      | Core         | F062             | —          | SSL termination, custom domains. Example configs included.                                                                           |
| F067 | Health check endpoints                           | V1       | Core         | F062             | —          | Readiness and liveness probes                                                                                                        |
| F068 | Automated database migrations on upgrade         | MVP      | Core         | F064             | —          | Prisma migrate on container start. Essential for safe upgrades.                                                                      |
| F069 | MySQL/MariaDB support                            | V2       | Generic      | F064             | —          | Alternative DB via Prisma adapter                                                                                                    |
| F070 | Local disk storage adapter (dev/small installs)  | MVP      | Generic      | F065             | —          | StorageProvider for local filesystem                                                                                                 |
| F071 | OpenTelemetry monitoring (vendor-neutral)        | V1       | Generic      | F062             | —          | MonitoringProvider interface                                                                                                         |
| F137 | Backup and restore tooling                       | MVP      | Core         | F064, F065, F100 | —          | CLI command or admin UI action to backup database + storage to archive. Restore from backup. Documented procedure.                   |
| F138 | Helm chart for Kubernetes deployment             | V2       | Core         | F062             | —          | K8s deployment option for production environments.                                                                                   |
| F139 | Horizontal scaling documentation and support     | V2       | Core         | F062, F100, F103 | —          | Documented architecture for running multiple app instances behind a load balancer. Requires Redis for shared sessions and job queue. |

### SSO & Identity

| ID   | Feature                                 | Priority | Adapter Type | Depends On | Compliance       | Notes                                                                  |
| ---- | --------------------------------------- | -------- | ------------ | ---------- | ---------------- | ---------------------------------------------------------------------- |
| F072 | Generic OIDC/OAuth2 SSO for admin login | V1       | Generic      | F004, F026 | HIPAA-164.312(d) | AuthSSOProvider interface                                              |
| F073 | LDAP/Active Directory integration       | V2       | Generic      | F072       | —                | Enterprise directory sync                                              |
| F140 | SAML 2.0 SSO support                    | V2       | Generic      | F072       | HIPAA-164.312(d) | Many enterprises require SAML. Implemented as AuthSSOProvider adapter. |

### Project Governance & Community

| ID   | Feature                                          | Priority | Adapter Type | Depends On | Compliance | Notes                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------ | -------- | ------------ | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F146 | CONTRIBUTING.md and developer onboarding guide   | MVP      | Core         | —          | —          | How to set up dev environment, run tests, submit PRs. Essential for community contributions from day one.                                                                                                                                                                              |
| F147 | SECURITY.md and vulnerability disclosure process | MVP      | Core         | —          | —          | Responsible disclosure instructions, security contact, PGP key. Required for any security-sensitive open-source project.                                                                                                                                                               |
| F148 | ARCHITECTURE.md system design overview           | MVP      | Core         | —          | —          | High-level architecture diagram, module descriptions, data flow, interface contracts. Enables contributors to understand the system without reading all code.                                                                                                                          |
| F149 | CODE_OF_CONDUCT.md                               | MVP      | Core         | —          | —          | Community behavior standards. Contributor Covenant or equivalent.                                                                                                                                                                                                                      |
| F150 | ROADMAP.md with public feature timeline          | V1       | Core         | —          | —          | Public-facing roadmap aligned with this feature matrix. Updated per release.                                                                                                                                                                                                           |
| F151 | RFC process for major feature proposals          | V1       | Core         | F146       | —          | Documented process for community members to propose significant changes. Template, review process, and decision criteria.                                                                                                                                                              |
| F152 | DATABASE_SCHEMA.md                               | MVP      | Core         | F148       | —          | **NEW.** Complete database schema documentation including the Document Object Model (Document → DocumentVersion → FileBlob → PreviewAsset → ExtractedText → Hash), SearchIndex model, Event table with partitioning strategy, organization/tenant model, and all entity relationships. |
| F153 | EVENT_MODEL.md                                   | MVP      | Core         | F148, F102 | —          | **NEW.** Complete event type catalog, event schema specification, partitioning strategy (monthly time-based), retention/archival policies, and subscriber patterns. Documents how audit trail, analytics, webhooks, and notifications consume events.                                  |
| F154 | PERMISSION_MODEL.md                              | MVP      | Core         | F148, F141 | —          | **NEW.** Complete permission model documentation: role hierarchy, group membership, per-document ACLs, link-level permissions, IP rules, time-based access. Documents the PermissionEngine evaluation order and the explainPermission() diagnostic capability.                         |
| F155 | DEPLOYMENT.md                                    | MVP      | Core         | F148       | —          | **NEW.** Step-by-step deployment guide covering Docker Compose, environment configuration, storage setup, email configuration, SSL/reverse proxy, first-run wizard, and upgrade procedures. Includes troubleshooting section.                                                          |

### Cloud Adapters: Azure

**Note:** Basic cloud storage (S3, Azure Blob) is available at MVP via the generic StorageProvider. These V3 features provide platform-native optimizations (managed identity auth, CDN integration, native monitoring, etc.) that go beyond basic cloud storage APIs.

| ID   | Feature                                       | Priority | Adapter Type   | Depends On | Compliance | Notes                                |
| ---- | --------------------------------------------- | -------- | -------------- | ---------- | ---------- | ------------------------------------ |
| F080 | Native Azure Blob Storage adapter             | V3       | Cloud-Specific | F065       | —          | Optimized SDK vs. S3-compat layer    |
| F081 | Azure Entra ID SSO adapter                    | V3       | Cloud-Specific | F072       | —          | Azure-specific OIDC extension        |
| F082 | Azure Key Vault secrets adapter               | V3       | Cloud-Specific | F080       | —          | Secrets management                   |
| F083 | Azure CDN delivery adapter                    | V3       | Cloud-Specific | F080       | —          | CDNProvider interface                |
| F084 | Azure App Service / Container Apps deployment | V3       | Cloud-Specific | F062       | —          | Platform-specific deployment configs |
| F085 | Azure Application Insights adapter            | V3       | Cloud-Specific | F071       | —          | MonitoringProvider for Azure         |
| F086 | Azure Communication Services email adapter    | V3       | Cloud-Specific | F059       | —          | EmailProvider for Azure              |
| F087 | Azure Bicep/ARM deployment templates          | V3       | Cloud-Specific | F084       | —          | Infrastructure as code               |

### Cloud Adapters: AWS

| ID   | Feature                           | Priority | Adapter Type   | Depends On | Compliance | Notes                  |
| ---- | --------------------------------- | -------- | -------------- | ---------- | ---------- | ---------------------- |
| F090 | AWS S3 native adapter (optimized) | V3       | Cloud-Specific | F065       | —          | Direct SDK integration |
| F091 | AWS SES email adapter             | V3       | Cloud-Specific | F059       | —          | EmailProvider for AWS  |
| F092 | AWS CloudFront CDN adapter        | V3       | Cloud-Specific | F090       | —          | CDNProvider for AWS    |

### Cloud Adapters: GCP

| ID   | Feature                      | Priority | Adapter Type   | Depends On | Compliance | Notes                   |
| ---- | ---------------------------- | -------- | -------------- | ---------- | ---------- | ----------------------- |
| F093 | Google Cloud Storage adapter | V3       | Cloud-Specific | F065       | —          | StorageProvider for GCP |
| F094 | Google Cloud CDN adapter     | V3       | Cloud-Specific | F093       | —          | CDNProvider for GCP     |

---

## Summary by Priority

| Priority  | Feature Count | Description                                                                                                                                                                                                                                                                               |
| --------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP       | 63            | Functional, self-hostable secure data room with admin UI, viewer experience, room templates, ZIP export, job queue, preview pipeline, event bus, permission engine, multi-tenant model, audit trail, virus scanning, basic OCR, backup/restore, governance docs, and design documentation |
| V1        | 45            | Aggressively competitive with commercial VDRs: search, watermarking, NDA gates, analytics dashboards, webhooks, checklists, binder export, legal hold, external orgs, compliance exports, bulk operations, accessibility, RFC process                                                     |
| V2        | 30            | E-signatures, advanced AI capabilities, deep analytics, document redaction, extended compliance, Kubernetes, SAML                                                                                                                                                                         |
| V3        | 13            | Cloud provider adapters, all optional and unbundled                                                                                                                                                                                                                                       |
| **Total** | **151**       |                                                                                                                                                                                                                                                                                           |

## Summary by Adapter Type

| Adapter Type   | Feature Count | Description                                                |
| -------------- | ------------- | ---------------------------------------------------------- |
| Core           | 108           | Built directly into the application                        |
| Generic        | 30            | Interface-defined, provider swappable via env config       |
| Cloud-Specific | 13            | Optional, post-stable, community or maintainer contributed |

## Summary by Category

| Category                       | MVP | V1  | V2  | V3  | Total |
| ------------------------------ | --- | --- | --- | --- | ----- |
| Platform Foundation            | 11  | 0   | 0   | 0   | 11    |
| Core Features                  | 7   | 0   | 0   | 0   | 7     |
| Document Management            | 9   | 9   | 0   | 0   | 18    |
| Access Control & Security      | 6   | 8   | 3   | 0   | 17    |
| Analytics & Reporting          | 1   | 6   | 2   | 0   | 9     |
| Viewer Experience              | 4   | 4   | 2   | 0   | 10    |
| Administration                 | 6   | 4   | 0   | 0   | 10    |
| E-Signatures                   | 0   | 0   | 7   | 0   | 7     |
| AI Features                    | 1   | 0   | 6   | 0   | 7     |
| Compliance & Legal             | 1   | 5   | 3   | 0   | 9     |
| Integration & API              | 1   | 4   | 2   | 0   | 7     |
| Deployment & Self-Hosting      | 8   | 2   | 3   | 0   | 13    |
| SSO & Identity                 | 0   | 1   | 2   | 0   | 3     |
| Project Governance & Community | 8   | 2   | 0   | 0   | 10    |
| Cloud Adapters                 | 0   | 0   | 0   | 13  | 13    |

---

## Generic Interface Summary

The following 13 generic provider interfaces must be defined in MVP architecture to allow adapter swapping:

| Interface            | MVP Default                                                                                  | V1 Alternatives        | V2 Additions                             | V3 Cloud Adapters                                            |
| -------------------- | -------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `StorageProvider`    | Local disk (F070), S3-compatible (F065), Azure Blob                                          | —                      | —                                        | Azure-native (F080), AWS S3-native (F090), GCP-native (F093) |
| `EmailProvider`      | SMTP (F059)                                                                                  | Resend, SendGrid       | —                                        | Azure Comms (F086), AWS SES (F091)                           |
| `AuthSSOProvider`    | Built-in (email + password)                                                                  | OIDC/OAuth2 (F072)     | LDAP (F073), SAML (F140)                 | Azure Entra (F081)                                           |
| `MonitoringProvider` | Stdout logging                                                                               | OpenTelemetry (F071)   | —                                        | Azure Insights (F085)                                        |
| `CDNProvider`        | Direct serve (no CDN)                                                                        | —                      | —                                        | Azure CDN (F083), CloudFront (F092), GCP CDN (F094)          |
| `JobProvider`        | BullMQ + Redis (F100)                                                                        | In-process fallback    | —                                        | —                                                            |
| `CacheProvider`      | Redis (F103)                                                                                 | In-memory LRU fallback | —                                        | —                                                            |
| `PreviewProvider`    | LibreOffice headless / Gotenberg (F101); includes OCR sub-provider (Tesseract default, F132) | —                      | —                                        | —                                                            |
| `ScanProvider`       | ClamAV (F107)                                                                                | —                      | —                                        | —                                                            |
| `EncryptionProvider` | AES-256 key from env (F120)                                                                  | HashiCorp Vault        | —                                        | Azure Key Vault (F082)                                       |
| `SearchProvider`     | PostgreSQL FTS (F011)                                                                        | Meilisearch            | OpenSearch/Elasticsearch                 | —                                                            |
| `AIProvider`         | None                                                                                         | —                      | OpenAI, Anthropic, local LLM (F074-F079) | Azure OpenAI                                                 |
| `SignatureProvider`  | None                                                                                         | —                      | Built-in (F045), DocuSign (F048)         | —                                                            |

---

## MVP Feature IDs (Quick Reference)

**Platform Foundation:** F100, F101, F102, F103, F104, F105, F106, F107, F132, F141, F142, F143

**Core:** F001, F002, F003, F004, F005, F108, F109

**Document Management:** F006, F007, F008, F009, F010, F014, F110, F113, F114

**Access Control:** F016, F017, F019, F020, F025, F116

**Analytics:** F121

**Viewer Experience:** F033, F034, F035, F124

**Administration:** F039, F040, F043, F044, F128, F130

**Compliance:** F052

**Integration:** F059

**Deployment:** F062, F063, F064, F065, F066, F068, F070, F137

**Project Governance:** F146, F147, F148, F149, F152, F153, F154, F155

(63 features)

---

## Authoritative MVP Scope Declaration

This table is the SINGLE SOURCE OF TRUTH for MVP scope. All other documents
(ARCHITECTURE.md, DATABASE_SCHEMA.md, EVENT_MODEL.md, PERMISSION_MODEL.md,
DEPLOYMENT.md) MUST reference this table. If any document conflicts with this
table, this table wins.

| Feature ID | Feature Name                                                        | Priority |
| ---------- | ------------------------------------------------------------------- | -------- |
| F001       | Custom domain support                                               | MVP      |
| F002       | Document version control with revision history                      | MVP      |
| F003       | Email notifications on document view/update                         | MVP      |
| F004       | Role separation: admin vs. viewer                                   | MVP      |
| F005       | Per-document and per-folder access controls                         | MVP      |
| F006       | Bulk upload with folder structure preservation                      | MVP      |
| F007       | Drag-and-drop upload                                                | MVP      |
| F008       | In-browser document viewer (no download required)                   | MVP      |
| F009       | Multi-format support (PDF, DOCX, XLSX, PPTX, images)                | MVP      |
| F010       | Document indexing and auto-numbering                                | MVP      |
| F014       | Download enable/disable per document                                | MVP      |
| F016       | Email verification before access                                    | MVP      |
| F017       | Password-protected rooms and links                                  | MVP      |
| F019       | Per-user and per-group permission levels                            | MVP      |
| F020       | User group management                                               | MVP      |
| F025       | Audit trail of all user activity                                    | MVP      |
| F033       | Branded viewer with no third-party branding                         | MVP      |
| F034       | Mobile-responsive document viewer                                   | MVP      |
| F035       | No account required for viewers (link-based)                        | MVP      |
| F039       | Multi-admin support                                                 | MVP      |
| F040       | Admin activity log                                                  | MVP      |
| F043       | Notification preferences per admin user                             | MVP      |
| F044       | Team member invite and role assignment                              | MVP      |
| F052       | GDPR-compliant data handling and deletion                           | MVP      |
| F059       | SMTP-agnostic email (any provider)                                  | MVP      |
| F062       | Docker Compose single-command deployment                            | MVP      |
| F063       | Environment variable-based configuration                            | MVP      |
| F064       | PostgreSQL database support                                         | MVP      |
| F065       | S3-compatible storage (AWS S3, MinIO, Backblaze)                    | MVP      |
| F066       | Reverse proxy ready (Nginx, Caddy, Traefik)                         | MVP      |
| F068       | Automated database migrations on upgrade                            | MVP      |
| F070       | Local disk storage adapter (dev/small installs)                     | MVP      |
| F100       | Background job queue                                                | MVP      |
| F101       | Document preview/conversion pipeline                                | MVP      |
| F102       | Internal event bus                                                  | MVP      |
| F103       | Cache layer                                                         | MVP      |
| F104       | Rate limiting and abuse prevention                                  | MVP      |
| F105       | Session management                                                  | MVP      |
| F106       | File integrity verification (hash on upload)                        | MVP      |
| F107       | Virus/malware scanning on upload                                    | MVP      |
| F108       | Room lifecycle management (draft, active, archived, closed)         | MVP      |
| F109       | Room templates (M&A, investor, board, compliance, custom)           | MVP      |
| F110       | Document tagging and custom metadata                                | MVP      |
| F113       | Archive/export entire room as ZIP                                   | MVP      |
| F114       | Trash/soft delete with recovery                                     | MVP      |
| F116       | Granular link permissions (per-link expiry, password, access scope) | MVP      |
| F121       | Room activity summary dashboard                                     | MVP      |
| F124       | Breadcrumb navigation in folder hierarchy                           | MVP      |
| F128       | Admin setup wizard (first-run configuration)                        | MVP      |
| F130       | Configurable room-level settings                                    | MVP      |
| F132       | Basic OCR for scanned documents (Tesseract)                         | MVP      |
| F137       | Backup and restore tooling                                          | MVP      |
| F141       | Centralized permission engine                                       | MVP      |
| F142       | Multi-tenant organization model                                     | MVP      |
| F143       | Demo seed data and sample room                                      | MVP      |
| F146       | CONTRIBUTING.md and developer onboarding guide                      | MVP      |
| F147       | SECURITY.md and vulnerability disclosure process                    | MVP      |
| F148       | ARCHITECTURE.md system design overview                              | MVP      |
| F149       | CODE_OF_CONDUCT.md                                                  | MVP      |
| F152       | DATABASE_SCHEMA.md                                                  | MVP      |
| F153       | EVENT_MODEL.md                                                      | MVP      |
| F154       | PERMISSION_MODEL.md                                                 | MVP      |
| F155       | DEPLOYMENT.md                                                       | MVP      |

**Important Notes:**

Features NOT in this table are NOT MVP, regardless of what other documents may imply.

Provider implementations that ship with the framework (e.g., PostgresFtsSearchProvider,
AesEncryptionProvider, AzureBlobStorageProvider) are part of the infrastructure layer
and available at MVP, but their corresponding user-facing features may be V1 or later.
The feature priority (e.g., F011 = V1, F120 = V1) determines scope; the provider
implementation availability is not a scope indicator.

---

## Critical Dependency Chains

### MVP Build Order

**Layer 0 - Zero dependencies (build first):**
F004 (Roles), F059 (Email), F062 (Docker), F064 (PostgreSQL), F065 (S3-compat storage), F146 (CONTRIBUTING.md), F147 (SECURITY.md), F148 (ARCHITECTURE.md), F149 (CODE_OF_CONDUCT.md)

**Layer 1 - Infrastructure primitives and design docs:**
F063 (Env config) ← F062
F066 (Reverse proxy) ← F062
F068 (DB migrations) ← F064
F070 (Local storage) ← F065
F100 (Job queue) ← F062
F102 (Event bus) ← F064
F103 (Cache) ← F062
F141 (Permission engine) ← F004
F142 (Multi-tenant model) ← F064
F152 (DATABASE_SCHEMA.md) ← F148
F153 (EVENT_MODEL.md) ← F148, F102
F154 (PERMISSION_MODEL.md) ← F148, F141
F155 (DEPLOYMENT.md) ← F148

**Layer 2 - Core document pipeline:**
F006 (Upload) ← F065
F101 (Preview pipeline) ← F100, F065
F104 (Rate limiting) ← F103
F105 (Sessions) ← F004, F103
F020 (Groups) ← F004
F137 (Backup/restore) ← F064, F065, F100

**Layer 3 - Document features:**
F008 (Viewer) ← F101
F010 (Indexing) ← F006
F106 (File hashing) ← F006
F107 (Virus scanning) ← F006, F100
F132 (OCR) ← F101
F110 (Tagging) ← F010
F009 (Multi-format) ← F008, F101
F007 (Drag-drop) ← F006
F108 (Room lifecycle) ← F004
F109 (Room templates) ← F108, F006

**Layer 4 - Access, audit, and exports:**
F002 (Version control) ← F006, F010, F106
F005 (ACLs) ← F004, F010, F020, F141
F025 (Audit trail) ← F004, F102
F016 (Email verify) ← F059
F017 (Passwords) ← F104
F019 (Permission levels) ← F004, F020
F014 (Download control) ← F005
F113 (ZIP export) ← F006, F100, F108
F114 (Trash) ← F006, F025
F116 (Link permissions) ← F005, F017

**Layer 5 - User-facing:**
F001 (Custom domain) ← F066
F003 (Notifications) ← F059, F043, F102
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
F143 (Demo seed data) ← F128, F006, F108, F109

### V1 Critical Paths

**Analytics:** F025 → F027 → F028 → F031 (reports)
**Compliance:** F016 → F018 (NDA) → F055 (timestamped NDA) → F133 (compliance export)
**Legal:** F157 (legal hold) ← F114, F025, F108
**Document chain:** F002 → F112 (diff), F013 (replace), F156 (binder export)
**API chain:** F057 → F061 (OpenAPI), F058 (webhooks), F135 (API keys)
**Search:** F011 → full-text search via SearchProvider
**Checklists:** F110 → F123 (due diligence tracking)
**Bulk ops:** F144 (bulk move/tag/delete/permissions)
**External orgs:** F158 ← F020, F142

### V2 Critical Paths

**E-signatures:** F045 → F046 → F050 (counter-sig), F047 (tamper-evident), F049 (audit)
**AI:** F074 (categorization) → F075 (summarization) → F076 (semantic search), F079 (Q&A)
**OCR:** F132 (basic Tesseract OCR) ← F101 (preview pipeline)
**Redaction:** F145 (redaction tool) → F078 (AI redaction detection)

---

## Changes from v5

### Change 1: Promote F132 (OCR/Text Extraction) from V2 to MVP

- **F132** (Basic OCR for scanned documents) moved from V2 to MVP priority
- Adapter type is Generic with Tesseract as the default provider
- Description updated to clarify: "Basic OCR via Tesseract for scanned documents. Enables full-text search on image-based PDFs. Advanced AI OCR remains V2."
- Added to Platform Foundation → AI Features category as MVP feature
- Assigned compliance code CC7.1 (Detect Changes)
- MVP feature count increased from 62 to 63
- V2 feature count decreased from 31 to 30
- Added OCRProvider to Generic Interface Summary with Tesseract as MVP default

### Change 2: Add SOC2/HIPAA Compliance Mapping Column

- Added new "Compliance" column to ALL feature tables throughout the document
- Column maps features to SOC2 Trust Service Criteria (CC series) and HIPAA safeguards using short codes
- Key mappings implemented:
  - **F102** (EventBus/Audit) → CC7.2, HIPAA-164.312(b)
  - **F120** (Encryption at Rest) → CC6.1, HIPAA-164.312(c)
  - **F004** (Role-Based Access) → CC6.1, HIPAA-164.312(a)
  - **F016** (Password Protection) → HIPAA-164.312(d)
  - **F107** (Virus Scanning) → CC7.1
  - **F121** (Activity Dashboard) → CC7.2, CC7.3
  - **F052** (GDPR tools) → CC9.1
  - **F141** (PermissionEngine) → CC6.1, HIPAA-164.312(a)
  - **F025** (Link Expiration) → CC6.3
  - And similar mappings for all other security/access/audit features
- Features with no direct compliance mapping show "-"
- All other security, access control, and audit-related features assigned appropriate codes

### Change 3: Enrich F143 (Demo Seed Data) Description

- Updated F143 description to explicitly specify: "Pre-populated 'Series A Funding Room' with sample documents (term sheet, cap table, financials, board minutes), folder structure, viewer permissions, NDA gate, and simulated activity history. Docker Compose demo launches with this room ready for exploration."
- Original admin setup functionality preserved in second sentence

### Summary Updates Throughout

- Version number updated from v5 to v6
- Date updated to 2026-03-14
- Summary tables updated with new counts:
  - MVP: 63 features (was 62)
  - V1: 45 features (unchanged)
  - V2: 30 features (was 31)
  - V3: 13 features (unchanged)
  - Total: 151 features (unchanged)
- AI Features category now shows MVP: 1, V1: 0, V2: 6 (reflecting F132 promotion)
- MVP Quick Reference updated to include F132 in Platform Foundation
- Adapter type summary: Core 108, Generic 30, Cloud-Specific 13 (unchanged)
