# W1-2 Bulk Session Revocation Conversion Proposal

- **Date:** 2026-08-13
- **Advisor authorization:** ADV-2026-08-13-02
- **Proposal version:** 1
- **Control family:** W1-2 database privilege split
- **Proposed implementation unit:** Unit 9 authenticated bulk session revocation
- **Starting main:** `f0df9a18644872f86826443119e38fd20169e730`
- **Unit 8 status:** Acceptance-closed
- **Security freeze:** Active
- **P0-4:** Accepted and unchanged
- **Implementation authority:** Not granted by this proposal

## 1. Decision summary

Do not grant `vaultspace_app` execution on either generic bulk function:

1. `bootstrap_session_revoke_user_org_v1(text, text)`; or
2. `bootstrap_session_revoke_user_global_v1(text, text)`.

Both functions accept caller-selected target scope without proving the actor. They are safe as
owner-only composition primitives but unsafe as runtime entry points.

The recommended Unit 9 implementation is an additive set of credential-bound wrappers for the
authenticated bulk-revocation paths. Each wrapper must revalidate the actor in PostgreSQL, derive
scope that the caller is not allowed to choose, and then call the existing owner-only primitive.
The application role receives execution only on the new bounded wrappers. The two generic
functions remain owner-only and unrouted.

Unit 9 should also complete the previously reviewed move from raw-token Redis keys to versioned
session-ID keys. The existing bulk functions already return session IDs, so this permits precise
cache eviction without returning or selecting raw bearer tokens in application code.

Password-reset redemption and tenant-admin account deletion are not safe to fold into the first
authenticated wrapper unit. Password reset has no authenticated session actor, and account
deletion currently has global identity effects. Those paths require separate capability and
lifecycle contracts before `DATABASE_URL_ADMIN` can be removed.

## 2. Current production posture

Unit 8 is acceptance-closed at release
`691524ce0088b3db8dffe1b60ad60a5515b3e80e`, web revision
`ca-vaultspace-web--0000297`, and worker revision
`ca-vaultspace-worker--0000280`.

`vaultspace_app` can execute exactly six functions:

1. `bootstrap_login_candidate_v1(text)`;
2. `bootstrap_session_resolve_v1(text)`;
3. `bootstrap_organization_resolve_v1(text, text)`;
4. `bootstrap_session_create_v1(...)`;
5. `bootstrap_session_refresh_v1(text)`; and
6. `bootstrap_session_invalidate_v1(text)`.

The two generic bulk functions are deployed, checksummed, revoked from `PUBLIC`, revoked from
`vaultspace_app`, and owned by `vaultspace_bootstrap_owner`. The owner remains a no-login,
no-inherit, non-superuser role with no runtime membership reachability and no table-level session
write privilege.

`DATABASE_URL_ADMIN` remains present. W1-3 is not started.

## 3. Threat model and non-negotiable boundary

The application database role is not an authorization principal. A compromised route, SQL
injection, or incorrectly wired repository call must not be able to revoke an arbitrary user's
sessions by supplying a user ID, organization ID, or session ID.

The existing owner-only primitives do not establish any of the following:

- who requested the revocation;
- whether the requester has an active session;
- which organization the requester is acting in;
- whether the requester is an administrator in that organization;
- whether the target belongs to the same organization;
- whether a global action is permitted for a shared multi-organization identity; or
- whether a preserved session actually belongs to the requester.

Runtime execution on either generic primitive would therefore turn any application-tier misuse
into a caller-selected denial-of-service capability. Input validation and parameterized SQL do not
solve that authorization problem.

The binding rule is:

> A runtime-callable bulk revocation function may accept a bearer proof and a narrowly permitted
> target identifier, but it may not accept caller-selected tenant scope or a caller-selected
> preserved session. PostgreSQL must derive those values from the validated bearer proof and
> locked catalog rows.

## 4. Production caller inventory

