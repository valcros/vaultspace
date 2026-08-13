# W1-2 Unit 11 Password Reset Route Conversion Proposal

- Date: 2026-08-13
- Advisor authorization: ADV-2026-08-13-12
- Unit: W1-2 Unit 11
- Status: Analysis only, implementation GO requested
- Starting main: `c9b5d439263c1051568eccd9cc895684be716a06`
- Unit 10 live release: `f8a67674f6c43521873f4c2c74ca9fe453b9e732`
- Unit 10 live web revision: `ca-vaultspace-web--0000300`
- Unit 10 live worker revision: `ca-vaultspace-worker--0000283`
- Security freeze: Active
- Admin database URL: Retained
- W1-3: Not started

## 1. Recommendation

Implement Unit 11 as one bounded route-conversion unit for
`POST /api/auth/reset-password`:

1. grant `vaultspace_app` execution only on the two Unit 10 password-reset functions;
2. route candidate validation and authoritative redemption through
   `PasswordResetCapabilityRepository` using the ordinary runtime database client;
3. insert completion and supersession audits inside the same Prisma transaction as redemption;
4. evict returned `session:v2:<sessionId>` cache entries only after commit; and
5. leave issuance, administrator cancellation, delivery transitions, direct reset-table privilege
   contraction, `DATABASE_URL_ADMIN` removal, and W1-3 outside this unit.

The resulting runtime matrix is exactly eleven approved `bootstrap_*` functions. The generic bulk
session revocation primitives remain owner-only. The route has no `bootstrapDb`, direct reset-table
model access, direct password update, direct session mutation, or administrative fallback.

This proposal answers the Advisor's open question by making the audit writes part of the same
ordinary-role transaction that invokes `bootstrap_password_reset_redeem_v1`. PostgreSQL commits the
password change, reset-flow consumption, recovery wipe, global session revocation, completion
audits, and supersession audits together. Redis deletion occurs after that commit and uses only the
returned session IDs.

## 2. Current accepted posture

Unit 10 is acceptance-closed at release
`f8a67674f6c43521873f4c2c74ca9fe453b9e732`, web revision
`ca-vaultspace-web--0000300`, and worker revision `ca-vaultspace-worker--0000283`.

The production catalog currently has these properties:

- `vaultspace_app` can execute exactly the nine Unit 9 functions;
- `bootstrap_password_reset_candidate_v1(text)` is deployed, owner-only, and unrouted;
- `bootstrap_password_reset_redeem_v1(text, text)` is deployed, owner-only, and unrouted;
- both generic global and organization session revocation primitives remain owner-only;
- `vaultspace_bootstrap_owner` remains NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS,
  NOCREATEDB, NOCREATEROLE, and NOREPLICATION;
- the owner has no direct or transitive role memberships and no table-level write privileges;
- all 152 reviewed reset ACL keys are preserved with deterministic `pg_catalog."C"` collation;
- `DATABASE_URL_ADMIN` remains configured on the web workload; and
- rollback web revision `ca-vaultspace-web--0000299` and worker revision
  `ca-vaultspace-worker--0000282` remain retained.

Unit 11 changes the two function grants and one live route family. It does not reopen or alter the
accepted Unit 10 function bodies.

## 3. Existing route inventory

The current `src/app/api/auth/reset-password/route.ts` still imports `bootstrapDb` and performs the
following work directly:

1. read and compare the password-reset token row;
2. read the user and active organization memberships;
3. acquire the account advisory lock and row locks;
4. claim the selected reset flow;
5. wipe the selected recovery record;
6. update the password hash;
7. find, consume, and wipe sibling reset flows;
8. deactivate all subject sessions;
9. write completion and supersession audit events; and
10. delete session cache entries after commit.

Unit 10 moved steps 1 through 8 into two bounded capability functions without granting runtime
access. The existing repository validates their minimal result envelopes. Unit 11 routes the live
endpoint through that repository and preserves the same public response contract.

## 4. Unit boundary

### 4.1 In scope

- Add one fail-closed migration that grants `vaultspace_app` execution on the two exact Unit 10
  signatures.
- Convert `POST /api/auth/reset-password` to the ordinary `db` client and
  `PasswordResetCapabilityRepository`.
