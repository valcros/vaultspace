# DataRoomPlus - Feature Priority Matrix v3

## Project Metadata

| Field             | Value                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Project Name**  | DataRoomPlus                                                                                                                                                                                           |
| **License**       | BSL 1.1 (Business Source License)                                                                                                                                                                      |
| **License Grant** | All features usable by anyone for internal/company purposes. Commercial resale of DataRoomPlus as a competing product requires a negotiated license. Code converts to open source (MIT) after 4 years. |
| **Tech Stack**    | Next.js 14+ (App Router), TypeScript, React, Prisma ORM, PostgreSQL, TailwindCSS                                                                                                                       |
| **Target Scale**  | Small (< 50 users, < 10K documents). Architecture should support future scaling without rewrites.                                                                                                      |
| **MVP UI**        | Full admin web UI included in MVP. No API-only phase.                                                                                                                                                  |
| **Repository**    | TBD (GitHub public repo)                                                                                                                                                                               |

---

## Priority Levels

- **MVP** - Required for a functional, deployable data room with admin UI
- **V1** - Competitive feature set, first full release
- **V2** - Advanced features including e-signatures and AI capabilities
- **V3** - Cloud provider-specific optional adapters (post-stable)

## Adapter Types

- **Core** - Built-in, no abstraction layer needed
- **Generic** - Implemented behind an interface; swappable provider via environment config
- **Cloud-Specific** - Optional adapter for a specific cloud provider

---

## Feature Matrix

### Core Features

| ID   | Feature                                        | Priority | Adapter Type | Depends On       | Notes                                               |
| ---- | ---------------------------------------------- | -------- | ------------ | ---------------- | --------------------------------------------------- |
| F001 | Custom domain support                          | MVP      | Core         | F066             | Reverse proxy config (Nginx/Caddy)                  |
| F002 | Document version control with revision history | MVP      | Core         | F006, F010       | Track all revisions per document                    |
| F003 | Email notifications on document view/update    | MVP      | Generic      | F059, F043       | Uses EmailProvider interface                        |
| F004 | Role separation: admin vs. viewer              | MVP      | Core         | —                | Foundation for all access control. No dependencies. |
| F005 | Per-document and per-folder access controls    | MVP      | Core         | F004, F010, F020 | Granular permissions on folders and files           |

### Document Management

| ID   | Feature                                              | Priority | Adapter Type | Depends On       | Notes                                                            |
| ---- | ---------------------------------------------------- | -------- | ------------ | ---------------- | ---------------------------------------------------------------- |
| F006 | Bulk upload with folder structure preservation       | MVP      | Core         | F065             | Uses StorageProvider interface                                   |
| F007 | Drag-and-drop upload                                 | MVP      | Core         | F006             | Frontend enhancement to upload flow                              |
| F008 | In-browser PDF viewer (no download required)         | MVP      | Core         | —                | Core viewing experience                                          |
| F009 | Multi-format support (PDF, DOCX, XLSX, PPTX, images) | MVP      | Core         | F008             | Convert/render non-PDF formats in viewer                         |
| F010 | Document indexing and auto-numbering                 | MVP      | Core         | F006             | **Promoted from V1.** Foundation for version control and search. |
| F011 | Full-text search across documents                    | V1       | Core         | F006, F009, F010 | Text extraction + search index                                   |
| F012 | Document expiry dates                                | V1       | Core         | F005             | Auto-revoke access after date                                    |
| F013 | Replace document without changing share link         | V1       | Core         | F002, F006       | Stable URLs across versions                                      |
| F014 | Download enable/disable per document                 | MVP      | Core         | F005             | Per-document permission flag                                     |
| F015 | Print enable/disable per document                    | V1       | Core         | F005, F008       | Per-document permission flag                                     |

### Access Control & Security