| Caller                                       | Current effect                                                    | Required proof                                                                           | Proposed disposition                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Signed-in password change                    | Revoke every session for the same user except the current session | Current session token plus current-password proof retained in the route                  | Convert in Unit 9 through a self-bound wrapper that derives user and preserved session from the actor token |
| Admin membership role or active-state change | Revoke target sessions only in the caller's organization          | Active admin actor and target membership in the same organization                        | Convert in Unit 9 through an admin-org wrapper with no organization argument                                |
| Admin email or 2FA reset                     | Revoke all target sessions after a global identity change         | Active admin actor, same-organization target, and target not shared across organizations | Convert only if the SQL wrapper independently proves the single-organization invariant                      |
| Password-reset redemption                    | Revoke all sessions for the reset subject                         | Valid, unused, unexpired reset capability bound to the reset row                         | Defer to the password-reset conversion unit; no session actor exists                                        |
| Tenant-admin account deletion                | Currently deactivates a global user and revokes all sessions      | Active admin actor plus an explicit cross-tenant lifecycle policy                        | Defer; do not preserve the current global behavior by granting a broad function                             |
| Generic `invalidateAllUserSessions` helper   | Caller-selected global user scope                                 | No production bearer binding                                                             | Remove or keep unrouted; never back it with a runtime grant                                                 |

The reset and deletion deferrals are not permission to leave the admin URL indefinitely. They are
explicit dependencies for later W1-2 units and the final replacement-path matrix.

## 5. Proposed SQL contracts

### 5.1 Self-service global revoke, preserving the actor session

Proposed signature:

`public.bootstrap_session_revoke_self_others_v1(input_actor_token text)`

The function must:

1. validate the exact token shape;
2. lock and resolve an active, unexpired session;
3. require an active user, active exact membership, and active organization;
4. derive `userId` and the preserved session ID from that resolved session;
5. call `bootstrap_session_revoke_user_global_v1` with only those derived values; and
6. return an authorization-proven envelope plus unique revoked session IDs in deterministic order.

An authorized actor with no other active sessions must return one authorized result with no session
ID. An invalid actor must return no result. This distinction lets the route commit a valid
zero-revocation password change while still failing closed when SQL authorization was not proven.

There is no user ID, organization ID, preserved session ID, or Boolean scope argument. A caller
who possesses only their own bearer token can revoke only their own other sessions. The current
password check remains in application code and the password update plus revocation remains one
transaction.

If a future product feature needs "sign out everywhere including this device," it should receive a
separate self-bound function or compose self-others with exact-token invalidation. It must not add
caller-selected identity scope to this contract.

### 5.2 Tenant-admin organization-scoped target revoke

Proposed signature:

`public.bootstrap_session_revoke_admin_user_org_v1(input_actor_token text, input_target_user_id text)`

The function must:

1. resolve and lock the active actor session and its exact membership;
2. require the actor user, membership, session, and organization to be active and unexpired;
3. require the actor membership role to be `ADMIN`, preserving current route policy;
4. derive the organization ID exclusively from the actor session;
5. require and lock a target membership in that same organization;
6. call `bootstrap_session_revoke_user_org_v1` with the target user and derived organization; and
7. return an authorization-proven envelope plus only unique revoked session IDs.

The function must not accept an organization ID. A target that is absent from the actor's
organization produces a neutral no-row result. The application must map that result consistently
with the route's existing existence-hiding behavior.

The current route authorizes `ADMIN`, not `canManageUsers`. Unit 9 must not broaden that policy to a
viewer with a management flag unless a separate product decision explicitly changes the route
contract.

### 5.3 Tenant-admin global target revoke for single-organization identities

Proposed signature:

`public.bootstrap_session_revoke_admin_user_global_single_org_v1(input_actor_token text, input_target_user_id text)`

This wrapper is permitted only for the existing email-change and 2FA-reset branch. In addition to
the admin-org checks above, it must:

