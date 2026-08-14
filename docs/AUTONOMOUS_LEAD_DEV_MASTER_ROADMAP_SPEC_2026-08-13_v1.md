# VaultSpace Autonomous Lead Dev Master Roadmap & Feature Specification

- **Date:** 2026-08-13
- **Status:** Approved User Directives for Autonomous Sprint
- **Target Workloads:** Azure Staging (`rg-vaultspace-staging`) & Production
- **Runner Configuration:** Autonomous 24/7 Lead Dev Host (Azure VM, OpenClaw WhatsApp Notifications, Azure OpenAI Credits)

---

## 1. Executive Overview

This document serves as the **authoritative product and architecture specification** for Lead Dev and the Multi-Agent Review Board. It captures all user-approved directives, custom feature additions, and security boundaries across the 5 roadmap clusters.

Lead Dev and the Review Board (Advisor, Historian, Simplifier) will execute these specifications sequentially in the isolated Staging Environment (`rg-vaultspace-staging`), deploying release updates and pushing notifications to **OpenClaw WhatsApp**.

---

## 2. Detailed Cluster Specifications

### Cluster 1: SysOp DevOps Control Plane (F159) & Platform Telemetry
- **Route Isolation:** `/sysop/*` (separate from tenant admin `/admin/*`). Mandatory 2FA and dedicated session token (`vaultspace-sysop-session`).
- **Maintenance Policy:** Short zero-downtime deploys (<5 min) execute automatically. Longer maintenance runs schedule for **Saturday night / Sunday morning, 12:00 AM – 1:00 AM Pacific Time**.
- **Storage Quota Engine:** Automated email notifications sent to organization owners when storage reaches **90%** and **98%** of quota.
- **Pluggable Infrastructure Telemetry:** Implements `PlatformMetricsProvider`. When on Azure, displays Azure Container Apps CPU/RAM and PostgreSQL IOPS. On private Linux servers, degrades gracefully to standard container metrics without vendor lock-in.
- **Live Agent Progress Tab (`/sysop/runner`):** Real-time dashboard showing active Lead Dev unit, subagent review status, test pass rate, and staging deployment log.
- **Zero-Trust Break-Glass Boundary:** SysOps cannot inspect customer documents without executing a logged, time-bound (1-hour) Break-Glass request with mandatory `EventBus` audit trail.

### Cluster 2: Advanced Analytics, Per-Viewer Heatmaps & AI Query (F027, F028, F031)
- **Per-Viewer Page Heatmaps (F028):** Visual page-by-page time breakdown rendered for **individual viewers** (e.g. exact pages read and time spent by specific investors) as well as room aggregates.
- **AI Natural Language Analytics Assistant:** Integrated chat assistant on the Analytics screen allowing admins to query analytics in natural language (e.g., *"Show me what pages Mark Munger viewed"*, *"Which investors spent >10 minutes on the Cap Table?"*).
- **Flexible Scheduled Digests (F031):** Admins can configure digest emails to **Daily**, **Weekly (selectable day of week)**, or **Off**.
- **Initial View Alerts:** Omitted (no instant email/push on first view to avoid notification fatigue).

### Cluster 3: Document Intelligence, Custom Binders & Change Intelligence (F112, F013, F156)
- **Viewer Version Diffing (F112):** Both Viewers and Admins can view side-by-side or inline text diffs for published document revisions.
- **Customizable PDF Deal Binders (F156):** Admins can compile master PDF Deal Binders with folder selection/exclusion, custom cover page titles, disclaimers, and org branding/logos.
- **AI Change Intelligence Suite:**
  - *Version Change Summary:* Automatic 3-bullet AI summary generated on new document version upload.
  - *What Changed Since My Last Login:* Personalized AI welcome widget on room entry showing new documents, updated versions, and Q&A activity since previous session.
  - *Date-Range Change Summarizer:* Admins and Viewers can select any date range (e.g. *July 1 – August 13*) and generate an AI executive summary of all data room activity.

### Cluster 4: Legal, Compliance & NDA Gates (F018, F055, F133, F157)
- **Custom NDA Text & HTML (F018):** Admins can paste custom NDA text or HTML formatting per room, or select from built-in legal templates.
- **1-Click NDA Re-Acknowledgement Reset:** Admins can trigger a global NDA reset, forcing all returning viewers to sign updated agreement terms on their next login.
- **Streamlined Legal Hold (F157):** Standard admin role authorization governs Legal Hold locks (disabling document deletion and trash purging during hold).

### Cluster 5: Developer Platform, API Keys & Webhooks (F135, F058, F061)
- **Org-Scoped REST API Keys (F135):** Organization Admins can generate API keys (`vk_live_...` / `vk_test_...`) scoped to their specific organization and RLS boundaries, with fine-grained access levels (Read-only, Upload-only, Full Admin). Keys stored as SHA-256 hashes.
- **Core Webhooks Engine (F058):** Event notifications via HTTP POST (`document.viewed`, `nda.accepted`, `access_request.created`, `signature.completed`) signed with HMAC SHA-256 header.
- **Deferred Third-Party Integration Templates:** Pre-built Zapier/HubSpot templates deferred to future release.
- **Future Cloud Folder Importer (V2/V3):** Bulk folder mount/import from Dropbox, Box, OneDrive, or AWS S3 recorded for future implementation.

---

## 3. Autonomous Execution Protocol

1. **Runner Host:** Azure Linux VM (`Standard_D4s_v5`, 4 vCPU, 16GB RAM) running 24/7.
2. **Azure Subscription Isolation Guardrail (CRITICAL):** All provisioning scripts, resource groups, VM runners, and deployment keys are strictly restricted to the **Munger Azure Subscription**. Pre-flight scripts execute `az account show` and hard-abort if any `medau` subscription or non-Munger account is detected.
3. **AI Inference Provider:** Azure OpenAI Service (`aoai-vaultspace-staging`) funded by Munger Azure credits.
4. **Alerting Pipeline:** OpenClaw WhatsApp Webhooks push instant mobile alerts for Unit Completions, Human Sign-Off Gates, and Security Alerts.
5. **Pre-Flight Review Board:** Before coding each unit, the 3-Gate Review Board (Historian, Simplifier, Advisor) pre-validates architectural alignment, enforces low complexity, and verifies security invariants.

---

## 4. Final Review Board Technical Guardrails

To guarantee 100% security, performance, and stability during autonomous execution, Lead Dev must enforce the following three guardrails:

1. **AI RLS Security Guard (CRITICAL):** All AI Data Retrieval Tools (Natural Language Analytics Assistant, Change Intelligence Summarizer) must execute strictly within the Prisma RLS middleware context with explicit `organizationId` filtering to prevent cross-tenant prompt injection or data leakage.
2. **Async Worker Queue for Deal Binders (F156):** Compiling master PDF Deal Binders must execute asynchronously in a background BullMQ worker (via Gotenberg) to prevent web HTTP timeouts.
3. **Partition-Bounded EventBus Queries:** All AI date-range change queries on the `EventBus` must include explicit time bounds matching monthly partitions to prevent full-table database scans.

---

## 5. Final Technical Sign-Off
- **Claude (Master Spec Auditor):** APPROVED (100% Complete with Technical Guardrails)
- **Codex (Infra & Execution Auditor):** APPROVED (100% Technical Sign-Off for Azure Staging Launch)
