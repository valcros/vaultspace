# VaultSpace

**Secure Virtual Data Room Platform**

*Open-source, self-hosted document sharing for M&A, fundraising, board governance, and compliance.*

---

## The Problem

Sensitive documents scattered across email, shared drives, and consumer file-sharing tools. No visibility into who accessed what. Expensive per-seat pricing from legacy VDR vendors. Vendor lock-in with no data portability.

## The Solution

VaultSpace is an enterprise-grade Virtual Data Room you deploy on your own Azure infrastructure. Full control over your data, your security, and your costs.

---

## Key Capabilities

| Document Management | Security & Access | Collaboration |
|---------------------|-------------------|---------------|
| 35+ previewable file formats | Two-factor authentication (TOTP) | Q&A / Feedback boards |
| Version control with rollback | Dynamic watermarks (per-viewer) | Due diligence checklists |
| 14 structured categories | Virus scanning (ClamAV) | Event calendar |
| Full-text content search | IP address allowlists | Private messaging |
| Thumbnails & grid view | NDA acceptance gates | E-signature requests |
| Bulk operations | Time-limited sessions | Document linking |
| Document expiry & archival | Signed URLs (5-min expiry) | Priority & status tracking |

---

## Analytics & Audit

- **Per-page tracking** - See which pages each viewer looked at and for how long
- **Activity heatmaps** - Visualize engagement patterns hour-by-hour
- **Immutable audit trail** - 50+ event types, tamper-proof logging
- **Scheduled reports** - Daily, weekly, or monthly digest emails
- **Viewer engagement metrics** - Session duration, pages viewed, last active

---

## Share Links

| Feature | Description |
|---------|-------------|
| Scoped access | Share entire room, folder, or single document |
| Permission levels | View-only or view-and-download |
| Password protection | Optional bcrypt-hashed passwords |
| Email verification | Restrict to specific email addresses |
| Link expiry | Automatic expiration dates |
| Access requests | Non-members request access; admins approve with one click |

---

## Administration

- **Custom branding** - Logo, colors, favicon per organization or room
- **Room templates** - M&A Due Diligence, Investor Data Room, Board Portal, Compliance & Audit
- **Room duplication** - Clone folder structures for similar deals
- **Notification templates** - 6 customizable email templates with variables
- **Webhooks** - Real-time event notifications to external systems
- **REST API** - 90+ endpoints with OpenAPI 3.0 spec

---

## By the Numbers

| 38 | 90+ | 35+ | 50+ | 226 |
|:--:|:---:|:---:|:---:|:---:|
| Database Models | API Endpoints | File Formats | Event Types | Unit Tests |

---

## Technical Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14+, React 18+, TypeScript, TailwindCSS |
| Backend | Next.js API Routes, Prisma ORM |
| Database | PostgreSQL 15+ |
| Queue | Redis + BullMQ |
| Preview | Gotenberg (LibreOffice + Chromium) |
| Deployment | Azure Container Apps, Docker |

---

## Ideal For

| M&A Teams | Startups | Law Firms | Boards | Compliance |
|:---------:|:--------:|:---------:|:------:|:----------:|
| Due diligence packages | Investor materials | Discovery & client docs | Meeting materials | Audit documentation |

---

## Licensing

**AGPL v3** - Free for internal company use. Deploy on your own infrastructure at no cost.

Commercial licensing available for managed services, SaaS offerings, and white-label solutions.

---

**vaultspace.org**