1. lock all target memberships in a deterministic order;
2. prove the target has exactly one organization membership under the reviewed lifecycle rule;
3. prove that membership is in the actor's organization;
4. derive the target user from the locked membership;
5. call `bootstrap_session_revoke_user_global_v1` with no preserved session; and
6. return an authorization-proven envelope plus only unique revoked session IDs.

For both admin wrappers, an authorized target with no active session returns an authorized result
with no session ID. An authorization failure returns no result. A zero-row generic primitive result
must never erase the wrapper's successfully proven authorization marker.

The application already blocks global email and 2FA changes for shared identities. The database
wrapper must repeat that invariant so application-role misuse cannot bypass it.

Whether the count is based on all memberships or only active memberships must match the current
cross-tenant identity policy before implementation. The existing route counts all memberships.
The recommendation is to preserve that stricter rule unless the product owner explicitly changes
it.

### 5.4 Password-reset subject revoke, separate unit

Password reset cannot use the authenticated wrappers because the actor has no valid session. A
later reset-family function must derive the user from a valid reset capability, never from an
independent user-ID argument.

The preferred design is a password-reset redemption function that atomically:

1. resolves and locks the valid stored reset credential;
2. proves unused, unexpired, active-user state;
3. derives the subject user ID from the reset row;
4. applies the password transition and reset-flow terminal state; and
5. revokes the derived subject's sessions through the owner-only global primitive.

A smaller revoke-only wrapper is acceptable only if it independently verifies a single-use reset
capability inside the same transaction. An application assertion that a reset token was previously
checked is not sufficient authorization for a function that accepts a user ID.

### 5.5 Account deletion, separate lifecycle decision

The current tenant-admin delete route globally deactivates and redacts the user, even when that
identity may have memberships in other organizations. A direct conversion would preserve a
cross-tenant effect that deserves an explicit product and privacy decision.

Recommended policy:

- for a shared identity, a tenant admin may deactivate only the membership in the actor's
  organization and revoke only that organization's sessions;
- a global identity deletion is allowed only when the target has no other organization membership,
  or through a separately authorized system-operator process; and
- the SQL contract must lock and prove the selected condition before any global user mutation.

Unit 9 must not silently resolve this policy question by granting the generic global function.

## 6. Transaction and concurrency requirements

Authorization, identity or membership mutation, audit creation, and session revocation must remain
inside the caller's existing Prisma transaction. The repository must accept a transaction query
client and must not switch to the global runtime pool mid-operation.

Required lock order:

1. actor session and actor identity;
2. actor organization membership and organization;
3. target identity;
4. target memberships ordered by organization ID;
5. target sessions ordered by session ID; and
6. mutation plus audit rows according to the existing password-reset and user-lifecycle order.

The implementation analysis must reconcile this order with `lockPasswordResetUser` before code is
merged. The same logical operation must not acquire user, membership, reset, and session locks in
different orders across password reset, admin update, and deletion routes.

Wrapper authorization and the call to the owner-only primitive must execute in one database
transaction. There must be no gap where membership or role can change between proof and revoke.

## 7. Cache-key conversion

### 7.1 Target design

Replace raw token keys such as `session:<token>` with a versioned session-ID key such as
`session:v2:<sessionId>`.

The live session resolver remains authoritative on every request. The sequence becomes:

1. resolve the opaque token through `bootstrap_session_resolve_v1`;
2. deny immediately on a neutral or invalid projection;
3. use the returned session ID to read the optional Redis projection;
4. compare the cached projection with the live projection; and
5. populate or replace the session-ID cache entry only after a successful live resolve.

Bulk wrappers already return session IDs, so the application can evict the exact affected keys
without receiving raw tokens. Exact-token invalidation returns its session ID and can use the same
helper. Old token-keyed entries become unreachable and expire under the current 60-second TTL.

### 7.2 Security properties