- Preserve current HMAC lookup derivation and strict legacy-token dual-read compatibility.
- Call the candidate function before bcrypt cost-12 hashing.
- Invoke redemption and authoritative audit insertion in one ordinary-role Prisma transaction.
- Set event RLS context only from organization IDs returned by the validated database envelope.
- Add deterministic completion-audit idempotency keys and preserve deterministic supersession keys.
- Evict only returned session IDs through the existing `clearSessionCache` helper after commit.
- Replace route unit tests so they prove the repository, transaction, audit, and cache boundaries.
- Add production-like PostgreSQL, migration, source inventory, and CloudVault acceptance coverage.
- Perform one controlled merge and one controlled staging deployment after a separate Advisor GO.

### 4.2 Explicitly out of scope

- anonymous password-reset issuance;
- administrator password-reset issuance;
- provider delivery and reconciliation transitions;
- administrator cancellation of reset flows during email, membership, or account lifecycle changes;
- direct runtime privilege contraction on `password_reset_tokens` or
  `password_reset_recoveries`;
- changes to the password-reset capability function bodies unless a separately reviewed defect is
  found before implementation;
- any runtime grant on generic session revocation primitives;
- registration, two-factor completion, public-link, viewer-session, or access-request conversion;
- `DATABASE_URL_ADMIN` removal;
- workflow path-filter changes;
- migrator or web-entrypoint restructuring;
- W1-3, FORCE RLS changes, or bootstrap-policy removal; and
- P0-4 changes.

## 5. Authorization and data-flow contract

### 5.1 Public token parsing

The route accepts only the existing public token shapes:

- current `prt1_` public tokens, which the application converts to non-reversible stored
  `prh1:` HMAC lookups using `SESSION_SECRET`; and
- strict 43-character legacy tokens while live legacy rows can still exist.

The public token, stored lookup, secret, password, and password hash must never appear in logs,
errors, audit fields, response bodies, snapshots, acceptance evidence, or SQL result envelopes.
Presenting a stored `prh1:` value as a public token remains invalid.

### 5.2 Candidate proof before bcrypt

The route calls
`PasswordResetCapabilityRepository.candidateProven(storedTokenLookup)` before hashing the proposed
password. The function proves only that one current candidate exists for an active identity with
between one and 64 active memberships in active organizations. It returns one boolean marker or no
row and reveals no subject, flow, organization, or lifecycle metadata.

Malformed, unknown, used, expired, inactive-user, inactive-membership, and inactive-organization
cases return the existing neutral HTTP 400 response. Invalid anonymous traffic therefore cannot
force cost-12 bcrypt work.

Candidate success is not authorization to mutate. Every fact is revalidated under the redemption
function's advisory and row locks.

### 5.3 Authoritative redemption

After candidate proof, the route hashes the password at bcrypt cost 12 and starts one ordinary-role
Prisma transaction. Inside that transaction it invokes
`PasswordResetCapabilityRepository.redeem(storedTokenLookup, passwordHash)`.

The procedure derives the subject only from the locked reset row. It accepts no caller-selected
user, organization, flow, session, audit scope, or request identifier. It then:

1. acquires the account-global advisory lock;
2. locks and revalidates the active subject and current organization memberships;
3. locks and conditionally claims the exact reset flow;
4. wipes the exact recovery material;
5. updates the derived subject's password hash;
6. consumes and wipes sibling reset flows;
7. invokes the owner-only generic global session revocation primitive internally; and
8. returns only the typed server result needed for auditing and session-ID cache eviction.

A neutral no-row result means the candidate lost a race or became ineligible. The transaction
performs no audit insert and the route returns the same neutral HTTP 400 response.

## 6. Atomic audit composition

### 6.1 One transaction, two execution identities

The route owns one `db.$transaction` callback. The redemption call executes as the no-login
security-definer owner, then control returns to `vaultspace_app` inside the same PostgreSQL
transaction. Audit events are inserted by `vaultspace_app`, not by the definer owner.

This preserves the existing separation of duties:

- the owner can perform the bounded password-reset mutation but receives no event-table append
  privilege; and
- the ordinary role can append tenant-scoped events only while the matching event RLS context is
  active.

