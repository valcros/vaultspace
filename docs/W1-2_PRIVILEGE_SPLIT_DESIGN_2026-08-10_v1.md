# W1-2 Database Privilege Split Design

- **Status:** DESIGN ONLY, awaiting Stakeholder Advisor GO
- **Freeze scope:** P0-2 public web database privilege reduction
- **Implementation authorization:** Not granted by this document

## Decision summary

Database migrations and RLS DDL will move to a dedicated one-shot migrator workload. The public web runtime will retain only the constrained application database connection plus a narrowly privileged bootstrap connection or function surface. `DATABASE_URL_ADMIN` will be removed from the web Container App only after login, session, domain, registration, password-reset, 2FA, and link bootstrap paths pass the full CloudSpace matrix.

The default mechanism is:

1. `vaultspace_app`: existing NOBYPASSRLS runtime role for tenant-context application queries.
2. `vaultspace_bootstrap`: NOBYPASSRLS login role with no broad table grants, allowed to execute reviewed `SECURITY DEFINER` functions that return or mutate only the minimum bootstrap fields.
3. `vaultspace_migrator`: DDL-capable role available only to the one-shot migrator workload.

No admin database URL will remain in a public web replica after cutover.

## Current-state observations

1. `docker-entrypoint.sh` requires `DATABASE_URL_ADMIN` in production, runs Prisma migrations, applies `prisma/rls-policies.sql`, and then starts the web process. Every new web replica therefore receives the admin URL and can attempt DDL during startup.
2. The live web Container App has both constrained `DATABASE_URL` and `DATABASE_URL_ADMIN` secret references. Its managed identity can also resolve multiple historical database secret versions.
3. The live worker Container App has no admin URL. It uses the constrained database URL and must not regress.
4. The scheduled invitation-lifecycle job currently has both constrained and admin URLs. It is not the public web process, but it remains part of the longer workload-identity split plan.
5. The deployment workflow already runs `npm run db:migrate` before updating the Container Apps, but web startup repeats migrations and RLS application.
6. `bootstrapDb` connects to `DATABASE_URL_ADMIN` when present and falls back to `DATABASE_URL` otherwise.
7. Admin-backed bootstrap usage currently includes login, registration, session validation, server-component sessions, domain and slug lookup, public branding, password reset, logout audit lookup, link bootstrap, viewer-session bootstrap, user administration, and some worker or lifecycle paths.
8. The 2FA continuation route uses the normal `db` client before organization context exists. Correct RLS can therefore brick 2FA even before the admin URL is removed.
9. Session validation uses the admin connection to find a session by token and join the user before it knows the organization.
10. The web managed identity has Key Vault references for runtime, admin, storage-key, email, Redis, and recovery secrets. This makes workload compromise broader than the database finding alone.

## Target deployment architecture

```text
main CI
  -> build immutable web, worker, and migrator artifacts
  -> capture current web and worker rollback revisions
  -> run one-shot migrator at the reviewed image digest
       -> DATABASE_URL_ADMIN only here
       -> advisory deployment lock
       -> prisma migrate deploy
       -> RLS DDL and pg_catalog verification
  -> update worker at pinned digest
  -> canary web at pinned digest without DATABASE_URL_ADMIN
  -> CloudSpace auth matrix
  -> move full web traffic
```

The migrator may be an Azure Container Apps Job named for the workload, triggered only by the deployment pipeline. It must not be a continuously running replica and must not expose ingress.

The job should use the same reviewed commit and database migration assets as the web release. A distinct migrator image is preferred if it excludes the web server and makes its command immutable. Reusing the web image with a command override is acceptable only if the pipeline verifies the image digest and command.

## Database roles and grants

### `vaultspace_migrator`

- DDL-capable and table-owning as required by Prisma migrations and RLS policy changes.
- Available only to the one-shot migrator job.
- Not mounted into web or worker configuration.
- Protected by a database advisory lock so concurrent deploy jobs cannot interleave migrations.
- Connection timeout and statement timeout set for deployment safety.