| ID   | Feature                                         | Priority | Adapter Type | Depends On | Notes                                         |
| ---- | ----------------------------------------------- | -------- | ------------ | ---------- | --------------------------------------------- |
| F016 | Email verification before access                | MVP      | Generic      | F059       | Uses EmailProvider interface                  |
| F017 | Password-protected rooms and links              | MVP      | Core         | —          | Room-level and link-level passwords           |
| F018 | NDA/agreement gate before room access           | V1       | Core         | F016       | Must verify email before presenting NDA       |
| F019 | Per-user and per-group permission levels        | MVP      | Core         | F004, F020 | View, download, print granularity             |
| F020 | User group management                           | MVP      | Core         | F004       | Create/manage groups for batch permissions    |
| F021 | IP allowlist/blocklist                          | V1       | Core         | F004       | **Moved from V2.** Standard security feature. |
| F022 | Time-limited access with auto-revocation        | V1       | Core         | F005, F019 | Scheduled access expiry per user/group        |
| F023 | Dynamic watermarking (viewer email/IP on pages) | V1       | Core         | F008, F016 | Overlay on rendered documents                 |
| F024 | Screenshot protection                           | V2       | Core         | F008       | CSS/JS-based deterrent (not foolproof)        |
| F025 | Audit trail of all user activity                | MVP      | Core         | F004, F016 | Foundation for analytics and compliance       |
| F026 | Two-factor authentication for admin users       | V1       | Core         | F004       | TOTP-based 2FA                                |

### Analytics & Reporting

| ID   | Feature                                         | Priority | Adapter Type | Depends On | Notes                                      |
| ---- | ----------------------------------------------- | -------- | ------------ | ---------- | ------------------------------------------ |
| F027 | Page-level engagement tracking                  | V1       | Core         | F008, F025 | Time per page, scroll depth                |
| F028 | Per-viewer activity dashboard                   | V1       | Core         | F025, F027 | Admin view of individual investor activity |
| F029 | Document view heatmaps                          | V2       | Core         | F027, F028 | Visual representation of engagement        |
| F030 | Real-time notification on investor open/revisit | V1       | Generic      | F003, F025 | Push or email alert to admins              |
| F031 | Exportable activity reports (CSV/PDF)           | V1       | Core         | F025, F028 | Download reports for offline review        |
| F032 | Aggregate vs. individual viewer analytics       | V2       | Core         | F027, F028 | Compare cohort behavior                    |

### Viewer Experience

| ID   | Feature                                        | Priority | Adapter Type | Depends On | Notes                                       |
| ---- | ---------------------------------------------- | -------- | ------------ | ---------- | ------------------------------------------- |
| F033 | Branded viewer with no third-party branding    | MVP      | Core         | F001       | White-label investor experience             |
| F034 | Mobile-responsive document viewer              | MVP      | Core         | F008       | Touch-friendly, responsive layout           |
| F035 | No account required for investors (link-based) | MVP      | Core         | F016, F017 | Email verification without account creation |
| F036 | Optional investor login portal                 | V1       | Core         | F035, F019 | Persistent access for repeat visitors       |
| F037 | Q&A module (investor questions routed to team) | V2       | Core         | F036, F059 | In-room communication channel               |
| F038 | Document request tracking                      | V2       | Core         | F037       | Investors can request missing documents     |

### Administration

| ID   | Feature                                      | Priority | Adapter Type | Depends On | Notes                                      |
| ---- | -------------------------------------------- | -------- | ------------ | ---------- | ------------------------------------------ |
| F039 | Multi-admin support                          | MVP      | Core         | F004       | Multiple admin users per deployment        |
| F040 | Admin activity log                           | MVP      | Core         | F025, F039 | What admins changed and when               |
| F041 | Room duplication (clone for new deal)        | V1       | Core         | F005, F006 | Copy room structure, permissions, docs     |
| F042 | Multiple simultaneous data rooms per account | V1       | Core         | F004, F005 | Isolated rooms with separate access        |
| F043 | Notification preferences per admin user      | MVP      | Core         | F039       | Per-admin email/alert settings             |
| F044 | Team member invite and role assignment       | MVP      | Core         | F004, F039 | Invite via email, assign admin/viewer role |