No nested `withOrgContext` transaction is allowed. Nesting would separate audit insertion from the
redemption commit and violate atomicity.

### 6.2 Transaction-local RLS context

Before redemption, the route establishes the deterministic no-organization state with
`setBootstrapContext(tx)`. After the validated redemption envelope returns, it iterates the
canonical `auditOrganizations` array.

For each entry, the route sets `app.current_org_id` transaction-locally to the returned
`organizationId`, then inserts that organization's completion and supersession events with
`createSecurityAuditEvent(tx, ...)`.

Implementation should add a narrow helper such as
`setTransactionOrganizationContext(tx, organizationId)` in `src/lib/db.ts`. The helper performs a
parameterized `set_config(..., true)` on an existing transaction and never opens a transaction of
its own. Its input comes only from the strictly validated SQL result envelope.

The organization ID, actor type, actor ID, actor email, flow IDs, and initiation request ID are
database-derived. Request IP, user agent, and the current HTTP request ID remain request-derived
telemetry. No public request field chooses an audit organization or subject.

### 6.3 Completion event

For each derived organization, the route creates one `USER_PASSWORD_RESET` event with:

- `organizationId`: the derived current organization;
- `actorType`: the derived current membership role mapped to `ADMIN` or `VIEWER`;
- `actorId` and `actorEmail`: the derived subject identity;
- `requestId`: the current request ID;
- `correlationId`: the redeemed flow ID;
- `idempotencyKey`: `password-reset-<flowId>-completed-<organizationId>`;
- `description`: the existing completion description; and
- metadata containing only categorical success, `stage=completed`, invalidated-session count, and
  the non-secret initiation request ID.

The deterministic key is bounded by the schema's generated identifier shapes, includes the
organization scope, and protects the append-only event table from accidental duplicate insertion.
It contains no token or credential material.

### 6.4 Supersession events

For every derived organization and returned sibling flow, the route creates one supersession event
with the existing key:

`password-reset-<supersededFlowId>-superseded-<organizationId>`

Its request ID is the returned sibling request ID or the existing deterministic
`recovery-<flowId>` fallback. Metadata remains categorical and names only the replacement flow ID
and `SUPERSEDED` outcome.

### 6.5 Failure semantics

`createSecurityAuditEvent` is authoritative and propagates failures. The route must not use the
best-effort `captureSecurityAudit` helper for these events.

If any completion or supersession audit insert fails, the Prisma callback rejects. PostgreSQL then
rolls back:

- the exact token claim;
- the password update;
- recovery-material wipes;
- sibling-flow supersession;
- all session revocations; and
- every audit insert already attempted in that transaction.

The route returns HTTP 500 with categorical error logging. The token, lookup, password hash,
identity, and organization inventory remain absent from the log.

## 7. Cache invalidation contract

The redeem function returns canonical, unique session IDs, never bearer tokens. The route retains
those IDs only in server memory until the transaction commits.

After commit, the route calls `clearSessionCache(redemption.revokedSessionIds)`. The existing helper
deletes only `session:v2:<sessionId>` keys and records categorical requested and failed counts. It
does not log IDs or tokens.

Cache deletion is intentionally outside the database transaction because Redis cannot participate
in the PostgreSQL commit. A cache deletion failure does not undo the already committed password
reset. It is non-authoritative because session resolution checks the live constrained PostgreSQL
projection before reading or populating Redis. A revoked session therefore remains denied even if a
warmed cache entry survives temporarily.

The route must never clear cache before commit. It must never derive cache keys from the public
token or stored lookup. Tests must pin both properties.

## 8. Proposed route sequence

The converted handler should follow this exact order:

1. obtain categorical request context;
2. parse the public token and proposed password;
3. derive the stored lookup with `resolvePasswordResetTokenLookup`;
4. return the neutral response when the public token shape is invalid;
5. call `candidateProven` through the ordinary runtime repository;
6. return the neutral response when no candidate is proven;
7. hash the proposed password with bcrypt cost 12;
8. start one `db.$transaction` callback;
9. establish empty bootstrap context in that transaction;
10. instantiate `PasswordResetCapabilityRepository` with the transaction client;
11. call `redeem` with only the stored lookup and password hash;
12. return a neutral transaction result when redemption returns no row;
13. for each derived organization, set the transaction-local event RLS context;
14. write one completion event and every derived supersession event;
15. return the validated redemption envelope from the transaction;
16. after commit, delete returned session-ID cache keys;
17. emit one categorical success log with flow correlation and invalidated-session count; and
18. return the existing success response.

