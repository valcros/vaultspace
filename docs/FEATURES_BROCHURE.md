# VaultSpace — Secure Virtual Data Room Platform

**The open-source, self-hosted data room built for M&A, fundraising, board governance, and compliance.**

---

## What is VaultSpace?

VaultSpace is an enterprise-grade Virtual Data Room (VDR) that gives organizations complete control over how they share, protect, and track sensitive documents. Whether you're closing a deal, managing investor relations, or running a compliance review, VaultSpace provides the security, collaboration, and analytics you need — deployed on your own infrastructure.

Unlike cloud-only data rooms that lock you into vendor pricing and data residency you can't control, VaultSpace is self-hosted on Azure, giving you full sovereignty over your documents, your data, and your costs.

---

## Open Source, Not Open Season

VaultSpace is released under the **GNU Affero General Public License v3 (AGPL-3.0)**.

**What this means for you:**

- **Free for internal use** — Any company can deploy VaultSpace on their own infrastructure and use it internally at no cost. Run it for your own deals, your own board, your own compliance — forever, for free.
- **Free to modify** — Fork it, customize it, extend it to fit your workflows. The source code is yours to read, audit, and adapt.
- **No commercial resale without a license** — You may not use VaultSpace to build a hosted data room service that you sell or offer to clients without obtaining a separate commercial license. The AGPL requires that if you offer VaultSpace as a network service to third parties, you must release your complete source code — including any modifications — under the same license.
- **Commercial licenses available** — If you want to offer VaultSpace as part of a managed service, SaaS product, or white-label solution without open-sourcing your changes, contact us for commercial licensing terms.

**In short:** Use it free inside your company. Pay only if you want to build a business on top of it.

---

## Why VaultSpace?

| Challenge                                                              | VaultSpace Solution                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Sensitive documents scattered across email, Dropbox, and shared drives | Centralized, secure data rooms with granular access control           |
| No visibility into who viewed what, when, or for how long              | Per-page analytics, activity heatmaps, and comprehensive audit trails |
| Expensive per-seat pricing from legacy VDR vendors                     | Open-source, self-hosted — pay only for your Azure infrastructure     |
| Vendor lock-in with no data portability                                | Your data, your servers, your rules — full export at any time         |
| Static file sharing with no collaboration tools                        | Built-in Q&A, checklists, calendar, messaging, and e-signatures       |

---

## Core Features

### Document Management

- **Unlimited Documents** — Upload any file type with no per-document fees
- **Folder Hierarchy** — Organize documents in nested folder structures matching your deal or project organization
- **14 Document Categories** — Structured taxonomy (Financial Statements, Contracts, IP, Tax Returns, Compliance, and 9 more) for consistent classification across teams
- **Freeform Tags** — Flexible tagging alongside structured categories
- **Version Control** — Upload new versions with change descriptions, view version history, preview any version, and rollback when needed
- **Document Expiry** — Set automatic expiration dates with configurable actions (archive or delete)
- **Soft Delete & Trash** — Recover accidentally deleted documents within your retention window
- **Bulk Operations** — Select multiple documents for category assignment, confidential marking, download, or deletion
- **Bookmarks** — Star important documents for quick access

### Document Preview & Rendering

- **35+ File Formats** — Preview PDFs, Office documents (Word, Excel, PowerPoint), images, text files, code, Markdown, CSV, SVG, Visio, and more — directly in the browser
- **Gotenberg Integration** — Server-side document conversion via LibreOffice and Chromium for pixel-perfect Office document rendering
- **Smart Thumbnails** — Auto-generated thumbnails for grid view that show actual document content, not just file type icons
- **Grid & List Views** — Toggle between visual grid (with thumbnails) and compact list (with sortable columns) views
- **Compact Density Mode** — Fit more documents on screen with reduced row height

### Full-Text Search

- **Content Search** — Search inside PDFs and documents, not just filenames
- **Command Palette** — Press Cmd+K for instant search across all documents with live results
- **Dedicated Search Page** — Full search interface with file type filters and paginated results
- **Relevance Ranking** — Results sorted by match quality with highlighted snippets showing where your query matched

---

## Security & Access Control

### Authentication & Identity

- **Two-Factor Authentication (TOTP)** — Protect admin accounts with authenticator app codes and 8 backup recovery codes
- **Custom Session Management** — Database-backed sessions with 24-hour idle timeout and 7-day absolute maximum
- **Password Reset Flow** — Secure token-based password recovery
- **Self-Registration Control** — Enable or disable public sign-up per organization

### Document Protection