### E-Signatures (NEW)

| ID   | Feature                                             | Priority | Adapter Type | Depends On       | Notes                                        |
| ---- | --------------------------------------------------- | -------- | ------------ | ---------------- | -------------------------------------------- |
| F045 | Built-in basic e-signature (draw/type signature)    | V2       | Core         | F008, F016, F025 | Simple signature capture on documents        |
| F046 | Signature request workflow (request, remind, track) | V2       | Core         | F045, F059       | Admin sends signature requests to investors  |
| F047 | Signed document storage with tamper-evident hash    | V2       | Core         | F045, F002       | Immutable record of signed version           |
| F048 | DocuSign integration adapter                        | V2       | Generic      | F045, F057       | External e-signature provider via API        |
| F049 | Signature audit trail with timestamps               | V2       | Core         | F045, F025       | Who signed what and when                     |
| F050 | Counter-signature support (multi-party signing)     | V2       | Core         | F046             | Multiple signers in sequence or parallel     |
| F051 | Signature status dashboard                          | V2       | Core         | F046, F028       | Track pending, completed, expired signatures |

### AI Features (NEW)

| ID   | Feature                                         | Priority | Adapter Type | Depends On | Notes                                                                |
| ---- | ----------------------------------------------- | -------- | ------------ | ---------- | -------------------------------------------------------------------- |
| F074 | AI document auto-categorization on upload       | V2       | Generic      | F006, F010 | Uses AIProvider interface. Classify by type (financial, legal, etc.) |
| F075 | AI document summarization                       | V2       | Generic      | F009, F011 | Generate summaries for admin review                                  |
| F076 | AI-powered semantic search                      | V2       | Generic      | F011, F074 | Natural language search across all documents                         |
| F077 | AI-suggested access permissions                 | V2       | Generic      | F005, F074 | Recommend permissions based on doc type and past patterns            |
| F078 | AI redaction detection (flag sensitive content) | V2       | Generic      | F009, F074 | Identify PII, financial data, or confidential markers                |
| F079 | AI Q&A assistant for investors                  | V2       | Generic      | F037, F075 | Investors ask questions, AI answers from room docs                   |

### Compliance & Legal

| ID   | Feature                                    | Priority | Adapter Type | Depends On | Notes                                      |
| ---- | ------------------------------------------ | -------- | ------------ | ---------- | ------------------------------------------ |
| F052 | GDPR-compliant data handling and deletion  | MVP      | Core         | F006, F025 | Right to erasure, data export              |
| F053 | Data residency selection (EU, US, etc.)    | V2       | Generic      | F065       | Storage region configuration               |
| F054 | SOC 2 aligned audit logging                | V2       | Core         | F025, F040 | Structured logs meeting SOC 2 requirements |
| F055 | Legally timestamped NDA acceptance records | V1       | Core         | F018       | Cryptographic timestamp on acceptance      |
| F056 | Configurable data retention policies       | V2       | Core         | F052       | Auto-delete after configurable period      |

### Integration & API

| ID   | Feature                                          | Priority | Adapter Type | Depends On       | Notes                                     |
| ---- | ------------------------------------------------ | -------- | ------------ | ---------------- | ----------------------------------------- |
| F057 | REST API for room/document management            | V1       | Core         | F004, F005, F006 | Programmatic access to all core functions |
| F058 | Webhook support for external event notifications | V2       | Generic      | F057             | HTTP callbacks on room/doc/user events    |
| F059 | SMTP-agnostic email (any provider)               | MVP      | Generic      | —                | EmailProvider interface. Default: SMTP    |
| F060 | Slack/Teams notification integration             | V2       | Generic      | F058             | Webhook-based channel notifications       |
| F061 | OpenAPI/Swagger specification                    | V1       | Core         | F057             | Auto-generated API docs                   |