The success log may retain the non-secret flow ID as its existing correlation identifier. It must
not include the public token, stored lookup, password hash, user email, organization IDs, session
IDs, or cache keys.

## 9. Application changes proposed

### 9.1 Reset route

Modify `src/app/api/auth/reset-password/route.ts` to:

- import ordinary `db`, `setBootstrapContext`, and the transaction-local organization-context
  helper;
- import `PasswordResetCapabilityRepository`;
- remove the `bootstrapDb` alias;
- remove `lockPasswordResetUser`, `passwordResetTokenMatchesStoredValue`, and direct reset-row
  logic;
- remove `deactivateAllUserSessionsInTx` from this route;
- preserve `resolvePasswordResetTokenLookup`, bcrypt, request validation, neutral denial, security
  audit, cache cleanup, and categorical logging; and
- contain no direct Prisma model call for reset tokens, recoveries, user password changes,
  memberships, organizations, or sessions.

### 9.2 Database context helper

Add one transaction-only helper in `src/lib/db.ts` for setting a validated organization context on
an existing transaction. It must:

- accept only a transaction client and organization ID;
- use parameterized `set_config('app.current_org_id', ..., true)`;
- never create or commit a nested transaction; and
- have focused tests proving transaction-local parameterized behavior.

### 9.3 Repository

The Unit 10 repository contract is already sufficient. Unit 11 should not widen the SQL signatures
or returned fields. Tests may be extended, but implementation changes should be limited to defects
found during route integration.

## 10. Migration and catalog plan

Add one route-conversion migration. It must not edit the applied Unit 10 migration.

### 10.1 Prestate proof

Before any grant, fail closed unless:

- Unit 10 migration is present and complete;
- the two exact password-reset functions have the reviewed owner, signature, language, volatility,
  parallel posture, security-definer flag, safe `search_path`, contract marker, and canonical source
  checksum;
- `vaultspace_app` has execution on exactly the nine Unit 9 functions;
- `vaultspace_app` and `PUBLIC` cannot execute the two reset functions;
- both generic revocation primitives remain owner-only;
- owner posture and zero-membership closure match Unit 10;
- no owner table-level write privilege exists; and
- the 152 runtime reset ACL keys exactly match the Unit 10 evidence under explicit
  `COLLATE pg_catalog."C"` ordering.

### 10.2 Grants

Grant `vaultspace_app` execution only on:

1. `public.bootstrap_password_reset_candidate_v1(text)`; and
2. `public.bootstrap_password_reset_redeem_v1(text, text)`.

Reassert `PUBLIC` denial. Do not grant any generic revoke primitive or any additional table,
column, schema, sequence, or role privilege.

### 10.3 Final proof

After the grant, fail closed unless `vaultspace_app` can execute exactly these eleven functions:

1. `bootstrap_login_candidate_v1(text)`;
2. `bootstrap_session_resolve_v1(text)`;
3. `bootstrap_organization_resolve_v1(text, text)`;
4. `bootstrap_session_create_v1(text, text, text, timestamptz, text, text)`;
5. `bootstrap_session_refresh_v1(text)`;
6. `bootstrap_session_invalidate_v1(text)`;
7. `bootstrap_session_revoke_self_others_v1(text)`;
8. `bootstrap_session_revoke_admin_user_org_v1(text, text)`;
9. `bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)`;
10. `bootstrap_password_reset_candidate_v1(text)`; and
11. `bootstrap_password_reset_redeem_v1(text, text)`.

The migration must also prove:

- no other `bootstrap_*` function is runtime-executable;
- `PUBLIC` cannot execute any approved function;
- generic organization and global revoke primitives remain owner-only;
- function definitions still match Unit 10;
- owner posture, memberships, schema privileges, and column-scoped privileges are unchanged;
- no table-level write privilege appears; and
- all direct reset-table runtime privileges remain exactly unchanged as the recorded temporary
  residual.

