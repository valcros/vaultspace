# P1 Release-Readiness Runbook

## Scope

This runbook covers the release-readiness controls added for self-hosted Compose startup and deployed QA smoke safety. It does not authorize production promotion, Brightside testing, or Azure infrastructure changes.

## Automated self-hosted Compose gate

`scripts/compose-release-smoke.sh` is the executable self-hosted release gate. It creates a disposable local Compose project, generates temporary in-memory credentials, starts the app and general worker, and requires the deep health contract to report:

- `status: healthy`
- `mode: standalone`
- healthy database, cache, and local-storage checks
- a running general worker

The gate always runs for relevant pull requests and `main` pushes through `.github/workflows/standalone-validation.yml`. A manually dispatched workflow with `run_full_smoke=true` also starts the preview and scan workers with their service dependencies.

The smoke script never connects to Azure, a deployed VaultSpace host, or an existing tenant. Its cleanup removes only the disposable Compose project resources it created.

## Deployed QA smoke boundary

The write-capable scripts `scripts/qa-smoke-test.js` and `scripts/qa-worker-flow-smoke-test.js` require all of the following environment variables:

- `QA_BASE_URL`
- `QA_USER_EMAIL`
- `QA_USER_PASSWORD`
- `QA_EXPECTED_ORGANIZATION_SLUG`

The expected slug must be the dedicated synthetic QA tenant. The scripts reject a `brightside` target and stop before room, document, link, export, or invitation mutations if the organization returned at login does not match the expected QA slug. Login creates a normal session and audit event, so only an approved QA identity may be provided.

Use the approved secret store for all values. Do not record passwords, session tokens, share tokens, document IDs, or other tenant data in the repository, browser traces, workflow summaries, or release notes.

## Browser release validation

After CI and deployment health pass, use only the dedicated QA tenant to run the required browser matrix:

```bash
PLAYWRIGHT_BASE_URL=https://<approved-staging-host> \
PLAYWRIGHT_WEB_SERVER_COMMAND= \
PLAYWRIGHT_ADMIN_EMAIL="$QA_ADMIN_EMAIL" \
PLAYWRIGHT_ADMIN_PASSWORD="$QA_ADMIN_PASSWORD" \
npx playwright test \
  tests/e2e/a11y.test.ts \
  tests/e2e/room-interactions.test.ts \
  tests/e2e/users-actions.test.ts \
  tests/e2e/viewer-navigation.test.ts
```

Record only the release SHA, timestamp, browser/version, QA tenant confirmation, and pass/fail result. Brightside Group S.A. remains read-only and is never a write-test target.

## Strawman, Steelman, and Pre-Mortem

### Self-hosted Compose startup

**Strawman:** document a special build argument and rely on an operator to remember it. This leaves the normal `docker compose up --build` path able to build the fail-closed Azure default and miss the production migration connection.

**Steelman:** make Compose explicitly build and run standalone mode, supply the reviewed self-hosted migration connection to the web app only, and run that ordinary path in a disposable CI Compose gate.

**Pre-Mortem:** an operator launches the documented command and the app exits before readiness. The early warning is an Azure configuration rejection or a missing `DATABASE_URL_ADMIN` entrypoint error. The mitigation is the explicit Compose contract plus the CI deep-health gate.

### QA tenant safety

**Strawman:** rely only on a written instruction not to use Brightside. A copied credential can still create rooms, links, uploads, and jobs in pseudo-production.

**Steelman:** require a synthetic QA slug and verify it against the login response before any write-capable smoke action. Brightside is explicitly rejected.

**Pre-Mortem:** an operator supplies Brightside credentials to a smoke script. The early warning is a slug mismatch immediately after login. The mitigation is an immediate stop before room or document mutations and a dedicated QA credential held only in the approved secret store.

### Browser readiness

**Strawman:** treat local unit tests as deployed browser evidence. This misses deployment configuration, browser-specific behavior, and external viewer regressions.

**Steelman:** combine CI browser coverage with a post-deploy, multi-browser QA pass against the synthetic tenant only.

**Pre-Mortem:** a release is green locally but a deployed viewer or admin path fails in Safari. The early warning is a WebKit failure or a mismatch between release health identity and the deployed SHA. The mitigation is the existing multi-browser CI matrix plus the synthetic-QA deployed validation procedure.

## References

- `docker-compose.yml`
- `scripts/compose-release-smoke.sh`
- `.github/workflows/standalone-validation.yml`
- `scripts/qa-tenant-guard.js`
- `docs/P0_VIEWER_RELEASE_CONFIDENCE_RUNBOOK_2026-08-21_v1.md`
