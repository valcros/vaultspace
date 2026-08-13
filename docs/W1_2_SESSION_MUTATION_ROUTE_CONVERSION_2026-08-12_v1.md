# W1-2 Session Mutation Route Conversion

- **Date:** 2026-08-12
- **Advisor authorization:** ADV-2026-08-12-03
- **Evidence version:** 1
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Session create, sliding refresh, and single-session invalidate
- **Starting main:** `b3694487169336303592a18d20afda9e250494d6`
- **Security freeze:** Active
- **P0-4:** Accepted and unchanged

## 1. Decision summary

Convert the complete narrow session-mutation subfamily in one bounded unit. The unit grants
`vaultspace_app` execution on exactly three already-live and catalog-proven functions:

1. `bootstrap_session_create_v1`;
2. `bootstrap_session_refresh_v1`; and
3. `bootstrap_session_invalidate_v1`.

All production session-creation call sites, the throttled sliding-refresh path, and logout's exact
token invalidation path use the typed `SessionMutationRepository` through the shared session
helper. The two caller-selected bulk-revoke functions remain owner-only and their established
transactional call sites remain unchanged.

This unit does not remove `DATABASE_URL_ADMIN`, convert registration identity reads or writes,
convert password-reset or account-lifecycle bulk revocation, alter Redis key format or TTL, start
W1-3, or change P0-4.

## 2. Why one larger unit is appropriate

Units 1 through 7 separately proved the owner role, the three resolve functions, the five mutation
functions, first runtime grants, route conversion, catalog checks, and CloudVault acceptance. The
three functions in this unit are already deployed, checksummed, and owner-only. Their repository
contracts are already tested against PostgreSQL and an Azure-like constrained migrator.

Create, refresh, and exact-token invalidate form one coherent lifecycle:

- create establishes the opaque token and organization binding;
- resolve remains authoritative on every request;
- refresh advances the idle window after the existing five-minute throttle; and
- invalidate ends exactly that token and evicts its accelerator entry.

Converting the family together avoids an intermediate production state where sessions are created
through one privilege path, refreshed through an administrative path, and invalidated through a
third path.

## 3. Production call-site inventory

### 3.1 Session creation

The shared `createSession` helper calls `bootstrap_session_create_v1` and has no direct table-write
fallback. It accepts an optional trusted Prisma transaction client so password login can keep
session creation and `lastLoginAt` in one organization-scoped transaction.

The four production creation paths are:

| Path           | Authorization proof retained                                    | Conversion                                                           |
| -------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Password login | Narrow login candidate, bcrypt, rate limits                     | Shared constrained create inside existing org transaction            |
| 2FA completion | Signed temp identity, rate limits, TOTP or one-time backup code | Shared constrained create after exact active organization resolution |
| Registration   | Existing invitation or self-signup identity transaction         | Shared constrained create after identity and membership commit       |
| Initial setup  | Existing one-time setup guard and identity transaction          | Shared constrained create after identity and membership commit       |

The function independently requires an active user, active exact membership, and active
organization. A neutral no-row result fails closed. No route falls back to `db.session.create`,
`bootstrapDb.session.create`, or `tx.session.create`.

Registration's broader identity and invitation operations remain on their established bootstrap
path. This unit converts only its session mutation. That retained administrative dependency is one
of the explicit reasons the admin URL cannot yet be removed.

### 3.2 Sliding activity refresh

`validateSession` still resolves live database state on every acceptance. When the reviewed
projection is more than five minutes old, the background refresh calls
`bootstrap_session_refresh_v1` with the same opaque token. The function rechecks active session,
idle expiry, seven-day absolute expiry, active user, exact active membership, and active
organization before updating.

A successful refresh must return the expected session ID. Any mismatch fails closed and evicts the
cache entry. A successful refresh also evicts the prior token-keyed cache entry so the next request
caches the new database expiry. A null result is safe because the resolver remains authoritative.

### 3.3 Single-session invalidation

Logout calls `bootstrap_session_invalidate_v1` through the shared helper, then deletes the cache
entry for the same caller-held token. The function can invalidate an active token even if its
membership or organization has since become inactive. Unknown or already inactive tokens remain
idempotent, and cookie clearing remains best effort as before.