## 11. Temporary privilege residual

Unit 11 cannot yet revoke direct `vaultspace_app` privileges on reset tokens and recoveries.
Administrator email, membership, and account lifecycle paths still cancel outstanding reset flows
inside their established transactions.

The route conversion migration must inventory and reassert the exact residual. It must not broaden
it. A later unit must convert every remaining direct caller before the contraction migration
revokes those table and column privileges.

This residual is one reason `DATABASE_URL_ADMIN` remains present after Unit 11. Successful
redemption conversion alone is not an admin-URL removal gate.

## 12. Static and unit verification

### 12.1 Route source guard

Fail CI if the converted route contains or imports:

- `bootstrapDb`;
- direct password-reset token or recovery models;
- direct user password mutation;
- direct session mutation;
- `deactivateAllUserSessionsInTx`;
- caller-selected user or organization scope; or
- a silent fallback to an administrative client.

### 12.2 Route behavior

Focused tests must prove:

1. malformed public tokens fail before candidate lookup and bcrypt;
2. stored HMAC replay fails before candidate lookup and bcrypt;
3. missing token secret fails closed without logging credentials;
4. candidate denial returns neutral HTTP 400 and does not hash;
5. candidate success precedes exactly one cost-12 hash;
6. redemption runs inside the ordinary-role transaction;
7. a neutral redemption race returns HTTP 400 without audits or cache deletion;
8. every audit scope, role, actor, and flow value comes from the validated redemption envelope;
9. completion and supersession events use deterministic organization-scoped idempotency keys;
10. event RLS context is changed only to returned organization IDs;
11. any audit failure rejects the transaction and produces no cache deletion;
12. cache deletion begins only after transaction resolution;
13. cache deletion receives only returned session IDs;
14. cache cleanup failure does not change a committed success response;
15. no public token, lookup, secret, hash, identity, organization inventory, or session ID enters
    logs; and
16. current HMAC and strict legacy compatibility remain green.

### 12.3 Repository and context tests

Retain the Unit 10 envelope tests. Add coverage for the transaction-local organization-context
helper and for route composition across multiple organizations and multiple superseded flows.

## 13. Disposable PostgreSQL matrix

Use fresh PostgreSQL 15 containers with the complete migration chain, real roles, a production-like
Unit 10 prestate, and Azure-like migrator execution. Prove:

1. the route-conversion migration rejects any prestate other than the exact nine-function matrix;
2. it rejects function source, owner, configuration, contract marker, or privilege drift;
3. it grants only the two reviewed signatures;
4. the final runtime matrix is exactly eleven;
5. the two generic revoke primitives remain owner-only;
6. `PUBLIC` remains denied;
7. all 152 reset ACL keys remain unchanged with deterministic collation;
8. the owner remains no-login, no-bypass, membership-closed, and table-write-free;
9. a current HMAC candidate and redemption succeed for only the derived subject;
10. a strict legacy candidate and redemption remain compatible;
11. malformed, unknown, used, expired, inactive-user, no-active-membership, and inactive-org cases
    return no row;
12. one candidate followed by concurrent redemption produces one success and one neutral result;
13. password update, exact claim, recovery wipe, sibling supersession, and global session revocation
    are atomic;
14. an injected event insert failure rolls back the entire redemption transaction;
15. completion and supersession events are visible only in database-derived current organizations;
16. another user's password, reset flows, recoveries, sessions, and audits remain unchanged;
17. revoked session IDs are canonical and never reveal bearer tokens; and
18. hostile search path, GUC, overload, membership, and schema-shadowing cases remain ineffective.

## 14. CloudVault acceptance matrix

Use dedicated synthetic identities and retain the CloudVault organization. The post-deploy runner
must prove at minimum:

1. health, release SHA, and exact web and worker revision identity;
2. migration completion and exact eleven-function runtime matrix;
3. owner-only generic revocation primitives and unchanged owner posture;
4. valid current HMAC reset changes only the exact CloudVault identity;
5. the exact flow cannot be replayed;
6. expired, unknown, malformed, and already-used tokens share the neutral response;
7. inactive user, membership, or organization shares the neutral response;
8. sibling reset flows become unusable;
9. redeemed and superseded recovery ciphertext is wiped;
10. completion and supersession audits exist only in derived current organization scopes;
11. all prior subject sessions receive HTTP 401, including a deliberately warmed cache entry;
12. another synthetic user's session remains valid;
13. old-password login fails and new-password login succeeds;
14. login, session resolve, organization resolve, sliding refresh, logout, and unknown-session
    regressions remain green; and