- **Dynamic Watermarks** — Overlay viewer-specific watermarks on documents showing their email, name, IP address, and timestamp — different for every viewer
- **Virus Scanning** — ClamAV integration scans every upload before it becomes viewable
- **Integrity Verification** — SHA-256 hash chains across document versions for tamper detection
- **Confidential Mode** — Mark individual documents or entire rooms as confidential to suppress thumbnail previews
- **Signed Preview URLs** — 5-minute expiry with automatic refresh prevents unauthorized URL sharing

### Access Control

- **Role-Based Access** — Organization-level (Admin/Viewer) and room-level (Admin/Viewer) roles
- **Group Permissions** — Create groups (Legal Team, Board Members, Investors) and assign permissions at the group level
- **Granular Permissions** — Set view, download, or admin access per document, folder, or room
- **IP Address Allowlist** — Restrict room access to specific IP addresses or ranges
- **NDA Gate** — Require viewers to accept your custom NDA before accessing any documents
- **Time-Limited Sessions** — Set maximum viewing duration per share link (e.g., 60 minutes)

### Share Links

- **Scoped Links** — Share an entire room, a specific folder, or a single document
- **Permission Levels** — View-only or view-and-download per link
- **Password Protection** — Optional password gate with bcrypt hashing
- **Email Verification** — Restrict link access to specific email addresses
- **Link Expiry** — Set expiration dates on share links
- **Short URLs** — Clean `/r/abc123` redirect URLs for sharing
- **Access Requests** — Non-members can request access; admins review and approve with one click (auto-creates a share link)

### Audit & Compliance

- **Immutable Audit Trail** — 50+ event types logged with actor, timestamp, IP, and metadata — events cannot be modified or deleted
- **Per-Page Analytics** — Track which pages each viewer looked at and for how long
- **Activity Heatmaps** — Visualize hourly activity patterns and document engagement across your data room
- **Viewer Session Tracking** — See total time spent, pages viewed, and last active time for every viewer
- **Room Activity Feed** — Real-time chronological feed of all actions within a room

---

## Collaboration Tools

### Q&A / Feedback Board

- **Structured Q&A** — Viewers submit questions with subject and description, optionally linked to specific documents
- **Priority Levels** — Mark questions as Normal, High, or Urgent
- **Status Tracking** — Open, Answered, and Closed workflow
- **Public/Private Visibility** — Choose whether answers are visible to all viewers or only the original asker
- **Viewer Q&A Page** — Viewers see their own questions and all public answers in a dedicated portal

### Due Diligence Checklists

- **Multiple Checklists Per Room** — Create separate checklists for different workstreams (financial, legal, technical)
- **Item Status Tracking** — Four states: Pending, In Progress, Complete, Not Applicable
- **Progress Visualization** — Progress bars showing completion percentage at a glance
- **Document Linking** — Associate checklist items with specific documents to track what's been provided
- **Required vs Optional** — Mark items as required for the deal to close

### Event Calendar

- **5 Event Types** — Milestones, Review Dates, Deadlines, Meetings, and Other
- **Document Links** — Associate calendar events with specific documents
- **Color Coding** — Visual differentiation by event type
- **Timeline View** — Events grouped by month in chronological order

### Private Messaging

- **Contextual Messages** — Send messages tied to specific rooms or documents
- **Inbox & Sent** — Split view with message list and detail panel
- **Read Receipts** — Track whether messages have been read

### E-Signatures

- **Signature Requests** — Request signatures on specific documents from any email address
- **Multiple Signature Types** — Drawn, typed, or uploaded signatures
- **Status Workflow** — Pending, Signed, Declined, or Expired
- **Audit Trail** — IP address and timestamp recorded with every signature
- **Decline with Reason** — Signers can decline and provide an explanation

---

## Analytics & Reporting

### Admin Dashboard

- **At-a-Glance Metrics** — Total rooms, documents, members, and storage usage in stat cards
- **Room Status Breakdown** — See how many rooms are Draft, Active, Archived, or Closed
- **Recent Activity Feed** — Last 10 events across your organization
- **Top Viewed Documents** — Ranked list of your most-accessed documents with view counts

### Room Analytics

- **Document Activity** — Views, downloads, and unique viewers per document
- **Hourly Heatmaps** — See when your viewers are most active (hour-by-hour breakdown)
- **Viewer Engagement** — Total views, time spent, and last activity per viewer
- **Session Analytics** — Average session duration and total sessions

### Scheduled Reports

- **Weekly Digest** — Generate activity summaries covering documents uploaded, viewed, downloaded, Q&A activity, and viewer engagement
- **Configurable Period** — Daily, weekly, or monthly report windows
- **Top Documents** — Most-viewed documents in the reporting period
- **Viewer Activity Breakdown** — Per-viewer engagement metrics