- Redis cannot authorize without a successful live database projection.
- No bulk function returns a bearer token.
- No route selects raw tokens solely for cache cleanup.
- Cache deletion failure remains non-authoritative and logs only categorical counts.
- A revoked session is denied even if an old token-keyed or session-ID cache entry remains.

### 7.3 Rollback compatibility

The cache key change is performance-compatible in both directions because the database resolver is
authoritative. A rollback may cause cache misses until the active revision repopulates its preferred
key format. It cannot make a revoked session valid.

The implementation should centralize key generation and bump the cache envelope version. Tests
must prove that neither log output nor Redis inspection helpers expose the raw token.

## 8. Recommended Unit 9 implementation boundary

The preferred first bulk conversion unit includes:

1. the session-ID cache-key migration;
2. the self-others wrapper and signed-in password-change route;
3. the admin organization wrapper and membership role or active-state branches;
4. the admin single-organization global wrapper and the email or 2FA branches;
5. exact catalog fail-closed checks and runtime grants only on those wrappers;
6. repository, SQL integration, route, concurrency, and cache tests; and
7. one controlled production deploy with the full CloudVault matrix.

It excludes:

- runtime execution on either generic `revoke_user_*_v1` function;
- password-reset redemption;
- tenant-admin account deletion until the global-vs-membership policy is decided;
- registration, public-link, viewer-session, or access-request conversion;
- migrator or entrypoint cutover;
- `DATABASE_URL_ADMIN` removal;
- W1-3 or P0-4 changes; and
- any second deploy without a separate Advisor GO.

This boundary converts a coherent authenticated family while keeping capability-based and
cross-tenant lifecycle flows separate. It is larger than the early W1-2 units but does not combine
unrelated authorization models.

## 9. Catalog acceptance for the proposed Unit 9

After a successful Unit 9 migration, `vaultspace_app` may execute exactly:

1. the six currently approved Unit 8 functions;
2. `bootstrap_session_revoke_self_others_v1(text)`;
3. `bootstrap_session_revoke_admin_user_org_v1(text, text)`; and
4. `bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)`.

`vaultspace_app` and `PUBLIC` must still lack execution on:

- `bootstrap_session_revoke_user_org_v1(text, text)`;
- `bootstrap_session_revoke_user_global_v1(text, text)`; and
- every other unapproved `bootstrap_*` function.

All new wrappers must be:

- owned by `vaultspace_bootstrap_owner`;
- `SECURITY DEFINER`;
- `VOLATILE` and `PARALLEL UNSAFE`;
- configured with `search_path=pg_catalog`;
- statically schema-qualified with no dynamic SQL;
- revoked from `PUBLIC` before any narrow runtime grant; and
- protected by contract markers and reviewed source checksums.

The owner posture, membership closure, exact table and column privileges, and no table-level
`INSERT`, `UPDATE`, or `DELETE` posture must remain unchanged. The migration must assert both the
pre-state and final exact execution matrices and abort on drift.

## 10. Application contract

Add a server-only authenticated credential helper that returns both the validated `SessionData`
and the exact opaque token used for validation. The token must remain confined to server-side route
and repository code. It must not be added to `SessionData`, JSON responses, audit metadata, logs,
errors, client components, or analytics.

Every wrapper result contains an authorization-proven marker and zero or more session IDs.
Repository mapping must require the marker, discard only the explicitly nullable authorized
sentinel, and reject malformed or duplicate non-null IDs. An empty SQL result means authorization
was not proven and must fail the requested security-sensitive operation. It must not fall back to
`bootstrapDb`, direct `session.updateMany`, or a generic owner-only function.

The password update or admin identity mutation must not commit if the required revocation wrapper
fails. Cache deletion occurs after the authoritative transaction commits and may not reverse the
database result.

## 11. Verification and acceptance matrix

### 11.1 Static and unit checks