15. synthetic identities, memberships, sessions, and reset flows are soft-cleaned while CloudVault
    is retained.

The acceptance runner must not print public tokens, stored lookups, passwords, password hashes,
session tokens, connection strings, or customer data. It may report only categorical results,
counts, non-secret release identities, and synthetic record identifiers required by the evidence
contract.

## 15. Brightside minimal smoke

After CloudVault is green, perform only the existing bounded Brightside checks:

1. authenticated shell;
2. known room path;
3. logout;
4. protected re-entry denial; and
5. no privacy expansion or content enumeration.

Do not create or redeem a Brightside password reset. No customer email, document, room, membership,
or session inventory is authorized.

## 16. Strawman

- Granting two anonymous-entry functions increases the reachable security-definer surface.
- Candidate proof can create a valid-token timing distinction before redemption.
- The route changes RLS context multiple times inside one transaction.
- Audit insertion remains application code rather than a database-definer side effect.
- Redis deletion cannot be part of the PostgreSQL commit.
- Direct reset-table privileges remain after the primary redemption route stops using them.
- Keeping `DATABASE_URL_ADMIN` means Unit 11 does not finish W1-2.

## 17. Steelman

- Both function bodies are already live, catalog-verified, owner-only, and acceptance-closed. Unit
  11 adds only the two exact grants and reviewed route composition.
- Candidate proof returns no identity or metadata and avoids anonymous bcrypt amplification.
- The redeem signature makes subject and scope selection impossible at the application boundary.
- Transaction-local RLS context is derived only from the locked database envelope and allows the
  ordinary role to keep ownership of append-only audit insertion.
- The Prisma transaction makes every authoritative database mutation and audit event one atomic
  unit.
- Redis remains only an accelerator. Live database resolution preserves revocation when deletion
  is delayed or unavailable.
- The residual direct privileges and admin URL are explicitly inventoried, unchanged, and gated on
  later caller conversion rather than hidden by this unit.

## 18. Pre-mortem

| If                                                                         | Then                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Invalid anonymous traffic performs bcrypt work                             | Fail unit tests and source review; candidate ordering is wrong                               |
| A valid token can influence the target user or organization                | Treat as a critical authorization defect; do not merge or deploy                             |
| Redemption commits without all required audits                             | Roll back the design; transaction composition is not atomic                                  |
| An audit failure leaves the password, token, recovery, or sessions changed | Roll back; no second deploy without a new GO                                                 |
| Audit events appear in an organization not returned by redemption          | Stop and treat as cross-tenant audit contamination                                           |
| Cache deletion runs before commit                                          | Stop; a rollback could leave active sessions with missing cache state                        |
| A warmed cache authorizes a revoked session                                | Roll back; live PostgreSQL resolution is no longer authoritative                             |
| App execution includes a twelfth function or a generic revoke primitive    | Fail catalog acceptance and stop                                                             |
| Direct reset-table privileges broaden                                      | Fail migration and stop                                                                      |
| Legacy live tokens stop working                                            | Roll back to retained Unit 10 revision unless a separately approved drain proved none remain |
| `DATABASE_URL_ADMIN` is removed                                            | Unauthorized; restore configuration and stop                                                 |
| W1-3 or another auth family enters the PR                                  | Reject the scope before merge                                                                |

## 19. Controlled rollout and rollback

After an implementation PR has exact-head CI green and receives a separate Advisor deploy GO:

1. human-review route source, transaction boundaries, audit derivation, cache ordering, and exact
   grants;
2. disable deploy workflow `251547585` and prove no active real deployment;
3. revalidate exact PR head and CI;
4. squash-merge with an exact-head guard;
5. wait for exact-main CI and web and worker image publication while deployment remains disabled;
6. re-enable the workflow and prove no side-effect deployment;
7. issue exactly one staging dispatch for the accepted main SHA;
8. verify migration, release identity, exact catalog matrix, owner posture, and rollback retention;
9. run the full CloudVault matrix;
10. run the minimal Brightside smoke;
11. draft a separate evidence PR; and
12. stop for written Advisor close-out.