### Binder / Index Export

- **Printable Table of Contents** — Generate a professional document index with sequential page numbers, categories, file types, sizes, and upload dates
- **HTML Format** — Print-ready page that exports cleanly to PDF via browser print
- **JSON Format** — Machine-readable index for integration with other tools

---

## Administration

### Organization Management

- **Custom Branding** — Set your organization logo, primary color, and favicon
- **Room-Level Branding** — Override organization colors and logo per room for white-label client experiences
- **Viewer Portal Branding** — Room branding carries through to the viewer access gate and document browser

### Room Management

- **Room Templates** — Create rooms from pre-built templates (M&A Due Diligence, Investor Data Room, Board Portal, Compliance & Audit) with pre-populated folder structures
- **Room Duplication** — Clone an existing room's folder structure and settings to quickly set up similar deals
- **Room Lifecycle** — Draft, Active, Archived, and Closed statuses with enforcement (closed rooms reject uploads)
- **Bulk Viewer Management** — Invite or revoke access for multiple viewers at once

### Notification System

- **Customizable Email Templates** — Edit the subject and body of 6 notification types with placeholder variables ({user_name}, {document_name}, {room_name}, {org_name}, {viewer_email})
- **Notification Preferences** — Per-user toggles for document uploads, views, access changes, and digest frequency (Immediate, Daily, Weekly)
- **Quiet Hours** — Configure notification blackout periods

### Webhooks

- **Real-Time Event Notifications** — Push events to external URLs as they happen
- **Event Type Filtering** — Subscribe to specific events (document uploads, link access, Q&A submissions, etc.)
- **Room Scoping** — Scope webhooks to specific rooms or receive all organization events
- **HMAC Signatures** — Verify webhook authenticity with auto-generated secrets
- **Failure Tracking** — Monitor delivery failures and retry counts

### API & Integrations

- **REST API** — 90+ endpoints covering every feature in the platform
- **OpenAPI 3.0 Specification** — Import into Swagger UI, Postman, or Insomnia for interactive documentation
- **Cookie-Based Authentication** — Secure session tokens for API access

---

## Technical Foundation

### Architecture

- **Next.js 14+** — React server components with App Router for fast, modern UI
- **TypeScript** — End-to-end type safety across frontend and backend
- **Prisma ORM** — Type-safe database access with 38 models
- **PostgreSQL 15+** — Enterprise-grade relational database
- **Redis + BullMQ** — Background job processing for previews, scans, notifications, and exports
- **TailwindCSS** — Responsive, accessible UI components

### Deployment

- **Azure Container Apps** — Production-ready container deployment
- **Gotenberg Sidecar** — Document conversion service running alongside the application
- **Docker** — Containerized for consistent deployments
- **CI/CD Pipeline** — Automated testing, building, and deployment via GitHub Actions
- **OIDC Authentication** — No long-lived deployment secrets

### Security Architecture

- **Tenant Isolation** — Every database query scoped by organization ID with Row-Level Security
- **AGPL v3 License** — Open-source with strong copyleft ensuring community benefit
- **226 Unit Tests** — Comprehensive test coverage across 30 test files
- **Automated Security Scanning** — npm audit in CI pipeline

---

## Setup in Minutes

1. **Deploy to Azure** — One-click deployment via Azure Container Apps
2. **Run the Setup Wizard** — Create your organization and admin account
3. **Create Your First Room** — Choose a template or start from scratch
4. **Upload Documents** — Drag and drop, with automatic preview generation
5. **Share with Viewers** — Create a share link and send it

---

## Who Uses VaultSpace?

- **M&A Teams** — Managing due diligence packages for acquisitions
- **Startups** — Sharing investor materials during fundraising rounds
- **Law Firms** — Organizing discovery documents and client materials
- **Board Secretaries** — Distributing board meeting materials securely
- **Compliance Officers** — Managing audit documentation with full access trails
- **Real Estate** — Sharing property documents with buyers and inspectors
- **Private Equity** — Managing portfolio company documentation

---

## By the Numbers

| Metric                 | Value          |
| ---------------------- | -------------- |
| Database Models        | 38             |
| API Endpoints          | 90+            |
| Previewable File Types | 35+            |
| Document Categories    | 14             |
| Event Types Tracked    | 50+            |
| Unit Tests             | 226            |
| Room Templates         | 4 built-in     |
| Notification Templates | 6 customizable |

---

---

## Licensing

VaultSpace is open-source software licensed under **AGPL v3**. Free for internal company use. Commercial licensing available for managed services, SaaS offerings, and white-label solutions.

Learn more at [vaultspace.org](https://vaultspace.org)