- No application grant on either generic bulk function.
- No route import or repository call to the generic methods.
- No `bootstrapDb` or direct session-table mutation in converted paths.
- No raw token in wrapper projections, cache keys after migration, logs, audit metadata, or errors.
- Self wrapper has no target or scope argument.
- Admin wrappers have no organization or preserved-session argument.
- Authorized zero-session results are distinct from authorization failures.
- Global admin wrapper independently rejects shared identities.
- Transaction-client routing is preserved.
- Cache misses and cache deletion failures cannot authorize or roll back database revocation.

### 11.2 Disposable PostgreSQL checks

- Self token revokes only the same user's other sessions and preserves the exact actor session.
- Self and admin wrappers return an authorized sentinel when the valid target has no active session.
- Viewer token cannot call either admin wrapper successfully.
- Inactive, expired, unknown, malformed, or wrong-organization actor tokens return neutral results.
- Admin actor can revoke a target only inside the actor's organization.
- An admin from organization A cannot revoke organization B sessions by choosing identifiers.
- Organization wrapper leaves the target's other-organization sessions active.
- Global wrapper rejects a shared identity and accepts only the reviewed single-organization case.
- Concurrent role, membership, and revoke attempts serialize without scope escape.
- Hostile caller `search_path` and transaction GUC values cannot alter authorization.
- Generic functions remain owner-only throughout migration and rollback proofs.

### 11.3 CloudVault production matrix

Use dedicated synthetic users and preserve the CloudVault organization:

1. health and exact release identity;
2. exact final runtime execution matrix and owner-only generic primitives;
3. login, session resolve, and organization resolve regressions;
4. password change preserves the current session and revokes another same-user session;
5. revoked session is denied despite a warmed cache;
6. admin membership change revokes only the target's CloudVault session;
7. sibling-organization session remains active for the organization-scoped case;
8. viewer actor cannot trigger admin-target revocation;
9. cross-organization target attempt is neutral and does not reveal target state;
10. shared-identity global attempt is rejected;
11. accepted single-organization email or 2FA path revokes all target sessions;
12. logout, post-logout 401, and unknown-token denial remain green; and
13. synthetic users, memberships, and sessions are soft-cleaned.

Minimal Brightside smoke remains limited to authenticated shell, known room, logout, and protected
re-entry after CloudVault is green. No customer-data enumeration is authorized.

## 12. Strawman

- Passing an actor token to SQL increases the number of server-side components that can handle a
  bearer credential.
- Moving the cache key and converting three authorization branches in one deploy can complicate
  diagnosis.
- The global single-organization wrapper duplicates an application precheck and can drift if the
  product policy later changes.
- Leaving password reset and deletion on established paths preserves a temporary split
  architecture.

## 13. Steelman

- The actor token is already the authentication source of truth and is the only existing
  unforgeable request-bound proof available to PostgreSQL.
- SQL derives organization and preserved-session scope, so runtime cannot choose the dangerous
  fields accepted by the generic primitives.
- The live resolver remains authoritative, making the session-ID cache transition safe and
  rollback-tolerant.
- Existing owner-only functions remain useful internal primitives without exposing their generic
  contract to the app role.
- Separating reset capability and account lifecycle avoids combining three different authorization
  models in one production cutover.

## 14. Pre-mortem

| If                                                                            | Then                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A viewer or cross-org actor revokes a target session                          | Fail acceptance, revoke only the new wrapper grant through the migrator path, and stop            |
| Password change revokes the current session                                   | Roll back to the prior retained revision; do not add a caller-selected preserved-session argument |
| Shared identity receives a global revoke from one tenant admin                | Roll back and treat as a cross-tenant security incident                                           |
| Revoked session is accepted from Redis                                        | Roll back; the live projection or cache-key ordering is wrong                                     |
| Wrapper returns raw tokens or logs the actor token                            | Stop before deploy and treat as credential exposure                                               |
| Transaction revokes sessions but identity mutation rolls back, or the inverse | Stop; repository client or transaction composition is incorrect                                   |
| Account deletion semantics are folded into Unit 9 without a policy decision   | Reject the PR as out of scope                                                                     |
| `DATABASE_URL_ADMIN` is removed during Unit 9                                 | Unauthorized; restore configuration and stop                                                      |