### `vaultspace_app`

- Login, NOBYPASSRLS, non-superuser, no create-role or create-database rights.
- Tenant tables accessed only under `SET LOCAL app.current_org_id` inside a transaction.
- No DDL rights.
- No direct access to provider-correlation tables already isolated from the app role.
- Existing event update and delete revocations retained.

### `vaultspace_bootstrap`

- Login, NOBYPASSRLS, non-superuser.
- No direct broad `SELECT` on `users`, `user_organizations`, `organizations`, links, invitations, sessions, or password-reset tables.
- `EXECUTE` only on reviewed functions or access to narrow views where functions are not appropriate.
- Default privileges revoked, including `PUBLIC` execute on security-definer functions.
- Function owner is a non-login owner role rather than the migrator login where practical.
- Every function sets a fixed `search_path`, schema-qualifies objects, validates input sizes, and returns a fixed column list.

## Bootstrap surface

| Flow                               | Minimum bootstrap result or operation                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Password login                     | One active user by normalized email, password hash, 2FA flags, minimal profile, and first active organization membership                        |
| 2FA continuation                   | User ID plus organization ID bound into the signed temporary token; minimal 2FA verification record and scoped session creation                 |
| Session validation                 | Session status, user ID, organization ID, expiry, minimal user-active state; tenant membership then checked with `vaultspace_app` under context |
| Registration and invitation accept | Invitation by unguessable token, intended email and organization, minimal organization state, atomic user and membership transition             |
| Domain and slug lookup             | Organization ID, name, slug, active state, and branding fields only                                                                             |
| Public branding                    | Branding fields for one resolved active organization only                                                                                       |
| Public link bootstrap              | One active link by slug with organization, room, gate, scope, and limit fields needed by the centralized W1-1 link evaluator                    |
| Viewer-session bootstrap           | One active session by unguessable token, organization and room identity, link eligibility fields, and minimal presentation fields               |
| Forgot and reset password          | Narrow token issue, lookup, claim, consume, supersede, and recovery operations without arbitrary user or token table reads                      |
| Logout                             | Invalidate the presented session and return minimal audit context                                                                               |
| User administration                | Continue under `vaultspace_app` with known organization context; no bootstrap role for ordinary admin pages                                     |

Password login may return the password hash to the web process because bcrypt verification currently occurs in application code. It must return at most one row and no TOTP secret unless the password step succeeds and the 2FA continuation needs it. A later authentication service could move password verification into a dedicated component, but that is outside this freeze.

The signed 2FA temporary token should include both user ID and selected organization ID. The continuation can then establish tenant context before user mutation and session creation.

## Application changes after GO

1. Change `bootstrapDb` to use `DATABASE_URL_BOOTSTRAP`, never `DATABASE_URL_ADMIN`.
2. Wrap bootstrap operations in named repository functions. Routes must not perform arbitrary queries through the bootstrap client.
3. Move normal post-resolution work immediately into `withOrgContext()` on `vaultspace_app`.
4. Replace direct pre-context `db` use in the 2FA continuation.
5. Keep workers on their current constrained role. Review each existing worker `bootstrapDb` call so the changed client cannot expand or break worker behavior.
6. Remove migration and RLS execution from the web entrypoint. Runtime startup should only validate configuration and start the server.
7. Add a startup guard that fails if `DATABASE_URL_ADMIN` is present in the public web process after cutover.
8. Keep an operator-only break-glass procedure outside normal runtime configuration.

## Key Vault and workload identity plan

Cutover should use separate workload identities or secret-scoped Key Vault role assignments:

- Web identity: runtime DB, bootstrap DB, session, Redis, email, storage, and recovery secrets required by web only.
- Worker identity: runtime DB, Redis, storage, email, and worker recovery secrets only.
- Migrator identity: admin DB secret only, plus ACR pull if its image is private.
- Lifecycle-job identity: only the narrow database and email secrets needed by that job. Remove its admin URL when its query surface is migrated.

