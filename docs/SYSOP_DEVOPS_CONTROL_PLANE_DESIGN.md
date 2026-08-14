# F159 - System Operator (SysOp) DevOps Control Plane & Cross-Tenant Management

- **Feature ID:** F159
- **Title:** System Operator (SysOp) DevOps Control Plane & Cross-Tenant Management
- **Priority:** V1
- **Adapter Type:** Core
- **Depends On:** F040 (Admin Activity Log), F100 (Background Job Queue), F102 (Internal EventBus), F142 (Multi-Tenant Organization Model)
- **Compliance Mapping:** CC7.2 (Monitoring), CC7.3 (Incident Response), CC6.1 (Access Control)
- **Status:** Architectural Specification (Roadmap Addition)
- **Last Updated:** 2026-08-13

---

## 1. Executive Summary & Purpose

VaultSpace's primary administration interface (`app/(admin)/`) is **tenant-scoped**—an organization administrator sees and manages only the rooms, users, and settings within their specific `organizationId`.

However, operating a self-hosted or SaaS deployment of VaultSpace requires a top-down **Platform System Operator (SysOp) & DevOps Control Plane** (`app/(sysop)/`). This control plane is not tied to any single organization. It equips platform operators, DevOps engineers, and security teams with global observability and administrative control over:

1. **Tenant & Resource Lifecycle:** Provisioning, storage quotas, user directory, and room management across all organizations.
2. **Infrastructure Operational Health:** Worker queue depths (BullMQ), database pool stats, Redis memory, conversion pipeline latency (Gotenberg), virus scanner status (ClamAV), and email service delivery.
3. **Platform Security & Forensics:** Cross-tenant security event stream, password reset bot monitoring, rate-limiting triggers, IP blocklists, and break-glass audit logs.

---

## 2. Architecture & Security Model

### 2.1 Route Namespace & Isolation

To ensure clear separation from tenant-facing interfaces, SysOp features are located in dedicated route groups:

- **Web Control Plane:** `src/app/(sysop)/` served under `/sysop/*`
- **SysOp API Endpoints:** `src/app/api/sysop/*`
- **Middleware Guard:** `src/lib/middleware/sysopAuth.ts`

```
src/app/
├── (admin)/                 # Tenant-Scoped Admin UI (org-specific)
├── (viewer)/                # Tenant-Scoped Viewer UI
├── (sysop)/                 # System Operator Control Plane (Cross-Tenant Platform UI)
│   ├── layout.tsx
│   ├── page.tsx             # Overview & Quick Stats
│   ├── tenants/             # Screen 1: Tenant & Resource Operations
│   │   ├── page.tsx
│   │   ├── [orgId]/page.tsx
│   │   └── users/page.tsx
│   ├── operations/          # Screen 2: System Operational Health & Performance
│   │   ├── page.tsx
│   │   ├── queues/page.tsx
│   │   └── storage/page.tsx
│   └── security/            # Screen 3: Platform Security, Audit & Forensics
│       ├── page.tsx
│       ├── password-resets/page.tsx
│       └── audit/page.tsx
```

### 2.2 Role & Privilege Model

- **Identity Flag:** User entity includes `isSystemOperator: boolean` (or a dedicated `SystemOperator` model).
- **Multi-Factor Requirement:** Mandatory 2FA (`TOTP`) is strictly enforced for all SysOp logins.
- **Dedicated Session Token:** SysOp authentication uses a separate cookie (`vaultspace-sysop-session`) with a 4-hour idle timeout and strict IP binding.

### 2.3 Zero-Trust "Break-Glass" Customer Data Boundary

SysOps require administrative visibility across tenants, but customer document privacy must remain protected:

- **Metadata Access (Allowed):** SysOps can view organization names, user emails, storage totals, document counts, queue states, and security event logs.
- **Document Content Access (Restricted):** SysOps **cannot** view, preview, or download customer documents inside data rooms by default.
- **Break-Glass Protocol:** To enter a customer room or inspect a document for troubleshooting/legal compliance, the SysOp must execute a formal **"Break-Glass Request"**:
  1. Specify reason and reference ticket ID.
  2. Emit an immutable `SYSOP_BREAK_GLASS_ACCESS` security audit event to `EventBus`.
  3. Notify the target organization's `OWNER` via email (unless legally suppressed).
  4. Access is granted for a 1-hour window before automatic revocation.

---

## 3. UI Screen Specifications

The SysOp Control Plane is structured into three dedicated operational screens:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          VaultSpace SysOp Control Plane                     │
│  [Tenants & Resources]    [Operational Health]    [Platform Security]       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Screen 1: Tenant & Resource Operations (`/sysop/tenants`)

Provides top-down management of all organizations, users, and rooms on the platform.

#### Components:
1. **Organization Directory & Quota Management:**
   - Table displaying: Organization Name, Slug, Tier, Created Date, Active Rooms, Active Users, Total Storage Used, Status (`ACTIVE`, `SUSPENDED`, `READ_ONLY`).
   - Actions: Provision New Tenant, Adjust Storage Quota (GB limit), Suspend Tenant, Toggle Maintenance Mode.
2. **Cross-Tenant Global User Directory:**
   - Searchable across all tenants by email, name, domain, IP address, or creation date.
   - Shows user's organization memberships, active session count, last active timestamp, and 2FA status.
   - Actions: Force-logout all sessions globally, send administrative password reset, disable account globally.