Logout audit context now uses the already-routed session resolver. Audit lookup failure remains
non-critical and cannot prevent invalidation or cookie clearing. The logout route contains no
administrative database fallback.

## 4. Bulk revoke boundary

The following functions remain owner-only:

- `bootstrap_session_revoke_user_org_v1(text, text)`; and
- `bootstrap_session_revoke_user_global_v1(text, text)`.

Password change, password reset, user deletion, email or 2FA changes, and organization membership
changes retain their established transaction-local session updates. This preserves their atomic
password, identity, audit, and revocation invariants. No live path imports or calls either generic
bulk repository method.

Granting either generic bulk function directly to `vaultspace_app` would expose caller-selected
user or organization scope. A later unit requires a separate design that binds the actor and target
inside a non-abusable contract.

## 5. Exact catalog transition

Before this unit, runtime execution is limited to:

- login candidate;
- session resolve; and
- organization resolve.

After this unit, runtime execution is limited to those three plus:

- session create;
- session refresh; and
- session invalidate.

The migration fails closed unless:

- the owner has the exact reviewed role posture and zero memberships;
- the five mutation functions retain their exact signatures, owners, language, security mode,
  volatility, parallel mode, `search_path`, contract markers, and source checksums;
- the mutation functions are owner-only before the grant;
- the owner still has only the reviewed four-table `SELECT` set and exact session-column writes;
- the owner has no table-level `INSERT`, `UPDATE`, or `DELETE` on sessions;
- runtime has exactly the three prior resolve-family grants before this transition; and
- runtime cannot reach the owner role.

The migration temporarily grants owner membership to the migrator only when required to issue the
ACL change, revokes it in the same transaction, and asserts zero residual membership. It then
asserts the exact six-function runtime matrix, `PUBLIC` denial, and owner-only bulk revoke.

## 6. Cache contract

Redis remains a short-lived accelerator and cannot authorize without a successful live session
resolution. This unit intentionally keeps the existing versioned token-keyed cache and 60-second
TTL because all three converted operations already possess the exact token needed for targeted
eviction.

- Create does not populate cache.
- Resolve populates only a complete projection after a successful live database check.
- Successful refresh evicts the previous projection before the next acceptance.
- Invalidate evicts the exact token key even when the database operation is idempotent.
- Cache deletion failure remains non-fatal after the authoritative database mutation and emits only
  categorical counts.

Bulk revocation remains on the old path, so this unit does not need a session-ID cache-key
migration. A future bulk conversion can revisit the versioned key design under its separate proof.

## 7. Failure and rollback behavior

- Session creation returning no row fails the request without direct-table fallback.
- Refresh errors remain non-authoritative and cannot make an invalid session valid.
- Invalidate database errors retain the existing logout response and cookie-clearing behavior.
- Catalog mismatch aborts the migration before any route receives the new capability.
- A failed deployment stops the pipeline. No hand-edited DDL is permitted.
- A user-visible auth or session regression requires rollback to the prior healthy web and worker
  revisions under the controlled deploy plan.

The migration is additive. The prior application revision does not call the newly granted
functions and remains compatible with the widened ACL matrix during rollback.

## 8. Strawman

- Granting session create to the web role can become a session-forgery capability if a route passes
  unproven user or organization identifiers.
- Converting four creation paths at once could obscure a path-specific regression.
- Fire-and-forget activity refresh can conceal a function or grant error.
- Logout audit conversion could accidentally make audit success authoritative.
- Leaving bulk revoke on existing paths creates a temporary split mutation architecture.

## 9. Steelman

- Every creation route retains its existing credential, invitation, 2FA, or setup proof, while the
  function independently rechecks the active identity chain.
- All creation routes share one token generator, projection mapper, and fail-closed repository
  contract instead of duplicating direct writes.
- Refresh remains throttled and cannot extend an idle-expired or absolute-expired session.
- Invalidation uses an exact opaque token and remains safe after membership deactivation.
- The resolver remains authoritative, so Redis cannot preserve access after revocation.
- The two dangerous caller-selected bulk capabilities remain ungranted and unrouted.

## 10. Pre-Mortem