After the web cutover:

- remove the `DATABASE_URL_ADMIN` environment variable;
- remove all admin database secret references, including historical aliases, from the web Container App;
- revoke the web identity's ability to read the admin secret; and
- verify through configuration metadata that the secret cannot be resolved by the web workload.

Managed identity for Storage and ACR admin-password retirement remain follow-on platform work. This design must not expand into that migration during W1 unless separately approved.

## Deployment phases

### Phase 1: Bootstrap replacement while admin remains available

- Add the bootstrap role, functions, and tests through the migrator path.
- Deploy application code that uses `DATABASE_URL_BOOTSTRAP` for every enumerated bootstrap route.
- Keep `DATABASE_URL_ADMIN` present as rollback insurance, but add telemetry or a test guard proving the app no longer opens it during requests.
- Run the full CloudSpace auth matrix.

### Phase 2: One-shot migration ownership

- Introduce the migrator job and remove migration or RLS work from web startup.
- Prove two web replicas can start concurrently without attempting DDL.
- Prove a failed migrator prevents worker and web rollout.

### Phase 3: Canary without admin URL

- Capture prior revisions and digests.
- Create one web revision with only runtime and bootstrap database URLs.
- Route canary traffic through the existing safe mechanism.
- Run CloudSpace login, 2FA, session refresh, domain lookup, registration or invitation fixture, forgot/reset fixture without real email, link/viewer bootstrap, and logout.
- Move full traffic only when the matrix is green.

### Phase 4: Remove privilege and stale references

- Remove `DATABASE_URL_ADMIN` and historical admin secret references from web configuration.
- Revoke Key Vault access for the web identity.
- Record configuration evidence without secret values.

## Test matrix

### Disposable integration tests

- Login succeeds for an active user and returns only that user's first active membership.
- Unknown email and wrong password remain indistinguishable.
- A cross-tenant email or ID cannot broaden a function result.
- 2FA TOTP and backup-code paths succeed with correct organization context and fail for a mismatched tenant.
- Session lookup by token returns minimal identity; revoked, expired, unbound, and wrong-organization sessions fail.
- Domain and slug lookup return only one active organization and only approved columns.
- Registration and invitation acceptance cannot attach a user to another organization.
- Password reset cannot read or update another user's token or recovery row.
- Link and viewer bootstrap return only the one unguessable token match and enforce W1-1 eligibility.
- Runtime role has no DDL and cannot bypass RLS.
- Bootstrap role cannot issue arbitrary table selects.
- Migrator role is unavailable from web and worker environments.

### CloudSpace matrix

- Login without 2FA.
- Login with 2FA using an approved synthetic persona.
- Existing session load and refresh.
- Organization custom-domain and slug entry.
- Invitation or registration with synthetic data and email sending disabled.
- Forgot and reset password through a synthetic token retrieval path.
- Public link and established viewer session.
- Logout and session invalidation.

No Brightside password reset, invitation, 2FA enrollment, or exploit testing is permitted.

## Rollout and rollback

Before each phase, record current web and worker revisions, traffic, release, and image digests.

Detection within five minutes:

- migrator completion status;
- quick health only;
- CloudSpace auth matrix;
- HTTP 401, 403, and 500 rate changes on bootstrap routes;
- Container App revision health; and
- explicit verification that web configuration has no admin environment variable after cutover.

Rollback order:

1. Stop traffic movement.
2. Route web traffic to the retained previous revision.
3. Restore the previous worker revision if the worker changed.
4. If required for emergency service restoration, re-inject the admin URL only through the documented break-glass pipeline step.
5. Remove the break-glass URL again immediately after the bootstrap defect is corrected.

Database migrations are forward-only by default. Any bootstrap function migration must be backward-compatible with the retained previous application revision until the cutover is complete.

