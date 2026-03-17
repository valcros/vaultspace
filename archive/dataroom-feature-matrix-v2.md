# Data Room - Feature Priority Matrix v2

**Priority Levels**

- **MVP** - Required for a functional, deployable data room
- **V1** - Competitive feature set, first full release
- **V2** - Advanced features, second release cycle
- **V3** - Cloud provider-specific optional adapters (post-stable)

**Adapter Types**

- **Core** - Built-in, no abstraction layer needed
- **Generic** - Implemented behind an interface; swappable provider
- **Cloud-Specific** - Optional adapter for a specific cloud provider

---

| ID       | Category                  | Feature                                                 | Priority | Adapter Type   | Depends On       |
| -------- | ------------------------- | ------------------------------------------------------- | -------- | -------------- | ---------------- |
| **F001** | Core                      | Custom domain support                                   | MVP      | Core           | F066             |
| **F002** | Core                      | Document version control with revision history          | MVP      | Core           | F010             |
| **F003** | Core                      | Email notifications on document view/update             | MVP      | Generic        | F059, F043       |
| **F004** | Core                      | Role separation: admin vs. viewer                       | MVP      | Core           | F020, F021       |
| **F005** | Core                      | Per-document and per-folder access controls             | MVP      | Core           | F004, F010, F011 |
| **F006** | Document Management       | Bulk upload with folder structure preservation          | MVP      | Core           | F065             |
| **F007** | Document Management       | Drag-and-drop upload                                    | MVP      | Core           | F006             |
| **F008** | Document Management       | In-browser PDF viewer (no download required)            | MVP      | Core           | —                |
| **F009** | Document Management       | Multi-format support (PDF, DOCX, XLSX, PPTX, images)    | MVP      | Core           | F008             |
| **F010** | Document Management       | Document indexing and auto-numbering                    | V1       | Core           | F006             |
| **F011** | Document Management       | Full-text search across documents                       | V1       | Core           | F006, F009       |
| **F012** | Document Management       | Document expiry dates                                   | V1       | Core           | F005             |
| **F013** | Document Management       | Replace document without changing share link            | V1       | Core           | F002, F006       |
| **F014** | Document Management       | Download enable/disable per document                    | MVP      | Core           | F005             |
| **F015** | Document Management       | Print enable/disable per document                       | V1       | Core           | F005, F008       |
| **F016** | Access Control & Security | Email verification before access                        | MVP      | Generic        | F059             |
| **F017** | Access Control & Security | Password-protected rooms and links                      | MVP      | Core           | —                |
| **F018** | Access Control & Security | NDA/agreement gate before room access                   | V1       | Core           | F016             |
| **F019** | Access Control & Security | Per-user and per-group permission levels                | MVP      | Core           | F004, F020       |
| **F020** | Access Control & Security | User group management                                   | MVP      | Core           | F004             |
| **F021** | Access Control & Security | IP allowlist/blocklist                                  | V2       | Core           | F004             |
| **F022** | Access Control & Security | Time-limited access with auto-revocation                | V1       | Core           | F005, F019       |
| **F023** | Access Control & Security | Dynamic watermarking (viewer email/IP on pages)         | V1       | Core           | F008, F016       |
| **F024** | Access Control & Security | Screenshot protection                                   | V2       | Core           | F008             |
| **F025** | Access Control & Security | Audit trail of all user activity                        | MVP      | Core           | F004, F016       |
| **F026** | Access Control & Security | Two-factor authentication for admin users               | V1       | Core           | F004             |
| **F027** | Analytics & Reporting     | Page-level engagement tracking                          | V1       | Core           | F008, F025       |
| **F028** | Analytics & Reporting     | Per-viewer activity dashboard                           | V1       | Core           | F025, F027       |
| **F029** | Analytics & Reporting     | Document view heatmaps                                  | V2       | Core           | F027, F028       |
| **F030** | Analytics & Reporting     | Real-time notification on investor open/revisit         | V1       | Generic        | F003, F025       |
| **F031** | Analytics & Reporting     | Exportable activity reports (CSV/PDF)                   | V1       | Core           | F025, F028       |
| **F032** | Analytics & Reporting     | Aggregate vs. individual viewer analytics               | V2       | Core           | F027, F028       |
| **F033** | Viewer Experience         | Branded viewer with no third-party branding             | MVP      | Core           | F001             |
| **F034** | Viewer Experience         | Mobile-responsive document viewer                       | MVP      | Core           | F008             |
| **F035** | Viewer Experience         | No account required for investors (link-based)          | MVP      | Core           | F016, F017       |
| **F036** | Viewer Experience         | Optional investor login portal                          | V1       | Core           | F035, F019       |
| **F037** | Viewer Experience         | Q&A module (investor questions routed to team)          | V2       | Core           | F036, F059       |
| **F038** | Viewer Experience         | Document request tracking                               | V2       | Core           | F037             |
| **F039** | Administration            | Multi-admin support                                     | MVP      | Core           | F004             |
| **F040** | Administration            | Admin activity log                                      | MVP      | Core           | F025, F039       |
| **F041** | Administration            | Room duplication (clone for new deal)                   | V1       | Core           | F005, F006       |
| **F042** | Administration            | Multiple simultaneous data rooms per account            | V1       | Core           | F004, F005       |
| **F043** | Administration            | Notification preferences per admin user                 | MVP      | Core           | F039             |
| **F044** | Administration            | Team member invite and role assignment                  | MVP      | Core           | F004, F039       |
| **F052** | Compliance & Legal        | GDPR-compliant data handling and deletion               | MVP      | Core           | F006, F025       |
| **F053** | Compliance & Legal        | Data residency selection (EU, US, etc.)                 | V2       | Generic        | F065             |
| **F054** | Compliance & Legal        | SOC 2 aligned audit logging                             | V2       | Core           | F025, F040       |
| **F055** | Compliance & Legal        | Legally timestamped NDA acceptance records              | V1       | Core           | F018             |
| **F056** | Compliance & Legal        | Configurable data retention policies                    | V2       | Core           | F052             |
| **F057** | Integration & API         | REST API for room/document management                   | V1       | Core           | F004, F005, F006 |
| **F058** | Integration & API         | Webhook support for external event notifications        | V2       | Generic        | F057             |
| **F059** | Integration & API         | SMTP-agnostic email (any provider)                      | MVP      | Generic        | —                |
| **F060** | Integration & API         | Slack/Teams notification integration                    | V2       | Generic        | F058             |
| **F061** | Integration & API         | OpenAPI/Swagger specification                           | V1       | Core           | F057             |
| **F062** | Deployment & Self-Hosting | Docker Compose single-command deployment                | MVP      | Core           | —                |
| **F063** | Deployment & Self-Hosting | Environment variable-based configuration                | MVP      | Core           | F062             |
| **F064** | Deployment & Self-Hosting | PostgreSQL database support                             | MVP      | Generic        | —                |
| **F065** | Deployment & Self-Hosting | S3-compatible storage (AWS S3, MinIO, Backblaze)        | MVP      | Generic        | F006             |
| **F066** | Deployment & Self-Hosting | Reverse proxy ready (Nginx, Caddy, Traefik)             | MVP      | Core           | F062             |
| **F067** | Deployment & Self-Hosting | Health check endpoints                                  | V1       | Core           | F062             |
| **F068** | Deployment & Self-Hosting | Automated database migrations on upgrade                | V1       | Core           | F064             |
| **F069** | Deployment & Self-Hosting | MySQL/MariaDB support                                   | V2       | Generic        | F064             |
| **F070** | Deployment & Self-Hosting | Local disk storage adapter (dev/small installs)         | MVP      | Generic        | F065             |
| **F071** | Deployment & Self-Hosting | OpenTelemetry monitoring (vendor-neutral)               | V1       | Generic        | F062             |
| **F072** | SSO & Identity            | Generic OIDC/OAuth2 SSO for admin login                 | V1       | Generic        | F004, F026       |
| **F073** | SSO & Identity            | LDAP/Active Directory integration                       | V2       | Generic        | F072             |
| **F080** | Cloud Adapters: Azure     | Native Azure Blob Storage adapter                       | V3       | Cloud-Specific | F065             |
| **F081** | Cloud Adapters: Azure     | Azure Entra ID SSO adapter                              | V3       | Cloud-Specific | F072             |
| **F082** | Cloud Adapters: Azure     | Azure Key Vault secrets adapter                         | V3       | Cloud-Specific | F080             |
| **F083** | Cloud Adapters: Azure     | Azure CDN delivery adapter                              | V3       | Cloud-Specific | F080             |
| **F084** | Cloud Adapters: Azure     | Azure App Service / Container Apps deployment templates | V3       | Cloud-Specific | F062             |
| **F085** | Cloud Adapters: Azure     | Azure Application Insights adapter                      | V3       | Cloud-Specific | F071             |
| **F086** | Cloud Adapters: Azure     | Azure Communication Services email adapter              | V3       | Cloud-Specific | F059             |
| **F087** | Cloud Adapters: Azure     | Azure Bicep/ARM deployment templates                    | V3       | Cloud-Specific | F084             |
| **F090** | Cloud Adapters: AWS       | AWS S3 native adapter (optimized beyond S3-compat)      | V3       | Cloud-Specific | F065             |
| **F091** | Cloud Adapters: AWS       | AWS SES email adapter                                   | V3       | Cloud-Specific | F059             |
| **F092** | Cloud Adapters: AWS       | AWS CloudFront CDN adapter                              | V3       | Cloud-Specific | F090             |
| **F093** | Cloud Adapters: GCP       | Google Cloud Storage adapter                            | V3       | Cloud-Specific | F065             |
| **F094** | Cloud Adapters: GCP       | Google Cloud CDN adapter                                | V3       | Cloud-Specific | F093             |

