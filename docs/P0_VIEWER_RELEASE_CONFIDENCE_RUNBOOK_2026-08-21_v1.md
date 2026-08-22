# P0 Viewer Release Confidence Runbook

## Purpose

This runbook defines the release gate for external-viewer navigation, database-backed access-mutation concurrency, and public-viewer accessibility. It is intentionally safe for Brightside Group S.A., which is a pseudo-production organization and is never used for write testing, fixture creation, deletion, or cleanup.

## Durable QA tenant

Use a dedicated, non-Brightside organization named `VaultSpace Release QA`. Its rooms, users, and share links must be synthetic and may contain only non-sensitive test documents. The QA tenant is the only permitted deployed-environment target for write-capable release validation.

The release coordinator records these values in the approved secrets store, never in the repository or test output:

- QA organization ID and slug
- designated administrator and viewer test identities
- a QA-only external share-link URL or token
- the release SHA and validation timestamp

The coordinator must verify the tenant identity before every run. If the identity resolves to Brightside or is ambiguous, stop the run before any state-changing request.

## Required automated gate

CI must pass all of the following before deployment:

1. Formatting, lint, type checking, unit tests, and build.
2. The PostgreSQL RLS integration suite on a disposable local database. The direct-access concurrency cases must prove a competing database backend is waiting on the advisory lock before the mutation transaction is allowed to commit.
3. External-viewer browser coverage on Chromium, Firefox, and WebKit:
   - a document opened from a nested folder returns to that folder using Back;
   - an invalid or inaccessible `folderId` resolves safely to the room root;
   - the external viewer list and document pages have no WCAG 2.1 A or AA axe violations;
   - existing security, user-action, and room-interaction browser checks remain green.

## Deployed verification procedure

After the deployment reports healthy, use the approved QA tenant only:

1. Open the QA-only share link in a private browser profile.
2. Complete asserted-email access with the QA viewer identity.
3. Open a nested folder, open one document, select **Go back**, and confirm the original folder remains selected and visible.
4. Open a direct document URL without `folderId`; select **Go back** and confirm safe room-root fallback.
5. Attempt a stale or unauthorized `folderId`; confirm safe room-root fallback and no disclosure of unavailable folders or documents.
6. Confirm preview, download permission, viewer session, and share-link counter behavior remain normal.
7. Record release SHA, test timestamp, browser/version, tester, and result in the release evidence location. Do not store share tokens, passwords, asserted email addresses, or document content in the evidence record.

## Strawman, Steelman, and Pre-Mortem

### 1. Viewer folder-context navigation

**Strawman:** rely on browser history for Back behavior. This appears small, but it fails for direct links, refreshed pages, copied URLs, and stale folder context.

**Steelman:** retain only the originating folder ID in the document URL, let the existing access-scoped documents API resolve it, and replace invalid or inaccessible context with the room root. This preserves navigation without trusting a client-provided folder path or weakening link scope.

**Pre-Mortem:** a viewer reaches a folder they are not allowed to see through a manipulated query string. Early warning is a non-root page rendering after an invalid or unauthorized `folderId`. Mitigation is the API folder-context resolution plus the stale-context E2E regression.

### 2. Database-backed concurrency gate

**Strawman:** start two promises and infer concurrent lock contention from their final results. This can pass if the scheduler lets the first transaction commit before the second transaction reaches the lock.

**Steelman:** hold the first transaction, capture the second PostgreSQL backend PID, prove that backend is waiting on an ungranted advisory lock through `pg_locks`, then permit the first transaction to commit. The business assertion remains unchanged: the second transaction must re-read the post-archive or post-reconciliation state and deny the stale change.

**Pre-Mortem:** CI reports a green concurrency test even though no real collision occurred. Early warning is a test that succeeds without observing a waiting advisory lock. Mitigation is a hard failure after a bounded five-second observation window.

### 3. Durable QA tenancy

**Strawman:** use Brightside as a convenient test fixture because it has realistic rooms and users. This risks altering or exposing pseudo-production data and makes test cleanup unsafe.

**Steelman:** maintain a dedicated synthetic QA organization with QA-only identities and links, retain only its identifiers in the approved secret store, and prohibit Brightside writes. This makes verification repeatable and preserves a clear audit boundary.

**Pre-Mortem:** a tester unknowingly uses a real Brightside share link. Early warning is an organization name, slug, or room name that does not match the designated QA tenant. Mitigation is a preflight identity check and an immediate stop on any mismatch.

### 4. Public-viewer accessibility and browser compatibility

**Strawman:** scan only landing and authenticated admin pages in Chromium. It misses the most important external path and browser-specific behavior.

**Steelman:** run automated WCAG 2.1 A/AA scans on actual asserted-email viewer pages and execute the same release browser suite in Chromium, Firefox, and WebKit. Pair it with the manual private-window deployed check for behavior that automation cannot fully establish.

**Pre-Mortem:** an outside viewer cannot operate document navigation in Safari or with a keyboard. Early warning is a WebKit failure, an axe violation, or an unnamed control. Mitigation is mandatory multi-browser CI, accessible control names, and the deployed QA procedure above.

## Rollback criteria

Do not promote a release, or roll back a newly deployed revision, if any of the following occur:

- an external viewer can reach a document or folder outside the share-link scope;
- the viewer cannot return safely to the originating context or room root;
- the concurrency test fails to observe real lock contention or allows a stale grant/update;
- any WCAG 2.1 A or AA violation appears on the external viewer flow;
- a QA run targets Brightside or uses non-synthetic data.

## References

- GitHub issue #93, Viewer document Back action loses folder context
- `tests/e2e/viewer-navigation.test.ts`
- `tests/integration/user-access-mutation-lock.integration.test.ts`
- `tests/e2e/a11y.test.ts`
