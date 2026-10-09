# VaultSpace Backlog

> **Last Updated:** 2026-10-09
> Single list of outstanding work. `IMPLEMENTATION_STATUS.md` describes what is shipped; this file tracks what is not. GitHub issues and PRs remain the system of record for individual items.

## P0: Security and Release Blockers

- **Manual MVP QA pass** per `QA_TEST_PLAN.md` (auth, rooms, upload, scan, preview, public viewer, permissions, digest, export, trash/restore, audit trail).
- **Accessibility QA:** manual per-resource, document viewer, public viewer, keyboard, focus-order and screen-reader review (automated axe scans already run in CI).
- **Self-host smoke:** confirm Docker Compose starts cleanly end to end on an approved remote runner, not the owner's workstation.
- **Production deployment path:** tag-based production deploy is still deferred; define and verify before public beta.

## P1: Security Follow-up, Open Pull Requests and Issues

- **Residual dependency advisories:** fresh audit of `e7ee77d` reports 0 critical, 15 high, 6 moderate, 0 low. CI Security Scan passes. The critical blocker was closed by #188; remaining findings need reachability review and bounded remediation. #193 applies the rendering dependency updates.

- **Notification bell correction prepared in #194 (2026-10-09):** both header implementations link to the existing notification-preferences page with an accurate accessible label; the fabricated unread dot is removed. Only `DockHeader` renders in the current application. Browser regression coverage exercises its pointer and keyboard navigation on desktop and mobile. Claude approved the preferences-only scope; final merged-main checks, deployment, and staging admin/viewer verification remain release gates.
- **In-app notification inbox remains open:** draft #157 supplies a reader/menu and one producer: `src/app/api/auth/register/route.ts` creates a `Welcome to the data room` notification on invitation registration. It has no event-driven producer. Before extraction, define the event sources, recipient policy, deduplication and retry behavior; add appropriate database isolation and recipient-scoped reads/writes; prevent stale reads and mutations across organization switches; define older-unread pagination and mark-all semantics; and test error recovery, keyboard access, and cross-member/cross-organization isolation. The interim bell should later become a real inbox or be replaced with a settings icon if preferences remain its purpose. Keep #157 unmerged and unrelated profile/NDA and infrastructure changes out of the bell fix.

- Draft PR #157: secure profiles, notification inbox, and release gates.
- Dependabot PR #180: `vitest` 3.x to 5.x is a separate major migration with failing test/type checks; it is not required to clear the already-remediated critical audit findings.
- Dependency PRs #185, #186, #190, and #191 were superseded by the tested updates in #193 and are closed.
- Issue #93: viewer document Back action loses folder context.
- Roadmap issues #175 (schedule stale email-verification token cleanup), #176 (validate tenant backup/restore before destructive lifecycle actions), #177 (purge stale org-less unverified registrations), #178 (evaluate privacy-preserving registration CAPTCHA).

## P2: Technical Debt and Architecture

- **Contextual help and tooltips:** expand consistent explanations of current state, benefits, restrictions, and available actions across sharing, permissions, room settings, and document controls. The room-guidance increment prepares visible draft/access labels, clearer publishing copy, standard-folder discovery, and reusable hover/focus help with click/tap access. Keep essential warnings visible, support Escape and focus return, and avoid nested interactive controls. Earlier room-navigation plans covered only the one-time list-mode hint, not this broader help pass. This increment awaits PR validation and release; wider coverage remains open.

- **Unused application shell cleanup:** remove unused `src/components/layout/header.tsx` and `src/components/layout/app-shell.tsx` (`AppShell`) in a separate cleanup after rechecking references. `DockHeader` is the active header. No removal is included in #194.