### Deployment & Self-Hosting

| ID   | Feature                                          | Priority | Adapter Type | Depends On | Notes                                |
| ---- | ------------------------------------------------ | -------- | ------------ | ---------- | ------------------------------------ |
| F062 | Docker Compose single-command deployment         | MVP      | Core         | —          | Primary deployment method            |
| F063 | Environment variable-based configuration         | MVP      | Core         | F062       | All config via .env, no code changes |
| F064 | PostgreSQL database support                      | MVP      | Generic      | —          | Primary database via Prisma ORM      |
| F065 | S3-compatible storage (AWS S3, MinIO, Backblaze) | MVP      | Generic      | F006       | StorageProvider interface            |
| F066 | Reverse proxy ready (Nginx, Caddy, Traefik)      | MVP      | Core         | F062       | SSL termination, custom domains      |
| F067 | Health check endpoints                           | V1       | Core         | F062       | Readiness and liveness probes        |
| F068 | Automated database migrations on upgrade         | V1       | Core         | F064       | Prisma migrate on container start    |
| F069 | MySQL/MariaDB support                            | V2       | Generic      | F064       | Alternative DB via Prisma adapter    |
| F070 | Local disk storage adapter (dev/small installs)  | MVP      | Generic      | F065       | StorageProvider for local filesystem |
| F071 | OpenTelemetry monitoring (vendor-neutral)        | V1       | Generic      | F062       | MonitoringProvider interface         |

### SSO & Identity

| ID   | Feature                                 | Priority | Adapter Type | Depends On | Notes                     |
| ---- | --------------------------------------- | -------- | ------------ | ---------- | ------------------------- |
| F072 | Generic OIDC/OAuth2 SSO for admin login | V1       | Generic      | F004, F026 | AuthSSOProvider interface |
| F073 | LDAP/Active Directory integration       | V2       | Generic      | F072       | Enterprise directory sync |

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

| Priority  | Feature Count | Description                                                      |
| --------- | ------------- | ---------------------------------------------------------------- |
| MVP       | 28            | Fully functional, self-hostable data room with admin UI          |
| V1        | 22            | Competitive feature parity with commercial products              |
| V2        | 22            | Advanced features: e-signatures, AI, analytics depth, compliance |
| V3        | 15            | Cloud provider adapters, all optional and unbundled              |
| **Total** | **87**        |                                                                  |

## Summary by Adapter Type

| Adapter Type   | Feature Count | Description                                                |
| -------------- | ------------- | ---------------------------------------------------------- |
| Core           | 53            | Built directly into the application                        |
| Generic        | 19            | Interface-defined, provider swappable via env config       |
| Cloud-Specific | 15            | Optional, post-stable, community or maintainer contributed |

## Summary by Category

| Category                  | MVP | V1  | V2  | V3  | Total |
| ------------------------- | --- | --- | --- | --- | ----- |
| Core Features             | 5   | 0   | 0   | 0   | 5     |
| Document Management       | 7   | 4   | 0   | 0   | 11    |
| Access Control & Security | 6   | 5   | 1   | 0   | 12    |
| Analytics & Reporting     | 0   | 4   | 2   | 0   | 6     |
| Viewer Experience         | 3   | 1   | 2   | 0   | 6     |
| Administration            | 5   | 2   | 0   | 0   | 7     |
| E-Signatures              | 0   | 0   | 7   | 0   | 7     |
| AI Features               | 0   | 0   | 6   | 0   | 6     |
| Compliance & Legal        | 1   | 1   | 3   | 0   | 5     |
| Integration & API         | 1   | 2   | 2   | 0   | 5     |
| Deployment & Self-Hosting | 5   | 3   | 1   | 0   | 9     |
| SSO & Identity            | 0   | 1   | 1   | 0   | 2     |
| Cloud Adapters            | 0   | 0   | 0   | 15  | 15    |

