# Changelog

All notable VaultSpace changes from the current stabilization sprint are recorded here.

## [Unreleased]

### Security

- Enforced one scan-gating policy (`isServable`: only `CLEAN` or `SKIPPED` are servable) at every path that serves original bytes or a derived asset — admin and viewer download / preview / thumbnail, version rollback, preview regeneration, room export, and the preview, text-extraction, and search-index workers (which re-check the persisted scan status independently and read the DB-authoritative blob key). `INFECTED` / still-scanning / errored versions and any preview, thumbnail, search snippet, or export derived from them can no longer be served or processed. (#88)
- Serve the document's current version (`currentVersionId`), scoped by version id + document + organization, instead of the highest version number. A non-servable current version returns unavailable (admin `403` / viewer `404`, identical whether it is still scanning or blocked, with no scan-reason disclosure) and never silently downgrades to an older servable version; version rollback is now effective on the serve side. (#89)
- Hardened large-file virus scanning: files too large to scan are marked `SKIPPED` (allowed but flagged unscanned) rather than quarantined as infected; ClamAV responses are parsed structurally (threat match first, exact clean and size-limit recognition, throw on unknown); and `CLAMAV_MAX_SCAN_BYTES` is validated as a positive integer that fails closed on invalid input. (#87)

## [0.1.0-beta.1] - 2026-07-01

Private beta candidate for the VaultSpace staging environment.

### Added

- Added BullMQ delayed-job wake-up support through `npm run worker:wake-delayed`.
- Added scheduled delayed-job wake-up infrastructure for scale-from-zero delayed job promotion.
- Added no-email worker-flow smoke controls:
  - `QA_ALLOW_EMAIL_TESTS=true` is required before password reset or digest email smoke sends email.
  - `QA_ALLOW_EXPORT_EMAIL=true` is required before export smoke sends download email.
- Added export request support for `sendEmail=false` while still generating and completing export ZIP jobs.
- Added durable staging QA credential handling through an operator-managed secret store.
- Added active-room setup support to the security E2E suite so public-link security checks do not depend on historical QA room state.

### Changed

- Migrated staging Redis from Redis 6.0.14 to Azure Managed Redis Enterprise 7.4.
- Kept web Container App warm with `minReplicas=1` for active development uptime.
- Kept worker Container App at `minReplicas=0` with KEDA Redis wait-list scalers for `high`, `normal`, and `low`.
- Upgraded runtime/security stack to Next.js 16.2.9, React 19.2.7, Nodemailer 9.0.3, ESLint 9.39.4, and PostCSS 8.5.16.
- Changed dashboard onboarding description text color for WCAG contrast on the welcome gradient.

### Fixed

- Fixed password reset queueing by using supported `email.send` jobs.
- Fixed digest email queueing by using supported `email.send` room-digest jobs.
- Fixed export archive completion race that could leave BullMQ jobs active.
- Fixed worker org-scoped database access for production RLS by using `withOrgContext()` in worker processors.
- Fixed Azure Communication Services sender formatting and refreshed the worker email configuration.
- Fixed ClamAV readiness handling, including null-terminated `PONG` responses.
- Fixed repeated QA digest-email fan-out by suppressing inactive users and `+vaultspace-qa-` addresses by default.
- Fixed public share-link GET/POST bootstrap lookups under production RLS by using `bootstrapDb` before organization context exists.
- Fixed public viewer-session bootstrap lookups under production RLS so valid cookie-backed public sessions reach route-level org-scoped checks.

### Verified

- Final staging web and worker image set deployed and verified.
- Deep health passed with `status=healthy`, `mode=azure`, `degraded=[]`.
- No-email worker-flow smoke passed 9 runnable checks with 0 failures and 2 intentional email skips.
- Scale-from-zero no-email worker smoke started with zero worker replicas, passed 9 runnable checks, and observed the final worker replica stop after processing.
- Security E2E passed 14 of 14 Playwright request tests against staging.
- Delayed waker execution succeeded on the final worker image.
- System Chrome and Microsoft Edge browser smoke passed representative desktop and mobile paths.
- System Chrome axe WCAG 2.1 A/AA smoke passed seven representative pages after the dashboard contrast fix.

### Known Gaps

- Full 63-feature manual QA remains required before public beta.
- Docker Compose start smoke is blocked until Docker Compose is available in the local environment.
- Tag-triggered production deployment remains deferred by release decision.

## [ops-stabilized-20260630] - 2026-06-30

Operational stabilization tag for the Azure worker, email, and Redis work completed before the final July 1 private beta candidate packaging.
