# VaultSpace Backlog

> **Last Updated:** 2026-10-08
> Single list of outstanding work. `IMPLEMENTATION_STATUS.md` describes what is shipped; this file tracks what is not. GitHub issues and PRs remain the system of record for individual items.

## P0: Security and Release Blockers

- **Dependency advisories on `main`.** `npm audit` reports 1 critical (`next` 16.3.5: SSG/ISR cache poisoning, image-optimizer SSRF, metadata-route disclosure) and several high (`sharp` librsvg CVE, `source-map-js`, `tailwindcss` toolchain, `eslint-config-next` transitive). Fixes: `next` 16.4.x, `sharp` >=0.35.5. The CI Security Scan job fails on any critical, so every PR (including dependabot #185 and #186) is red until this lands. Dependabot PR #183 (`sharp` + `next`) was closed unmerged.
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
- **Azure infrastructure drift** (details in `docs/AZURE_OPERATIONAL_STATUS_2026-10-08.md`):
  - Waker and lifecycle job cron values are not in source control or validated by the deploy.
  - `worker:stale-token-cleanup` and `worker:send-pending-invites` are not deployed or repinned by any workflow; `JOB_SPECS.md` scheduled jobs (audit compaction, trash cleanup, backup snapshot) are unimplemented.
  - `infrastructure/ca-web-complete.yaml` is stale (fails the env validator, passthrough scan engine, deep readiness probe).
  - CI pushes to ACR with admin credentials; move to OIDC and disable the ACR admin user.
  - `.env.example` omits variables the deploy validator requires; `DEPLOYMENT.md` reconciler cadence (every minute) conflicts with the enforced `*/5`.
  - Hard-coded default `ACME_EMAIL` in `scripts/renew-wildcard-cert.sh`.
  - Confirm the live password-reset reconciler being disabled is intentional.
- **Standalone validation workflow** (`.github/workflows/standalone-validation.yml`) has no recorded runs; wire it to a trigger or remove it.

## P3: Post-MVP Enhancements

- Expanded document preview support (XLSX, PPTX, DOCX, CSV, Markdown, code syntax highlighting). See `DOCUMENT_PREVIEW_PLAN.md`.
- BYO custom domains (`dataroom.client.com`) with per-tenant ingress and managed certificates.
- Remaining V1+ features per `dataroom-feature-matrix-v6.md`.
