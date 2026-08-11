# W1-2 Database Privilege Split Design

- **Date:** 2026-08-10
- **Status:** Design only, Advisor review required
- **Decision owner:** Stakeholder Advisor
- **Implementation status:** Blocked pending explicit W1-2 GO
- **Dependency:** W1-1 should deploy first unless the Advisor changes the sequence

## 1. Decision summary

Move all migration and RLS DDL execution into a dedicated, one-shot Azure Container Apps migrator job. Remove migration work from the public web container startup path. Remove `DATABASE_URL_ADMIN` from the public web environment only after every pre-tenant bootstrap workflow has been moved to a narrow, typed database interface and proven on CloudVault.

The public web process will have one database credential: the constrained `vaultspace_app` runtime role. Cross-organization bootstrap operations will execute only through specifically granted, security-definer database functions that return or mutate the minimum required fields. The function owner is non-login and is not exposed as an application secret. Direct table access with no tenant context will not be the bootstrap mechanism.

Workers and scheduled jobs remain free of `DATABASE_URL_ADMIN`. Existing worker-specific constrained identities and provider evidence boundaries are preserved.

## 2. Current repository posture

This is repository evidence, not a live Azure mutation or a secret review.

### 2.1 DDL runs in more than one place

The deployment workflow currently runs Prisma migrations from the GitHub runner using `MIGRATION_DATABASE_URL`. The production Docker entrypoint also requires `DATABASE_URL_ADMIN`, runs `prisma migrate deploy`, and applies `prisma/rls-policies.sql` before starting the web process. Every new web replica can therefore perform privileged startup work.

The worker is explicitly configured with `ENABLE_RLS=false` because its constrained role cannot perform DDL. The workflow already forbids `DATABASE_URL_ADMIN` in the worker and password-reset reconciler. Those controls remain.

### 2.2 The public web process can create an admin Prisma client

`src/lib/db.ts` defines `bootstrapDb` with `DATABASE_URL_ADMIN || DATABASE_URL`. In the public web process, the admin variable is currently present, so bootstrap paths use the elevated connection.

Direct bootstrap use includes:

- login and default organization lookup;
- session lookup, refresh, invalidation, and server-component session resolution;
- registration and invitation lookup;
- forgot-password, reset-password, and administrator reset flows;
- 2FA login completion, which currently uses the unscoped runtime client;
- organization slug, subdomain, custom-domain, and public branding lookup;
- public link admission and viewer-session lookup;
- public access-request creation;
- selected global user and membership operations.

Some worker modules import `bootstrapDb`, but the forbidden admin variable is absent there, so the alias resolves to the constrained worker database URL. W1-2 must not accidentally introduce an admin secret into those workloads.

### 2.3 RLS bootstrap policies are broad by row

The central RLS file currently allows all user and user-organization rows to be selected when `app.current_org_id` is empty. RLS filters rows, not columns. A normal Prisma model query can therefore request password hashes, TOTP secrets, backup-code hashes, or membership details outside a tenant context. W1-3 removes these broad policies after W1-2 proves a replacement.

## 3. Target trust boundaries

### 3.1 Runtime web role

`vaultspace_app` remains:

- LOGIN;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEDB;
- NOCREATEROLE;
- NOREPLICATION;
- unable to perform schema DDL;
- unable to assume the migrator or function-owner role;
- unable to read protected provider evidence tables;
- able to execute only the reviewed bootstrap functions and normal RLS-scoped application queries.

The public web environment contains `DATABASE_URL` only. It contains no `DATABASE_URL_ADMIN`, migration-owner URL, bootstrap-owner password, or alternate broadly privileged database URL.

### 3.2 Bootstrap function owner

Create a dedicated NOLOGIN role, conceptually `vaultspace_bootstrap_owner`, to own only the approved bootstrap functions. The deployment migration must verify its exact attributes and role-membership reachability.

The owner may receive only the table privileges required by the functions. Where FORCE RLS requires controlled bypass for pre-tenant lookup, that ability belongs only to this non-login owner and is reachable solely through the reviewed functions. The runtime role must not be a member of the owner role and must not have `SET ROLE` reachability.

Every function must:

- be `SECURITY DEFINER`;
- use fully qualified object names;
- set a safe `search_path` that excludes attacker-writable schemas;
- use static SQL only;
- validate active, expiry, organization, and token constraints internally;
- return named, minimal columns rather than `SETOF` a table row type;
- avoid logging credentials, hashes, TOTP material, reset tokens, or viewer tokens;
- be revoked from `PUBLIC`;
- be granted by exact signature to `vaultspace_app` only when the web needs it;
- have an expected owner, source checksum, signature, and configuration verified in CI and deployment preflight.

