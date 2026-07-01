# VaultSpace Active Items Closeout

Date: 2026-07-01

Scope: closeout of the approved six-item next sprint sequence for the VaultSpace Azure staging environment. This tracked version is public-safe and intentionally omits exact Azure subscription IDs, resource IDs, image digests, Key Vault identifiers, and job execution identifiers.

## Executive Status

VaultSpace staging is deployed and operational at `https://www.vaultspace.org` on the final July 1, 2026 image set. Web, worker, KEDA worker scaling, delayed-job wake-up, public-link security checks, no-email worker smoke, scale-from-zero worker smoke, and representative browser/accessibility checks passed after the dashboard contrast and RLS bootstrap fixes.

The remaining items that are not fully closed are release-management decisions or tooling/human-QA items, not live-environment blockers:

- Full 63-feature manual QA checklist in `QA_TEST_PLAN.md` still requires a human pass before public beta claims.
- Docker Compose start smoke could not be run in this shell because Docker Compose is not installed.
- Production or tag-triggered deployment remains deferred. The recommended release posture is private beta candidate, not production promotion.

## Final Deployment

| Item                    | Value                                 |
| ----------------------- | ------------------------------------- |
| Environment             | Azure staging                         |
| Public URL              | `https://www.vaultspace.org`          |
| Release candidate       | `v0.1.0-beta.1`                       |
| Source commit           | Local `v0.1.0-beta.1` tag target      |
| Web app                 | Final July 1 image deployed and ready |
| Worker app              | Final July 1 image deployed and ready |
| Delayed waker job image | Final July 1 worker image deployed    |

Exact Azure deployment identifiers are intentionally omitted from this tracked closeout. The configured `.dockerignore` exclusions for `.env`, `.env.*`, and `.private` remained in effect during image builds.

## Active Item Status

| #   | Sprint item                                        | Status                            | Evidence                                                                                                                                                                                                                   |
| --- | -------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Latest-code Azure deployment and no-email smoke    | Complete                          | Web and worker images were updated, the delayed waker image was updated, no-email smoke passed 9 of 9 runnable checks with 2 intentional email skips, and scale-from-zero no-email smoke passed from zero worker replicas. |
| 2   | Durable QA account and smoke-secret handling       | Complete for staging              | Dedicated QA account created through app registration without email send. Credentials are stored outside the repo in an operator-managed secret store. Values were not printed or committed.                               |
| 3   | Manual QA pass against MVP checklist               | Partially complete                | Automated worker-flow, health, security E2E, browser, and accessibility checks passed. Full human/manual pass through `QA_TEST_PLAN.md` remains required before public beta claims.                                        |
| 4   | Chromium-family browser and accessibility closeout | Complete for representative smoke | System Chrome and Microsoft Edge smoke passed landing, login, dashboard, rooms, settings, and mobile login. Axe WCAG 2.1 A/AA smoke passed seven representative pages after dashboard contrast fix.                        |
| 5   | Release packaging                                  | Mostly complete                   | `CHANGELOG.md` and `docs/RELEASE_NOTES_2026-07-01.md` created. Docker Compose start smoke blocked by missing Compose tool.                                                                                                 |
| 6   | Production/tag-based deployment decision           | Complete as decision              | Do not promote to production yet. Use `v0.1.0-beta.1` only as a private beta candidate. Keep tag-triggered production workflow deferred until manual QA and Docker Compose tooling are closed.                             |

## Verification Results

Local checks after the final RLS and dashboard contrast fixes:

| Check                                             | Result                  |
| ------------------------------------------------- | ----------------------- |
| `npm run lint`                                    | PASS                    |
| `npm run type-check`                              | PASS                    |
| Focused Vitest security/worker/export/email tests | PASS, 6 files, 50 tests |
| `npm audit --omit=dev`                            | PASS, 0 vulnerabilities |

Azure post-deploy checks:

| Check                    | Result                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- |
| Deep health              | PASS, `status=healthy`, `mode=azure`, `degraded=[]`                          |
| Web traffic              | PASS, 100 percent latest revision traffic, warm staging web replica retained |
| Worker readiness         | PASS, scale-from-zero retained with one-replica maximum                      |
| KEDA high queue          | PASS, high-priority BullMQ wait-list scaler configured with TLS              |
| KEDA normal queue        | PASS, normal-priority BullMQ wait-list scaler configured with TLS            |
| KEDA low queue           | PASS, low-priority BullMQ wait-list scaler configured with TLS               |
| Delayed waker manual run | PASS, manual execution succeeded on the final worker image                   |
| Delayed waker schedule   | PASS, recent scheduled executions succeeded after deployment                 |

The final delayed-waker execution record was retained by Azure, but replica logs were no longer available when fetched. Earlier manual waker logs showed the expected no-op behavior on empty queues with promoted `0` and failed `0`; the final record confirms job completion on the final image.

Security E2E against the final deployment:

| Check                 | Result                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Public expired link   | PASS, GET and POST expired links returned `410`                                                        |
| Password link         | PASS, public info, missing password, wrong password, and correct password paths                        |
| Cross-tenant rooms    | PASS, Org-A cannot see Org-B rooms                                                                     |
| Header/query spoofing | PASS, request organization override attempts ignored                                                   |
| Viewer sessions       | PASS, Org-A and Org-B viewer sessions cannot cross org scope, 14 of 14 Playwright request tests passed |

No-email worker-flow smoke against the final deployment:

| Check                 | Result                                              |
| --------------------- | --------------------------------------------------- |
| Health deep           | PASS                                                |
| Password reset        | SKIP by design because `QA_ALLOW_EMAIL_TESTS=false` |
| Login                 | PASS                                                |
| Temporary room create | PASS, room closed during cleanup                    |
| Upload document       | PASS                                                |
| Worker processing     | PASS, `scanStatus=CLEAN`, `previewStatus=READY`     |
| Preview               | PASS, `text/plain`, 155 bytes                       |
| Digest email          | SKIP by design because `QA_ALLOW_EMAIL_TESTS=false` |
| Export                | PASS, `sendEmail=false`, job completed              |
| Cleanup               | PASS                                                |

Smoke log files on disk, ignored by git:

- Final no-email worker smoke log: 9 passed, 0 failed, 2 skipped.
- Final scale-from-zero smoke log: pre-check showed zero worker replicas, smoke passed 9 runnable checks, and post-check showed the worker replica had stopped after processing.

Browser and accessibility checks:

| Check                                 | Result                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| System Chrome browser smoke           | PASS, landing, login, dashboard, rooms, settings, mobile login |
| Microsoft Edge browser smoke          | PASS, landing, login, dashboard, rooms, settings, mobile login |
| System Chrome axe public pages        | PASS, Landing, Login, Register, Forgot Password                |
| System Chrome axe authenticated pages | PASS, Dashboard, Rooms, Settings                               |

The first accessibility pass found one dashboard `color-contrast` issue in `src/components/dashboard/WelcomeBanner.tsx`. The final deployment changes the onboarding description text from `text-primary-100` to `text-white`; the post-deploy axe rerun passed.

RLS bootstrap fixes verified in staging:

- `src/app/api/links/[slug]/route.ts`: public unauthenticated link bootstrap lookups now use `bootstrapDb` so RLS does not hide public links before organization context is known.
- `src/lib/viewerSession.ts`: cookie-backed viewer-session bootstrap lookups now use `bootstrapDb` so valid public viewer sessions are resolved before route-specific `withOrgContext()` checks run.
- `tests/e2e/security.test.ts`: security setup now ensures active test rooms before creating public links, avoiding false negatives caused by closed historical QA rooms.

## QA Credential Handling

Dedicated staging QA credentials are stored outside the repo in an operator-managed secret store. Secret values were not printed, committed, or copied into tracked docs.

Future smoke command pattern:

```bash
QA_BASE_URL=https://www.vaultspace.org \
QA_USER_EMAIL="$QA_USER_EMAIL" \
QA_USER_PASSWORD="$QA_USER_PASSWORD" \
QA_ALLOW_EMAIL_TESTS=false \
QA_ALLOW_EXPORT_EMAIL=false \
node scripts/qa-worker-flow-smoke-test.js
```

Load `QA_USER_EMAIL` and `QA_USER_PASSWORD` from the operator secret store before running the command. Do not write these credential values to tracked files, logs, commit messages, or PR descriptions.

## Docker Compose Status

Docker Compose self-hosting start smoke was not run because this shell has Docker Engine but no Compose command:

- `docker --version`: available
- `docker compose version`: unavailable
- `docker-compose --version`: unavailable

The repo `docker-compose.yml` was read and remains structurally present with PostgreSQL, Redis 7, Gotenberg, ClamAV, app, and worker services. The next session should install or provide Compose outside this repo only with explicit approval for that outside-workspace change, then run:

```bash
docker compose config
docker compose up --build
curl -f http://localhost:3000/api/health
docker compose down
```

Do not claim Docker Compose launch readiness until that sequence passes.

## Remaining Human Or External Items

These are the only items not fully closed by automation in this session:

1. Human manual pass through all 63 MVP feature checks in `QA_TEST_PLAN.md`.
2. Docker Compose start smoke after Compose tooling is available.
3. Decision to push the local Git tag or open a GitHub release. Local docs recommend `v0.1.0-beta.1` as the private beta candidate label, but production deployment remains deferred.
4. Optional intentional email smoke with `QA_ALLOW_EMAIL_TESTS=true` and `QA_ALLOW_EXPORT_EMAIL=true` should be scheduled sparingly to avoid repeated user email.

## References

- `src/components/dashboard/WelcomeBanner.tsx`
- `src/app/api/links/[slug]/route.ts`
- `src/lib/viewerSession.ts`
- `tests/e2e/security.test.ts`
- `scripts/qa-worker-flow-smoke-test.js`
- `docs/RELEASE_NOTES_2026-07-01.md`
- `docs/VAULTSPACE_MVP_PACKAGE_2026-06-30.md`
- `QA_TEST_PLAN.md`