- **Service-layer bypass.** About 68 API route files under `src/app/api/` write to the database directly instead of going through `src/services/` (4 services today). Audit for tenant scoping and event emission, then migrate mutations into CoreServices.
- **Scan pipeline residuals** from the July scan-gating pass: CLEAN/INFECTED scan-worker side-effect isolation, `/api/search` legacy-row snippets, `scanProcessor` payload-key binding, ClamAV throw-in-callback, deterministic preview job id from the scan worker (PR #91 closed unmerged).
- **Next.js middleware deprecation:** migrate `src/middleware.ts` to `proxy.ts` (requires separate approval).
- **Retention-date test portability:** `src/app/api/rooms/[roomId]/trash/route.test.ts` assumes calendar days equal 24-hour periods. Local America/Los_Angeles runs crossing daylight-saving boundaries can report 24 rather than 23 days remaining. Verify intended calendar-day semantics and make the test deterministic in a separate change.
- **Test hygiene:** React `act(...)` warnings; PDF.js worker loaded from a CDN (blocks no-CDN deployments).
- **CI runtime:** `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 runtime and are being forced to Node 24.
- **Azure infrastructure drift** (read-only evidence in `docs/AZURE_OPERATIONAL_STATUS_2026-10-08.md`):
  - Waker (`*/5 * * * *`) and lifecycle (`0 6 * * *`) cron values are documented but not enforced by deploy validation. Adding enforcement remains approval-gated.
  - **Maintenance scheduling:** no jobs exist for `worker:stale-token-cleanup` or `worker:send-pending-invites`; schedule or explicitly retire them after review. `JOB_SPECS.md` audit compaction, generic expiry/trash cleanup, and backup snapshot schedules are not implemented.
  - Live web readiness is deep and writes a Redis health key. Design bounded, nonmutating dependency readiness separately; quick liveness alone does not prove dependency readiness. The example in #187 preserves the reviewed behavior pending that decision.
  - Identity, credential-backing, resilience, network, recovery, and certificate-retention decisions are tracked privately. Review recommendations before any live change.
  - #192 deployed initial email submission/reconciler failure coverage. Endpoint availability, missing execution/ingestion detection, and notification receipt remain separate work; preserve existing resource-pressure alerts.

- **Standalone full-stack evidence:** the existing path-filtered workflow now runs on this review PR. Complete and review an approved full-stack smoke run before launch; that job is skipped on ordinary PR runs.

### Released fixes and corrections in #187

- #188 fixed verification-email provider operation IDs and closed the critical Next.js/tinypool audit blocker.
- #192 added safe invitation telemetry, email failure monitoring, and preview authentication correction.
- #193 added download/thumbnail authentication corrections, rendering dependency updates, and remote Linux native-image checks.

The Azure-review corrections below merged in #187. Its post-merge deployment succeeded, and quick health verified release `f4ea4b3` on 2026-10-09. C1–C7 remain recommendations requiring separate owner approval.

- Corrected the claim that standalone validation lacked a trigger: it has path-filtered PR triggers and a manual full-stack path, and this review produced recorded runs.
- Removed the hard-coded ACME email fallback after owner-approved staging secret creation; the monthly workflow now passes `ACME_EMAIL`. No renewal was triggered.
- Corrected the disabled-reset-reconciler inference: the scheduled job is enabled and runs every 15 minutes; web health is process-local.
- Confirmed all four scheduled jobs use the current worker digest; no stale-token/pending-invite deployments exist to repin.
- Regenerated the web YAML from live settings with placeholders; marked the probe-only YAML as a non-deployable excerpt.
- Added deployment-required variable names and role-specific placeholders to `.env.example`; corrected the email-verification cadence to every five minutes and aligned configuration-source pointers.
- Marked the proposed `JOB_SPECS.md` cron table as unimplemented, and documented actual Container Apps Jobs separately.
- Corrected assumptions about absent monitoring and rollback compute: existing alerts were inventoried; no obvious duplicate running rollback compute was found in the reviewed group.

## P3: Post-MVP Enhancements

- Expanded document preview support (XLSX, PPTX, DOCX, CSV, Markdown, code syntax highlighting). See `DOCUMENT_PREVIEW_PLAN.md`.
- BYO custom domains (`dataroom.client.com`) with per-tenant ingress and managed certificates.
- Remaining V1+ features per `dataroom-feature-matrix-v6.md`.