The app role keeps no direct no-context SELECT policy on sensitive identity rows after W1-3.

### 3.3 Migrator role and job

The migration-owner credential is available only to a dedicated, manually triggered Container Apps Job, conceptually `ca-vaultspace-migrator`. The job:

- has no public ingress and receives no traffic;
- has zero schedule triggers;
- runs one completion with parallelism one;
- uses the exact immutable application image digest selected by the deployment;
- receives the migration-owner URL from Key Vault through the job's own identity;
- runs a bounded role and database identity preflight;
- runs Prisma migrations once;
- applies the reviewed RLS DDL once;
- runs catalog posture verification;
- exits before worker or web cutover continues.

The deploy pipeline updates the job to the pinned digest, starts one execution, waits for its terminal state, and stops on any failure. Web and worker containers never run migration or RLS DDL at startup.

## 4. Narrow bootstrap API

Introduce a typed application repository, conceptually `BootstrapRepository`, backed by parameterized calls through the ordinary `db` client. Routes may not call `bootstrapDb.<model>` directly.

The implementation PR must finalize exact function signatures. At minimum, the following capabilities are required.

| Capability             | Required database behavior                                                                                                                                                               | Maximum returned data                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Login candidate        | Normalize email, require active user and active organization membership, choose the canonical default membership deterministically                                                       | User ID, password hash, active flag, 2FA enabled flag, display fields, one organization ID/name/slug/role |
| 2FA validation         | Bind a signed temporary token's user and organization identity, read current TOTP state, atomically consume one backup code, create the organization-bound session, and stamp last login | Only fields needed to validate the code and construct the response                                        |
| Session resolve        | Resolve a high-entropy session token, enforce active and expiry state, bind user and organization membership, and return the session projection                                          | Session ID, user identity projection, organization identity and role, timestamps                          |
| Session mutate         | Refresh one valid session, invalidate one token, invalidate a user's organization sessions, or invalidate all sessions for an approved global identity change                            | Categorical result and affected token fingerprints or IDs, never raw token lists in logs                  |
| Organization resolve   | Resolve active organization by canonical slug or custom domain                                                                                                                           | Organization ID, slug, and explicitly public branding fields                                              |
| Registration           | Validate invite token or new-organization eligibility and atomically create the user, organization or membership, session, and invitation transition                                     | New IDs and public response fields                                                                        |
| Password reset         | Resolve by opaque token or normalized email, enforce current account and membership state, serialize issuance and consumption, update password, and invalidate sessions atomically       | Categorical state plus the minimum delivery or audit identifiers                                          |
| Administrator reset    | Re-check actor and target membership under locks and preserve current global-identity safeguards                                                                                         | Categorical authorization and flow identifiers                                                            |
| Public link admission  | Resolve opaque slug, return the exact link and room gate projection, and create a viewer session through the W1-1 central link policy                                                    | Link, room, and organization fields required by the admission response only                               |
| Viewer session resolve | Resolve the cookie-backed high-entropy token and bind it to link, room, and organization                                                                                                 | The W1-1 viewer-session guard projection only                                                             |
| Public access request  | Resolve active organization and room by slug, enforce room status, deduplicate pending requests, and insert atomically                                                                   | New request ID and categorical result                                                                     |
| Global user safeguards | Count or enumerate only the memberships required to prevent cross-organization identity changes                                                                                          | Counts or organization IDs, not unrelated user fields                                                     |

Password verification remains in the application, so the login candidate function may return one password hash to the rate-limited login path. TOTP verification remains in the application, so the 2FA function may return the current encrypted or stored secret only after a valid signed temporary token binds the user and organization. These are narrow exceptions, not permission for general user-table reads.

Opaque tokens are compared in the database using their existing storage contract. A later token-hashing redesign is outside W1-2 unless separately approved.

## 5. Application changes

### 5.1 Database clients

After cutover:

- `db` is the only public-web Prisma connection and always uses `DATABASE_URL`;
- the current environment fallback in `bootstrapDb` is removed from public runtime code;
- the migrator creates its own short-lived Prisma and `psql` connections from `MIGRATION_DATABASE_URL`;
- worker modules use their existing constrained connection, even if a compatibility alias remains temporarily;
- startup instrumentation asserts that the web current role is not superuser and does not bypass RLS;
- startup instrumentation fails if `DATABASE_URL_ADMIN` or another forbidden database URL is present in the web process.

### 5.2 Container entrypoint

