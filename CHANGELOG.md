# Changelog

All notable VaultSpace changes from the current stabilization sprint are recorded here.

## [Unreleased]

Verified Azure staging code release: `e7ee77d` (#193, 2026-10-08 Pacific). Detail by PR is in `IMPLEMENTATION_STATUS.md` ("Shipped Since the July 21 Update").

### Added

- SysOp control plane (`/sysop`) with explicit platform-operator grants, audited operator access, tenant directory, organization enable/disable, and an hourly operator-continuity workflow. (#158, #163, #167)
- Self-service onboarding: email verification gate, durable verification delivery with a 5-minute reconciler job, unscheduled stale verification token cleanup script, workspace URL claim, and selectable starter folder structures. (#167 to #172, #179)
- Per-tenant backup and restore scripts (`ops:backup-org`, `ops:restore-org`).
- Admin-triggered password reset, admin user editing, and viewer-to-admin promotion confirmation. (#78, #83, #184)

### Changed

- Login, session, organization and password-reset flows run through constrained bootstrap database functions (Wave 1, #121 to #151).
- Room lifecycle is enforced and closed rooms are read-only. (#161, #162)
- Viewer invitations and room access are scoped to assigned rooms. (#152, #154)

### Fixed

- Corrected ACS verification-email operation IDs using deterministic UUIDs; remediated critical Next.js/tinypool advisories. (#188)
- Return generic authentication 401 responses on admin preview, download, and thumbnail routes while preserving serving/permission/scan behavior. (#192, #193)
- Added privacy-preserving invitation submission telemetry and initial email failure alerting; provider acceptance and alert creation are distinct from recipient receipt. (#192)
- Updated DOMPurify, markdown-it, Sharp, and transitive source-map-js; added real renderer tests and remote Linux native-image build checks. (#193)

### Security

- Rate-limited login and 2FA validation; sanitized search snippets; neutralized active content in SVG/XML previews; guarded local storage against path traversal; escaped user input in email HTML; hardened self-host Docker Compose. (#101 to #108)
- MFA sessions are bound to one-time challenges and enrollment fails closed. (#159, #160)
- Viewer shows a graceful "unavailable" state for non-servable documents. (#90)

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