3. **Data Room Inventory:**
   - Inventory of rooms across all tenants showing: Room Name, Organization, Owner, Document Count, Total Size, Status (`DRAFT`, `ACTIVE`, `ARCHIVED`, `CLOSED`).
   - Filterable by status or tenant organization.

---

### 3.2 Screen 2: System Operational Health & Performance (`/sysop/operations`)

Provides real-time health telemetry across all core infrastructure components, background workers, and storage providers.

#### Components:
1. **Infrastructure Component Health Grid:**
   - **PostgreSQL Database:** Active connections, idle connections, max connections, transaction latency, database disk usage.
   - **Redis Store:** Memory used, connected clients, hit/miss ratio, key count.
   - **Storage Provider (Local / S3 / Azure):** Connectivity health, latency, total object count (Original Blobs vs. Previews vs. ZIP Exports).
   - **Preview Conversion Engine (Gotenberg / LibreOffice):** Container status, conversion queue depth, average render time per page.
   - **Virus Scanner (ClamAV):** Service status, scan queue depth, clean files count, quarantined threat count.
   - **Email Service (SMTP / Provider):** Delivery queue status, bounce rate, delivery error counts.
2. **BullMQ Job Queue Telemetry & Management:**
   - Real-time status for all 4 queue priority channels (`High`, `Normal`, `Low`, `Scheduled`):
     - Active Jobs, Waiting Jobs, Delayed Jobs, Failed Jobs.
   - Detailed view for worker types: `general-worker`, `preview-worker`, `scan-worker`, `report-worker`.
   - Actions: Batch Retry Failed Jobs, Purge Dead-Letter Queue, Pause/Resume Queue Processing.
3. **Storage Allocation & Growth Chart:**
   - Historical storage consumption chart (30-day / 90-day growth).
   - Breakdown of storage by media type (PDFs, Office docs, Images, Preview PNGs, Thumbnails, Temp Exports).

---

### 3.3 Screen 3: Platform Security, Audit & Forensics (`/sysop/security`)

Provides real-time security observability and threat detection across all platform tenants.

#### Components:
1. **Real-Time Security Event Stream:**
   - Unified audit stream for security events: `USER_PASSWORD_RESET`, `LOGIN_FAILED`, `RATE_LIMIT_EXCEEDED`, `IP_BLOCKED`, `TWO_FACTOR_FAILED`, `SESSION_REVOKED`.
   - Live filter controls by event type, IP address, email fingerprint, date range, or organization.
2. **Password Reset & Auth Abuse Monitor:**
   - Detailed monitoring table for password reset requests:
     - Target Email / Fingerprint, IP Address, Delivery Status (`QUEUED`, `PROVIDER_ACCEPTED`, `QUEUE_RETRYING`, `NEUTRAL_STALE`), Supersession Count.
   - **Bot Probe Detector:** Highlights anomalies such as SMS-gateway sweeps (e.g. `@txt.att.net`), rapid-fire single-IP requests, or unmapped email probes.
3. **SysOp Break-Glass Audit Trail:**
   - Dedicated audit log recording every action taken by System Operators (tenant suspensions, quota changes, user force-logouts, break-glass room access).
4. **Platform Security Controls:**
   - **Global Security Freeze Toggle:** Emergency switch to pause all state mutations platform-wide during active incidents.
   - **Global IP Blocklist Manager:** Add/remove IP addresses or CIDR blocks from platform-wide blocklists.

---

## 4. API Specification (`src/app/api/sysop/*`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/sysop/health` | `GET` | Aggregated health check of DB, Redis, Storage, Gotenberg, ClamAV, and SMTP. |
| `/api/sysop/metrics` | `GET` | Prometheus-compatible metrics endpoint (CPU, memory, storage, DB pool). |
| `/api/sysop/queues` | `GET` | BullMQ queue statistics across all worker queues. |
| `/api/sysop/queues/[queueName]/retry` | `POST` | Retry failed jobs in specified queue. |
| `/api/sysop/organizations` | `GET`, `POST` | List and provision organizations. |
| `/api/sysop/organizations/[orgId]` | `PATCH` | Update organization status, tier, or storage quota. |
| `/api/sysop/users` | `GET` | Cross-tenant user directory search. |
| `/api/sysop/users/[userId]/logout` | `POST` | Force-logout all sessions for a user globally. |
| `/api/sysop/security/events` | `GET` | Cross-tenant security event stream. |
| `/api/sysop/security/break-glass` | `POST` | Request audited break-glass access to a customer room. |

---

## 5. Enterprise Observability Integration

In addition to the Web Control Plane, VaultSpace F157 exposes standardized telemetry formats for integration with enterprise monitoring platforms:

- **Prometheus Metrics (`/api/sysop/metrics`):** Exposes counters and gauges for DB connections, active HTTP requests, job queue depths, storage usage, and error rates.
- **OpenTelemetry Tracing:** Emits traces for cross-tenant operations and preview conversion pipelines to platforms like Azure Monitor, Datadog, or Grafana Tempo.

---

## 6. Implementation Phasing

- **Phase 1 (W1-3 / Post-MVP):** Implement `/api/sysop/health` and basic `/sysop/operations` status cards.
- **Phase 2 (V1 Release):** Build `/sysop/tenants` (Organization directory & user management) and `/sysop/security` (Security event stream & password reset monitoring).
- **Phase 3 (V1.5):** Implement BullMQ queue management controls and the Zero-Trust Break-Glass audit workflow.