The production entrypoint performs only process initialization and `exec` of the requested command. It does not require `DATABASE_URL_ADMIN`, run Prisma migrations, invoke `psql`, apply RLS, or create roles.

The migrator job invokes a dedicated script that owns the existing startup timeout and redaction controls. That script must preserve lock and statement timeouts and must fail without a valid migration-owner URL.

### 5.3 Pipeline order

The target deploy order is:

1. Resolve and verify pinned web and worker image digests.
2. Record current release, web revision, worker revision, job configuration, and rollback images.
3. Update the one-shot migrator job to the pinned image.
4. Run the migrator job exactly once and verify success and catalog posture.
5. Update and verify the compatible worker when its image changed.
6. Create one candidate web revision.
7. Verify candidate Azure readiness and quick uncached release identity.
8. Run the CloudVault auth matrix against the candidate.
9. Move production traffic within the five-minute budget.
10. Run CloudVault smoke, then the separately authorized minimal Brightside smoke.

No deep health probe is used. The existing password-reset reconciler preflight remains authoritative for that job and remains free of admin credentials.

## 6. Phased cutover

The admin URL must not be removed before the replacement is proven.

### Phase 1: Additive database and job foundation

- Add the NOLOGIN bootstrap owner and initial functions through an additive migration.
- Add the one-shot migrator job definition and pipeline orchestration.
- Keep the current web admin URL and existing bootstrap path available.
- Prove the migrator job against a disposable environment and CloudVault before it owns production DDL.
- Verify the job cannot be triggered concurrently and has no schedule.

### Phase 2: Route bootstrap traffic through the narrow API

- Convert one bootstrap family at a time to `BootstrapRepository`.
- Keep the old admin-backed client available only as a rollback path while the new route is proven.
- Add parity tests for successful and denied outcomes.
- Run the complete CloudVault auth, session, domain, reset, public link, and access-request matrix.

No route may silently fall back to the admin client after a narrow function returns no row or an error.

### Phase 3: Remove startup DDL

- Make the migrator job the only production DDL path.
- Change the web entrypoint to process startup only.
- Prove a scale-out or restart creates multiple web replicas without any migration execution.
- Retain `DATABASE_URL_ADMIN` in the web environment during this phase only if needed for immediate rollback, but assert that application code does not open it.

### Phase 4: Canary without admin URL

- Create a single candidate web revision without `DATABASE_URL_ADMIN`.
- Confirm the candidate has only the constrained runtime URL and passes the startup role guard.
- Run CloudVault's full auth matrix against the candidate revision before broad traffic.
- Move traffic only when all checks pass.
- Preserve the prior web revision as the documented emergency break-glass rollback.

### Phase 5: Remove long-term web access to the secret

- Remove the admin secret reference from the web Container App template.
- Remove the web workload identity's permission to read the migration secret.
- Keep migration-secret read access only on the migrator job identity.
- Verify through configuration metadata only. Do not print or compare secret values.

## 7. Key Vault and workload identity plan

W1-2 must complete the database-secret split and record the remaining platform work.

Required now:

- distinct managed identity or Key Vault access boundary for the migrator job;
- web identity cannot read the migration-owner database secret after cutover;
- worker and scheduled jobs do not receive the admin URL;
- pipeline can reference the secret by name without retrieving or logging its value;
- break-glass access is protected, auditable, and used only through the approved rollback procedure.

Planned after W1 if separately approved:

- replace storage account keys with managed identity;
- replace ACR admin credentials with managed identity;
- further split workload access to unrelated application secrets.

Private networking, firewall changes, HA, and geo design are outside this work.

## 8. Verification plan

### 8.1 Static and unit controls

Add tests that fail when:

- the web entrypoint contains migration or RLS execution;
- the web required environment list contains `DATABASE_URL_ADMIN`;
- the worker, reconciler, or web runtime receives a forbidden admin URL;
- a public route imports or calls the old direct `bootstrapDb` model surface;
- bootstrap functions are executable by `PUBLIC`;
- the runtime role can assume the function owner or migrator role;
- function owner, signature, `SECURITY DEFINER`, `search_path`, or checksum drifts;
- the migrator job has ingress, a schedule, parallelism above one, or an unpinned image;
- the workflow can continue after a failed or unknown migrator execution.

### 8.2 Disposable PostgreSQL integration

Run the real runtime role and migration owner against a disposable local PostgreSQL database. Prove:

- the runtime role cannot create, alter, or drop schema objects;
- the runtime role cannot select user, membership, invitation, session, link, or reset rows without tenant context through direct table access;
- each granted bootstrap function returns only its documented projection;
- wrong email, token, user ID, organization, link, or session identity returns a neutral denial;
- registration and reset functions are atomic under concurrency;
- backup-code consumption is one-time and concurrent-safe;
- password reset preserves current provider evidence and account-global locks;
- function calls cannot manipulate `search_path`, overload resolution, role membership, or dynamic SQL;
- migrator and function-owner credentials are not reachable by the runtime role.

### 8.3 CloudVault auth matrix

Use CloudVault and synthetic accounts only:

- login without 2FA;
- login with TOTP;
- login with a backup code and prove one-time consumption;
- invalid password, invalid 2FA, inactive account, and inactive membership;
- session load, activity refresh, logout, and protected-route denial after logout;
- invited registration and approved open registration path if currently enabled;
- organization slug, subdomain, custom domain, and public branding lookup;
- forgot-password request, reset token consumption, and session invalidation;
- administrator reset with same-org and multi-org safeguards;
- public link admission, viewer session, expiry, revocation, and logout;
- public access request create, duplicate denial, approval, and denial;
- account and organization switching behavior that exists today.

Credentials remain out of source, logs, PR text, and chat.

### 8.4 Production verification

- Azure readiness for migrator, worker, and candidate web revision;
- quick uncached identity health only;
- catalog and role metadata without customer-row queries;
- CloudVault matrix first;
- minimal Brightside login, known single-room path, and logout only after CloudVault is green;
- no deep health, data dump, document metadata listing, preview, or download for Brightside.

## 9. Deployment and rollback

### 9.1 Forward deployment controls

- all database changes are additive and backward-compatible with the retained web revision;
- the job refuses concurrent execution;
- migration lock and statement timeouts remain bounded;
- a failed migration stops before worker or web cutover;
- prior web and worker revisions and images remain available;
- the cutover is aborted if the five-minute impact budget cannot be met.

### 9.2 Rollback before admin URL removal

Restore the prior web revision and worker revision as needed. Because migrations are additive, the prior application remains compatible. Do not reverse a completed migration during the immediate application rollback.

### 9.3 Break-glass rollback after admin URL removal

Use the protected pipeline procedure to restore the prior web revision and, only if that revision requires it, reattach the existing Key Vault admin-secret reference to the web template. Do not retrieve or print the value. Confirm quick health and minimal auth smoke, then remove the admin URL again after the defect is corrected.

The break-glass action is an incident response, not a steady-state option. It must be recorded with revision, reason, start time, removal time, and Advisor notification.

### 9.4 Database rollback

Bootstrap functions and grants are additive. If a new function is defective, route traffic back to the prior web revision and revoke its execute grant only through the migrator job after impact review. Never edit an applied migration or perform ad hoc production DDL.

## 10. Strawman

### What if the finding is over-stated because application routes select minimal fields?

Several routes do select minimal fields, and workers already lack the admin URL. However, the web process can instantiate an elevated Prisma client capable of arbitrary queries if application code is compromised. Route-level select discipline is not a privilege boundary.

### What simpler control achieves most of the risk reduction?

Removing `DATABASE_URL_ADMIN` from web while keeping broad no-context RLS policies would reduce DDL blast radius, but normal application code could still read sensitive identity rows before tenant context. Moving only migrations to the GitHub runner would leave every web replica's entrypoint and bootstrap client privileged. The smallest complete control is a one-shot migrator plus a narrow bootstrap interface.

### What workflows might break?

- login if password or default membership projection is incomplete;
- 2FA validation if no organization context can be established from the signed temporary token;
- session rendering and logout if token resolution or refresh changes;
- invited registration and organization creation;
- forgot-password, reset-password, administrator reset, and provider recovery;
- custom-domain and branding resolution;
- public links and viewer sessions;
- public access requests;
- global identity safeguards for multi-organization users.

The full CloudVault matrix is a release gate, not a follow-up.

### Are we adding too many database functions?

Security-definer functions add audit and migration burden. A second login role with broad table access would be simpler to wire into Prisma but would recreate a large cross-tenant credential in the public process. Typed functions provide a smaller callable surface, minimal columns, atomic invariants, and catalog-verifiable grants.

## 11. Steelman

### Blast radius if unfixed

A remote-code-execution or server-side injection flaw in the public web process can use the admin connection to bypass RLS and perform broad reads or writes. Every replica also has enough authority to run migrations and RLS DDL at startup.

### Defense-in-depth failure

The open authorization and RLS findings mean application errors and database policy drift already exist. Keeping a privileged web credential collapses the final database boundary when those controls fail together.

### Contract alignment