| If                                                                      | Then                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Valid password or 2FA login cannot create a session                     | Roll back; do not restore direct session-table writes as an emergency fallback                         |
| Registration or setup creates identity but session creation fails       | Return failure, preserve evidence, and analyze the retained cross-transaction boundary before retrying |
| Sliding refresh returns a different session ID                          | Evict the cache entry, fail the refresh path, and stop acceptance                                      |
| Refresh resurrects idle-expired or absolute-expired state               | Fail PostgreSQL integration and do not merge                                                           |
| Logout returns success but live resolve still accepts the token         | Fail CloudVault acceptance and roll back                                                               |
| Cache contains a pre-refresh or pre-logout projection                   | Live resolver must win; otherwise roll back immediately                                                |
| Either bulk revoke function becomes app-executable                      | Fail catalog acceptance and stop                                                                       |
| A converted file retains direct session create/update or admin fallback | Fail static validation and do not merge                                                                |
| Main or PR CI exposes a path-specific regression                        | Diagnose the failing path and keep the PR draft                                                        |

## 11. Validation plan

### 11.1 Static and unit validation

- Exact migration grants and six-function runtime matrix.
- No bulk-revoke grant.
- No direct session creation in the four production routes.
- No `bootstrapDb` in shared create, refresh, invalidate, or logout logic.
- Parameterized repository calls and fail-closed projection mapping.
- Session helper creation, refresh eviction, invalidation eviction, and unchanged bulk helpers.
- Route tests for password login, 2FA, registration, setup, and logout.

### 11.2 Disposable PostgreSQL validation

- Fresh migration chain.
- Azure-like constrained migrator execution.
- Exact owner posture, table and column privileges, function checksums, and ACLs.
- Runtime create, due refresh, and exact-token invalidate.
- Runtime denial for organization and global bulk revoke.
- Active identity checks, five-minute throttle, idle expiry, absolute expiry, hostile input, and
  idempotent invalidation.

### 11.3 Controlled production acceptance

After review and a separate execution of the authorized controlled ceremony:

1. prove the exact six-function runtime matrix and owner-only bulk revoke;
2. run CloudVault password login and session creation;
3. prove `/api/auth/me` and protected shell resolution;
4. exercise a safe sliding refresh and verify the stored expiry advances;
5. prove a stale cache projection cannot authorize after live revocation;
6. logout and prove old-session 401;
7. regress prior login, session resolve, and organization resolve behavior; and
8. after CloudVault is green, perform the minimal authorized Brightside shell, known-room, logout,
   and protected re-entry smoke.

No customer-data enumeration is required. Synthetic CloudVault users, memberships, and sessions
must be soft-disabled after acceptance; the retained CloudVault organization stays active.

## 12. Explicit exclusions

- Runtime execution on either bulk-revoke function.
- Conversion of password change, password reset, user deletion, membership-change, email-change,
  or 2FA-reset bulk invalidation.
- A Redis key-format or TTL migration.
- Removal or renaming of `bootstrapDb` outside the exact converted paths.
- `DATABASE_URL_ADMIN` removal.
- Registration, invitation, password-reset, public-link, or access-request family conversion.
- Web entrypoint or migrator-job changes.
- W1-3 enforcement or P0-4 changes.
- Merge or production deployment before exact-head CI and human review.

## 13. Status

**W1-2 UNIT 8 SESSION MUTATION ROUTE CONVERSION: IMPLEMENTED AND LOCALLY VALIDATED; DRAFT PR PENDING.**

W1-2 Units 1 through 7 remain acceptance-closed. W1-2 overall remains open. The production runtime
matrix remains the prior three functions until this unit is reviewed, merged, migrated, and
accepted under the controlled deploy sequence.

## References

- `docs/W1_2_SESSION_MUTATION_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_MUTATION_FOUNDATION_DEPLOYMENT_EVIDENCE_2026-08-12_v1.md`
- `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v2.md`
- `src/lib/auth/session.ts`
- `src/lib/auth/sessionMutationRepository.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/2fa/validate/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/setup/route.ts`
- `src/app/api/auth/logout/route.ts`
- `prisma/migrations/20260812210000_w1_2_session_mutation_foundation/migration.sql`