---

## Generic Interface Summary

The following interfaces must be defined in MVP architecture to allow adapter swapping:

| Interface            | MVP Default                             | V1 Alternatives      | V2 Additions                             | V3 Cloud Adapters                                   |
| -------------------- | --------------------------------------- | -------------------- | ---------------------------------------- | --------------------------------------------------- |
| `StorageProvider`    | Local disk (F070), S3-compatible (F065) | —                    | —                                        | Azure Blob (F080), AWS S3 (F090), GCP (F093)        |
| `EmailProvider`      | SMTP (F059)                             | Resend, SendGrid     | —                                        | Azure Comms (F086), AWS SES (F091)                  |
| `AuthSSOProvider`    | Built-in (email + password)             | OIDC/OAuth2 (F072)   | LDAP (F073)                              | Azure Entra (F081)                                  |
| `MonitoringProvider` | Stdout logging                          | OpenTelemetry (F071) | —                                        | Azure Insights (F085)                               |
| `CDNProvider`        | Direct serve (no CDN)                   | —                    | —                                        | Azure CDN (F083), CloudFront (F092), GCP CDN (F094) |
| `AIProvider`         | None                                    | —                    | OpenAI, Anthropic, local LLM (F074-F079) | Azure OpenAI                                        |
| `SignatureProvider`  | Built-in (F045)                         | —                    | DocuSign (F048)                          | —                                                   |

---

## MVP Feature IDs (Quick Reference)

F001, F002, F003, F004, F005, F006, F007, F008, F009, F010, F014, F016, F017, F019, F020, F025, F033, F034, F035, F039, F040, F043, F044, F052, F059, F062, F063, F064, F065, F066, F070

(28 features)

---

## Critical Dependency Chains

These are the longest dependency paths that determine build order within each priority tier:

**MVP Foundation (build first, no dependencies):**
F062 (Docker) → F064 (PostgreSQL) → F059 (Email) → F008 (PDF Viewer) → F017 (Password Protection) → F004 (Role Separation)

**MVP Layer 2 (depends on foundation):**
F006 (Bulk Upload) → F010 (Indexing) → F002 (Version Control) → F005 (Access Controls) → F020 (Groups) → F019 (Permissions)

**MVP Layer 3 (depends on Layer 2):**
F025 (Audit Trail) → F040 (Admin Log) → F003 (Notifications) → F033 (Branded Viewer) → F035 (Link-based Access)

**V1 Critical Path:**
F025 → F027 (Page Tracking) → F028 (Viewer Dashboard) → F031 (Reports)
F016 → F018 (NDA Gate) → F055 (Timestamped NDA)
F057 (REST API) → F061 (OpenAPI Spec)

**V2 Critical Path:**
F045 (E-Sig) → F046 (Workflow) → F050 (Counter-Sig)
F074 (AI Categorization) → F075 (Summarization) → F076 (Semantic Search)

---

## Changes from v2

1. **Project metadata added** - Name (DataRoomPlus), license (BSL 1.1), tech stack (Next.js/TypeScript), scale target
2. **F010 promoted to MVP** - Resolved dependency conflict where MVP features (F002, F005) depended on V1 feature
3. **F021 moved from V2 to V1** - IP allowlist/blocklist is a standard security expectation
4. **F004 dependencies fixed** - Removed circular dependency (F004 ↔ F020). F004 now has no dependencies as the foundational role system.
5. **E-Signatures category added (V2)** - 7 features (F045-F051) including built-in signatures, workflow, and DocuSign integration
6. **AI Features category added (V2)** - 6 features (F074-F079) including auto-categorization, summarization, semantic search, and investor Q&A
7. **AIProvider and SignatureProvider added** to generic interface table
8. **Notes column added** to all feature tables for implementation context
9. **Critical dependency chains documented** for build order planning
10. **Summary tables updated** - 87 total features (up from 76)