The design makes the runtime role genuinely constrained, moves DDL to a bounded deploy operation, preserves RLS tenant context for ordinary queries, and narrows pre-tenant bootstrap to reviewed functions.

### Cost of delay versus careful change

This is the highest blast-radius Wave 1 item, but a rushed cutover can brick all login and session paths. The phased plan allows the replacement to run while the old revision remains available, then removes the secret only after CloudVault proof.

## 12. Pre-Mortem

Assume W1-2 caused an incident.

### Failure: all login attempts return 401 or 500

Likely cause: login projection omitted a membership field, function grant or owner drifted, or the web revision lost the admin URL before the narrow path was active.

Detection within five minutes:

- candidate CloudVault login matrix;
- categorical function-preflight result;
- quick health plus route-specific smoke without secrets.

Rollback:

- restore the prior web revision;
- use the documented secret-reference reattachment only if required by that revision;
- do not weaken RLS or grant direct user-table SELECT to make login pass.

### Failure: 2FA users are locked out

Likely cause: the temporary token lacks organization binding, TOTP material is not returned to the narrow path, or backup-code mutation is not atomic.

Detection:

- CloudVault TOTP and backup-code tests before traffic;
- invalid and replay tests;
- alert on categorical 2FA validation failures without logging secrets.

Rollback:

- restore the prior revision within the five-minute budget;
- preserve existing TOTP and backup-code data unchanged.

### Failure: migration job and web both run DDL

Likely cause: the entrypoint still contains migration logic or an old image is deployed with the new job.

Detection:

- static image contract test;
- deployment records exact digest and entrypoint mode;
- database advisory lock and migration-job execution ID.

Rollback:

- stop before web cutover when detected;
- do not start a second migrator execution;
- keep production on the prior revision while reconciling the image contract.

### Failure: migration lock causes more than five minutes of impact

Likely cause: an unbounded DDL lock or long migration runs while traffic is active.

Detection:

- migration statement and lock timeouts;
- bounded job timeout;
- deployment clock and Azure job status.

Rollback:

- let the bounded job fail and stop the deploy;
- do not retry repeatedly;
- request a planned window if the migration cannot safely complete within budget.

### Failure: a security-definer function becomes a privilege-escalation path

Likely cause: unsafe `search_path`, dynamic SQL, an over-broad row return, `PUBLIC` execute, overload ambiguity, or role reachability.

Detection:

- disposable database hostile-catalog tests;
- catalog preflight for owner, signature, grants, configuration, source checksum, and role closure;
- negative function calls across two organizations.

Rollback:

- restore the prior application revision;
- revoke the affected exact function signature through the migrator job;
- preserve audit evidence and investigate before another deploy.

### False confidence from green tests

Mocks can prove that a repository method was called without proving PostgreSQL privilege behavior. A green migration can also coexist with a web identity that still reads the admin secret. Acceptance requires real-role integration tests, Container App environment metadata, Key Vault access metadata, candidate auth flows, and exact image identity.

### Silent-hardening behavior change

Login, 2FA, reset, session, link, or branding responses may become slower or return neutral denials where the admin client previously found a row. Any Brightside-visible change is treated as an incident and rolled back. No customer notice is sent under the current silent-hardening mandate.

## 13. Go or no-go

**GO for Advisor review of this design.**

**NO-GO for implementation.** Implementation requires a written W1-2 Advisor GO that accepts the security-definer function approach, the phased overlap with the old admin-backed revision, the one-shot Container Apps Job, the CloudVault auth matrix, and the break-glass secret-reference rollback.

The admin URL must not be removed before the replacement passes the complete CloudVault matrix. The security freeze remains active. P0-4 remains accepted and unchanged.

## References

- `CANONICAL_CONTRACTS.md`
- `prisma/schema.prisma`
- `prisma/rls-policies.sql`
- `src/lib/db.ts`
- `src/lib/rls-startup-guard.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/serverComponentSession.ts`
- `src/lib/middleware/auth.ts`
- `src/lib/middleware/customDomain.ts`
- `src/lib/viewerSession.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/2fa/validate/route.ts`
- `src/app/api/auth/forgot-password/route.ts`
- `src/app/api/auth/reset-password/route.ts`
- `src/app/api/rooms/public/request-access/route.ts`
- `src/app/api/links/[slug]/route.ts`
- `docker-entrypoint.sh`
- `scripts/run-prisma-migrate-deploy.mjs`
- `scripts/migration-startup-gucs.mjs`
- `scripts/validate-container-env.sh`
- `.github/workflows/deploy-staging.yml`