## Strawman

- A second bootstrap database role and multiple security-definer functions add operational and review complexity.
- The simplest 80 percent control is to move migrations out of startup while temporarily retaining admin-backed bootstrap queries.
- Security-definer functions can become a new privilege-escalation surface if ownership, search path, grants, or return columns are wrong.
- Splitting Key Vault identities during the same release can create an Azure permissions outage unrelated to application logic.
- Brightside is a small Beta, so the full role architecture may feel ahead of current scale.

## Steelman

- The public web process currently combines internet exposure, authentication handling, admin database credentials, incomplete RLS, and multi-tenant application logic. This is the highest blast-radius combination in the review.
- A single application vulnerability can bypass every tenant policy when the process holds a BYPASSRLS or owner connection.
- Running DDL from every replica can race, block startup, or leave different replicas at different migration states.
- The current code already distinguishes runtime and bootstrap access conceptually. Formalizing least privilege aligns the implementation with that contract.
- The cost of careful staged replacement is lower than the consequence of cross-tenant read or destructive database access from a compromised web process.

## Pre-Mortem

Assume the change caused an incident:

- Login returns 500 because the bootstrap function omitted a column or the web identity cannot resolve the new secret.
- Existing sessions all fail because token lookup cannot determine organization context.
- 2FA users are locked out because the continuation still queries through the RLS-scoped client before setting context.
- Password reset or invitation acceptance partially mutates data across two roles without one transaction.
- The migrator job fails after a schema change but before RLS policy application.
- Two deploys run migrators concurrently and contend on Prisma migrations or policy DDL.
- The web revision starts without admin but a hidden route still imports `bootstrapDb` and silently falls back to the runtime client.
- A security-definer function uses an unsafe search path and executes an attacker-controlled object.
- Key Vault access is revoked before the new workload identity is proven.
- A green quick health check hides broken login because health does not exercise bootstrap access.

Detection within five minutes:

- explicit migrator success gate;
- CloudSpace full auth matrix;
- canary route error counts;
- startup configuration assertion;
- a test that enumerates all imports and calls of the bootstrap client; and
- pg_catalog verification of role flags, function owners, search paths, and grants.

Rollback:

- previous web and worker revisions remain retained;
- bootstrap functions remain backward-compatible during rollout;
- break-glass admin URL re-injection is documented but not permanently configured;
- no privilege revocation occurs until the canary has passed.

False confidence controls:

- A healthy migrator does not prove login or 2FA.
- A green login test does not prove session refresh, reset, invitation, domain, or link bootstrap.
- Absence of the environment-variable name does not prove the web identity cannot read the Key Vault secret.
- NOBYPASSRLS does not make a security-definer function safe by itself.

Silent-hardening risk:

- Brightside will perceive any bootstrap failure as a total outage. The canary and rollback must fit the five-minute unannounced budget.

## Go or no-go recommendation

**Recommendation:** GO for phased implementation after Advisor approval, with W1-1 deployed first and W1-2 bootstrap replacement proven before admin removal.

Required before coding:

1. Approve the three-role model and the one-shot Azure Container Apps migrator job.
2. Approve the bootstrap function inventory and return-column review process.
3. Confirm the CloudSpace 2FA and password-reset synthetic personas or approve creating them.
4. Confirm that Key Vault identity splitting may be phased after the web admin-URL cutover if needed to preserve the downtime budget.

## References

- `docker-entrypoint.sh`
- `Dockerfile`
- `.github/workflows/deploy-staging.yml`
- `src/lib/db.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/serverComponentSession.ts`
- `src/lib/middleware/auth.ts`
- `src/lib/middleware/customDomain.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/2fa/validate/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/forgot-password/route.ts`
- `src/app/api/auth/reset-password/route.ts`
- `src/app/api/links/[slug]/route.ts`
- `src/lib/viewerSession.ts`
- `src/lib/rls-startup-guard.ts`