On user-visible reset, login, session, organization, or audit failure, restore the retained Unit 10
web revision within five minutes. Do not edit applied migrations, hand-apply DDL, grant a generic
revoke primitive, restore a silent `bootstrapDb` fallback, or issue a second deployment without a
new GO.

The additive grants may remain after application rollback until a separately authorized migrator
revocation. The retained Unit 10 route does not call them. `DATABASE_URL_ADMIN` remains available
to the rollback revision.

## 20. Exit criteria

Unit 11 can be acceptance-closed only when:

- the deployed release and coherent web and worker revisions are recorded and healthy;
- the migration is complete;
- `vaultspace_app` executes exactly eleven approved functions;
- the two reset functions match their accepted Unit 10 definitions;
- generic revocation remains owner-only;
- the converted route contains no administrative database client or direct mutation fallback;
- CloudVault passes the complete redemption, audit, cache, isolation, and prior-family regression
  matrix;
- Brightside minimal smoke passes without privacy expansion;
- the prior Unit 10 revisions remain retained;
- `DATABASE_URL_ADMIN` remains present;
- a draft evidence PR is green; and
- a written Advisor close-out is received.

Unit 11 closes only password-reset redemption routing. It does not close password-reset issuance,
administrative cancellation, reset-table privilege contraction, overall W1-2, or W1-3.

## 21. Decisions requested

1. Approve Unit 11 as one route-conversion unit for `POST /api/auth/reset-password`, with no
   issuance or administrator-lifecycle conversion.
2. Approve runtime execution on exactly the two Unit 10 password-reset signatures, producing the
   exact eleven-function matrix.
3. Approve the candidate-before-bcrypt sequence and continued strict legacy-token dual read.
4. Approve one ordinary-role Prisma transaction containing redemption plus every database-derived
   completion and supersession audit.
5. Approve transaction-local event RLS context set only from the validated redemption envelope,
   with no nested transaction.
6. Approve deterministic, organization-scoped completion and supersession audit idempotency keys.
7. Approve post-commit, best-effort `session:v2:<sessionId>` eviction, with live PostgreSQL session
   resolution remaining authoritative.
8. Confirm direct runtime reset-table privileges remain an unchanged explicit residual until all
   administrative cancellation and lifecycle callers are converted.
9. Keep `DATABASE_URL_ADMIN`, other auth families, workflow changes, and W1-3 outside Unit 11.
10. Require a new Advisor checkpoint before implementation merge or deployment.

Until these decisions and a separate implementation GO are received, this document authorizes no
code change beyond proposal publication, no migration, no runtime grant, no route change, no merge
of implementation, no deployment, no Azure mutation, no credential change, no admin-URL removal,
and no W1-3 work.

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_PASSWORD_RESET_CAPABILITY_CONTRACT_PROPOSAL_2026-08-13_v1.md`
- `docs/W1_2_PASSWORD_RESET_REDEMPTION_FOUNDATION_IMPLEMENTATION_2026-08-13_v1.md`
- `docs/W1_2_PASSWORD_RESET_REDEMPTION_FOUNDATION_MIGRATION_RECOVERY_2026-08-13_v1.md`
- `docs/W1_2_PASSWORD_RESET_REDEMPTION_FOUNDATION_DEPLOYMENT_EVIDENCE_2026-08-13_v1.md`
- `prisma/schema.prisma`
- `prisma/rls-policies.sql`
- `prisma/migrations/20260813150000_w1_2_password_reset_redemption_foundation/migration.sql`
- `src/app/api/auth/reset-password/route.ts`
- `src/app/api/auth/reset-password/route.test.ts`
- `src/lib/audit/securityAudit.ts`
- `src/lib/auth/passwordResetCapabilityRepository.ts`
- `src/lib/auth/passwordResetToken.ts`
- `src/lib/auth/session.ts`
- `src/lib/db.ts`
- `scripts/setup-rls-test-db.ts`
- `tests/integration/bootstrap-password-reset-capability.test.ts`
