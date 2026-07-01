# VaultSpace MVP Package

Date: 2026-06-30

This package is retained as a public-safe status snapshot. Private Azure subscription, tenant, resource, revision, image, digest, budget, QA credential, and cross-project details are intentionally omitted.

## Status At A Glance

| Area                      | Current status                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Application               | Operational in Azure staging at the public VaultSpace domain                                                      |
| Web availability          | Warm public staging web surface during active development                                                         |
| Worker scaling            | Worker scales to zero when idle, with BullMQ wait-list scalers and delayed-job wake-up coverage                   |
| Redis                     | Managed Redis on a BullMQ-supported version                                                                       |
| Background services       | BullMQ worker, document preview support, scanning support, export support, and Azure Communication Services email |
| Health                    | Deep health checks passed during the stabilization sprint                                                         |
| Security dependency audit | Production dependency audit returned zero known production vulnerabilities during the stabilization sprint        |
| Local QA gate             | Lint, type-check, build, tests, and production audit passed                                                       |

## Completed In This Stabilization Sprint

- Deployed and verified worker/email fixes for password reset, digest, upload, preview, export, and cleanup.
- Kept the web app warm to avoid public cold starts while VaultSpace is under active development.
- Kept the worker at scale-to-zero with BullMQ-aware KEDA Redis list scalers for high, normal, and low queues.
- Added a delayed-job wake-up path so delayed BullMQ retries do not remain asleep while the worker is scaled to zero.
- Migrated Redis from an unsupported version to a BullMQ-supported managed Redis version.
- Corrected digest fan-out to suppress inactive and QA smoke recipients by default.
- Added smoke-script guards so password reset, digest, and export download emails are not sent unless explicitly enabled.
- Upgraded the local runtime/security stack and cleared known production runtime audit findings.

## Active Launch Blockers

1. Complete the manual MVP QA pass from `QA_TEST_PLAN.md`.
2. Complete cross-browser and per-resource accessibility QA.
3. Confirm Docker Compose self-hosting still starts cleanly.
4. Confirm the production/tag-based deployment decision for the beta path.

## Passive Monitoring Items

- Web warm-replica cost is intentional while active development and public responsiveness matter.
- Worker scale-to-zero is acceptable while BullMQ wait-list scaling and delayed wake-up checks continue succeeding.
- Monitor delayed wake-up executions after image deployments and Redis secret rotations.
- Keep rollback infrastructure only through the approved observation window and do not delete it without fresh explicit cleanup approval.
- Track the Next.js `middleware.ts` to `proxy.ts` deprecation separately because it requires a file move.
- Address existing React `act(...)` warnings and PDF.js CDN worker use as cleanup items unless the beta requires no-CDN operation.

## Release Status

This 2026-06-30 package has been superseded by the public-safe July 1 release and closeout notes:

- `docs/RELEASE_NOTES_2026-07-01.md`
- `docs/VAULTSPACE_ACTIVE_ITEMS_CLOSEOUT_2026-07-01.md`
- `CHANGELOG.md`