## 15. Rollout and rollback plan

Implementation requires a separate Advisor GO and the established controlled sequence:

1. human review of SQL authorization, lock order, cache conversion, grants, and route inventory;
2. disable deploy workflow `251547585` and prove no active real deploy;
3. merge with an exact-head guard;
4. wait for exact-main CI and image publication while deploy is disabled;
5. re-enable without side-effect deploy;
6. dispatch exactly once for the accepted main SHA;
7. verify catalog, release coherence, CloudVault, and minimal Brightside;
8. draft evidence; and
9. stop for written close-out.

The migration is additive and the generic functions retain their owner-only ACLs. The prior web and
worker revisions remain compatible with the additive wrappers and grants. `DATABASE_URL_ADMIN`
stays present so rollback uses the established paths. No hand-edited production DDL is permitted.

## 16. Remaining W1-2 schedule estimate

The source inventory shows the remaining administrative dependencies are concentrated in four
families: authenticated bulk revocation, password reset and admin identity lifecycle, registration,
and public-link or viewer access. Migrator or entrypoint cutover plus the final replacement matrix
and admin-URL removal remain after those route families.

Assuming one controlled deploy per coherent family, stable CI, no rollback, and Advisor responses
within one working day, the planning estimate is:

| Work                                                                     | Estimated engineering time |
| ------------------------------------------------------------------------ | -------------------------: |
| Unit 9 authenticated bulk revoke plus cache key                          |        1 to 2 working days |
| Reset and admin lifecycle replacement contracts                          |        2 to 3 working days |
| Registration and public-link or viewer families                          |        2 to 3 working days |
| Migrator or entrypoint cutover, full matrix, admin-URL removal, evidence |        1 to 2 working days |
| **Total remaining W1-2**                                                 |   **6 to 10 working days** |

The current target window for W1-2 written close-out is 2026-08-21 through 2026-08-27. W1-3 design
transition can begin after that close-out and a separate Advisor GO. Production W1-3 enforcement
must not share the final W1-2 deploy and is not included in this estimate.

The largest uncertainty is the password-reset and cross-tenant account-lifecycle contract, not the
session SQL itself. A policy decision that global tenant-admin deletion is disallowed for shared
identities reduces both security risk and implementation ambiguity.

## 17. Decisions requested before implementation

1. Approve the Unit 9 boundary as authenticated self and tenant-admin revocation plus session-ID
   cache conversion.
2. Confirm that `ADMIN` remains the exact tenant-management role check for this unit.
3. Confirm that the global admin wrapper must preserve the existing all-memberships count rule.
4. Confirm that shared-identity tenant deletion becomes organization-scoped unless separately
   authorized as a system operation.
5. Keep password-reset revocation in the reset-family conversion unit.

Until these decisions and a separate controlled merge/deploy GO are received, this document is
analysis only. It does not authorize implementation, a runtime grant, a route conversion, an Azure
change, admin-URL removal, or W1-3.

## References

- `prisma/migrations/20260812210000_w1_2_session_mutation_foundation/migration.sql`
- `src/lib/auth/sessionMutationRepository.ts`
- `src/lib/auth/session.ts`
- `src/lib/middleware/auth.ts`
- `src/app/api/auth/change-password/route.ts`
- `src/app/api/auth/reset-password/route.ts`
- `src/app/api/users/[userId]/route.ts`
- `docs/W1_2_SESSION_MUTATION_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_MUTATION_ROUTE_CONVERSION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_MUTATION_ROUTE_CONVERSION_DEPLOYMENT_EVIDENCE_2026-08-13_v1.md`