---

## Summary by Priority

| Priority  | Feature Count | Notes                                               |
| --------- | ------------- | --------------------------------------------------- |
| MVP       | 27            | Fully functional, self-hostable data room           |
| V1        | 21            | Competitive feature parity with commercial products |
| V2        | 13            | Advanced features, analytics depth, compliance      |
| V3        | 15            | Cloud provider adapters, all optional and unbundled |
| **Total** | **76**        |                                                     |

---

## Summary by Adapter Type

| Adapter Type   | Feature Count | Notes                                                      |
| -------------- | ------------- | ---------------------------------------------------------- |
| Core           | 50            | Built directly into the application                        |
| Generic        | 16            | Interface-defined, provider swappable via config           |
| Cloud-Specific | 15            | Optional, post-stable, community or maintainer contributed |

---

## Generic Interface Summary

The following interfaces must be defined in MVP to allow adapter swapping at V1/V3:

| Interface            | MVP Default       | V1 Alternatives                 | V3 Cloud Adapters                                   |
| -------------------- | ----------------- | ------------------------------- | --------------------------------------------------- |
| `StorageProvider`    | Local disk (F070) | S3-compatible (F065)            | Azure Blob (F080), AWS S3 native (F090), GCP (F093) |
| `EmailProvider`      | SMTP (F059)       | Resend, SendGrid                | Azure Comms (F086), AWS SES (F091)                  |
| `AuthSSOProvider`    | None / built-in   | OIDC/OAuth2 (F072), LDAP (F073) | Azure Entra (F081)                                  |
| `MonitoringProvider` | Stdout logging    | OpenTelemetry (F071)            | Azure Insights (F085)                               |
| `CDNProvider`        | None / direct     | —                               | Azure CDN (F083), CloudFront (F092), GCP CDN (F094) |

---

## MVP Feature IDs (Quick Reference)

F001, F002, F003, F004, F005, F006, F007, F008, F009, F014, F016, F017, F019, F020, F025, F033, F034, F035, F039, F040, F043, F044, F052, F059, F062, F063, F064, F065, F066, F070
