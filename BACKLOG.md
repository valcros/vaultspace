# VaultSpace Backlog

> **Last Updated:** 2026-10-08
> Single list of outstanding work. `IMPLEMENTATION_STATUS.md` describes what is shipped; this file tracks what is not. GitHub issues and PRs remain the system of record for individual items.

## P0: Security and Release Blockers

- **Dependency advisories on `main`.** Fresh `npm audit --json` on 2026-10-08 reports 3 critical, 10 high, 6 moderate, and 1 low findings across runtime and development dependencies. Critical entries include `next` 16.3.5 (including the `next/og` ImageResponse advisory), `vitest`, and transitive `tinypool`. Remediate in a separately approved PR: Next.js 16.4.x with aligned tooling, sharp >=0.35.5, and the remaining critical development dependencies. Re-audit the final lockfile; upgrading only Next.js/sharp is not sufficient evidence that CI is clear. Application exploitability was not tested.
- **Manual MVP QA pass** per `QA_TEST_PLAN.md` (auth, rooms, upload, scan, preview, public viewer, permissions, digest, export, trash/restore, audit trail).
- **Accessibility QA:** manual per-resource, document viewer, public viewer, keyboard, focus-order and screen-reader review (automated axe scans already run in CI).
- **Self-host smoke:** confirm Docker Compose starts cleanly end to end.
- **Production deployment path:** tag-based production deploy is still deferred; define and verify before public beta.

## P1: Open Pull Requests and Issues

- Draft PR #157: secure profiles, notification inbox, and release gates.
- Dependabot PR #180: `vitest` 3.x to 5.x (major; also clears the dev-only `vitest`/`tinypool` critical advisory).
- Dependabot PRs #185 (`markdown-it`) and #186 (`dompurify`): blocked only by the P0 audit failure above.
- Issue #93: viewer document Back action loses folder context.
- Roadmap issues #175 (schedule stale email-verification token cleanup), #176 (validate tenant backup/restore before destructive lifecycle actions), #177 (purge stale org-less unverified registrations), #178 (evaluate privacy-preserving registration CAPTCHA).

## P2: Technical Debt and Architecture

- **Service-layer bypass.** About 68 API route files under `src/app/api/` write to the database directly instead of going through `src/services/` (4 services today). Audit for tenant scoping and event emission, then migrate mutations into CoreServices.
- **Scan pipeline residuals** from the July scan-gating pass: CLEAN/INFECTED scan-worker side-effect isolation, `/api/search` legacy-row snippets, `scanProcessor` payload-key binding, ClamAV throw-in-callback, deterministic preview job id from the scan worker (PR #91 closed unmerged).
- **Next.js middleware deprecation:** migrate `src/middleware.ts` to `proxy.ts` (requires separate approval).
- **Test hygiene:** React `act(...)` warnings; PDF.js worker loaded from a CDN (blocks no-CDN deployments).
- **CI runtime:** `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 runtime and are being forced to Node 24.
- **Azure infrastructure drift** (read-only evidence in `docs/AZURE_OPERATIONAL_STATUS_2026-10-08.md`):
  - Waker (`*/5 * * * *`) and lifecycle (`0 6 * * *`) cron values are documented but not enforced by deploy validation. Adding enforcement remains approval-gated.
  - **Maintenance scheduling:** no jobs exist for `worker:stale-token-cleanup` or `worker:send-pending-invites`; schedule or explicitly retire them after review. `JOB_SPECS.md` audit compaction, generic expiry/trash cleanup, and backup snapshot schedules are not implemented.
  - Live web readiness is deep and writes a Redis health key. Decide separately whether to use quick readiness; the regenerated example intentionally preserves live behavior.
  - CI pushes to ACR with admin credentials; migrate both pushes and runtime image pulls before disabling the admin user.
  - Four web/worker secret definitions lack Key Vault backing. The deploy env validator verifies `secretRef`, not `keyVaultUrl`; review credential-source policy and strengthen validation separately.
  - Add endpoint-availability and scheduled-job failure alerting, and test notification delivery. Preserve the 14 existing app/PostgreSQL/Redis metric alerts.
  - Review PostgreSQL and Redis HA, backup/recovery objectives, public network rules, and PostgreSQL autogrow before launch. No cloud settings changed in this review.

- **Standalone full-stack evidence:** the existing path-filtered workflow now runs on this review PR. Complete and review an approved full-stack smoke run before launch; that job is skipped on ordinary PR runs.

### Closed by the 2026-10-08 Azure review

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
