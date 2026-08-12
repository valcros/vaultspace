# W1-2 Session Mutation Foundation

- **Date:** 2026-08-12
- **Evidence version:** 1
- **Control family:** Database privilege split
- **Implementation unit:** Additive, inert session-mutation foundation
- **Status:** Analysis complete, implementation in draft
- **Governing design:** W1-2 Database Privilege Split Design
- **Dependency:** W1-2 Units 1 through 6 acceptance-closed
- **Starting main:** `39f8b5217af129775d40d87428575346157fdeeb`
- **Security freeze:** Active
- **P0-4:** Accepted and unchanged

## 1. Decision summary

Prepare the next W1-2 unit as an additive session-mutation foundation. The unit installs five
owner-only functions and a typed, unrouted repository. It does not grant runtime execution and does
not change a live session path.

The functions cover the coherent mutation vocabulary needed by later route conversions:

1. create one organization-bound session after active identity checks;
2. refresh one valid session's activity window;
3. invalidate one session by its opaque token;
4. revoke one user's sessions in one organization; and
5. revoke all of one user's sessions, optionally preserving one session.

Every result contains only a session ID and categorical timestamps where required. No function
returns a raw session token, IP address, user agent, password material, 2FA material, or customer
data.

## 2. Why this unit is inert

Session creation and bulk revocation have different authorization proofs:

- password login proves a credential in application code;
- 2FA completion requires a signed temporary identity and one-time backup-code semantics;
- registration creates identity, membership, and session state atomically;
- password reset revokes sessions inside the reset transaction;
- administrator changes require actor, target, organization, and multi-organization safeguards.

A generic runtime-callable function that accepts an arbitrary user ID would be a session-forgery or
denial-of-service surface. This foundation therefore withholds all five grants. Later conversion
units must grant only the exact functions they route and must keep route-specific authorization and
transaction invariants intact. The two bulk helpers must not be granted directly until their caller
proof is internalized or otherwise proven in the reviewed composition.

## 3. Exact function contracts

### 3.1 Create

`public.bootstrap_session_create_v1(text, text, text, timestamptz, text, text)`

Inputs are user ID, organization ID, a 43-character base64url token, requested expiry, optional IP
address, and optional user agent. The function:

- requires an active user, active exact membership, and active organization;
- requires a future expiry no more than 30 days from the database statement timestamp;
- rejects oversized metadata and malformed identifiers or tokens;
- generates the opaque session ID inside PostgreSQL;
- inserts one active session; and
- returns session ID, creation time, and stored expiry only.

A duplicate token produces no row. The caller must treat no row as a failed creation and may not
fall back to direct table access.

### 3.2 Activity refresh

`public.bootstrap_session_refresh_v1(text)`

The function accepts one opaque token and updates only an active session that:

- is idle-valid and inside the seven-day absolute maximum;
- belongs to an active user;
- has an active exact organization membership; and
- belongs to an active organization.

It only writes when the prior activity is at least five minutes old. The idle expiry advances by 24
hours but cannot make an absolute-max-expired session resolvable. The result is session ID and the
stored expiry. Unknown, malformed, revoked, expired, or not-yet-due inputs return no row.

### 3.3 Single-session invalidation

`public.bootstrap_session_invalidate_v1(text)`

The function soft-invalidates one active session by exact opaque token and returns only its session
ID. It intentionally does not require an active membership or organization, so logout can terminate
a session after an identity or membership state change. Unknown, malformed, or already inactive
tokens return no row.

### 3.4 Organization-scoped revocation

`public.bootstrap_session_revoke_user_org_v1(text, text)`

The function soft-invalidates active sessions for one exact user and organization and returns only
the affected session IDs. This is an owner-only composition primitive. It is not safe for a direct
runtime grant without a route-specific actor authorization proof.

### 3.5 Global revocation

`public.bootstrap_session_revoke_user_global_v1(text, text)`

The function soft-invalidates active sessions for one user and returns only the affected session
IDs. Its second argument is an optional session ID to preserve for current-password changes. A null
value revokes every active session. This is also an owner-only composition primitive and is not safe
for a direct runtime grant without the corresponding password-reset, self-service, or administrator
proof.

## 4. Cache contract for the later routed unit

The current Redis key embeds the raw token. Bulk database revocation therefore has to select raw
tokens only to evict cache entries. That conflicts with the narrow mutation projection.

The routed conversion should move the cache key to a versioned session-ID key after the live
session resolver returns its authoritative projection. This is safe because session resolution
already queries PostgreSQL on every acceptance and treats Redis only as a short-lived accelerator.
The mutation functions can then return session IDs, and all single or bulk invalidations can evict
without returning raw tokens.

The foundation does not change the cache today. Old token-keyed entries expire after their existing
60-second TTL and remain unable to authorize without a green live resolver result.

## 5. Database privilege posture

The migration preserves the existing table-level `SELECT` set for
`vaultspace_bootstrap_owner`. It adds only column-scoped privileges on `public.sessions`:

- `INSERT` on the exact columns needed to create a session;
- `UPDATE` on `updatedAt`, `expiresAt`, `lastActiveAt`, and `isActive`.

It does not add table-level `INSERT`, `UPDATE`, or `DELETE`, and it grants no sequence, schema-create,
role, or unrelated-table privilege. All functions remain:

- owned by `vaultspace_bootstrap_owner`;
- `SECURITY DEFINER`;
- `VOLATILE` and `PARALLEL UNSAFE`;
- configured with `search_path=pg_catalog`;
- static SQL or PL/pgSQL without dynamic execution;
- revoked from `PUBLIC`; and
- revoked from `vaultspace_app`.

The owner remains `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`,
`NOCREATEROLE`, and `NOREPLICATION`, with no membership reachability from the runtime role.

## 6. Verification plan

### 6.1 Unit and static checks

- Parameterized exact-signature calls for all five repository methods.
- Malformed inputs return neutral results without querying PostgreSQL.
- Duplicate, malformed, or over-broad projections fail closed.
- No repository result contains a token or metadata field.
- No runtime route imports the new repository.
- The migration contains no runtime grant, direct route change, admin URL change, entrypoint change,
  workflow change, W1-3 change, or P0-4 change.

### 6.2 Disposable PostgreSQL integration

- Exact owner attributes and runtime non-reachability.
- Existing four-table `SELECT` set unchanged.
- Exact session column `INSERT` and `UPDATE` privileges, with no table-level write or delete.
- Exact function signatures, owners, security configuration, comments, checksums, and ACLs.
- Runtime and `PUBLIC` execution denied for all five functions.
- Create allows only an active user, membership, and organization and returns no token.
- Refresh enforces active, idle, absolute, membership, and organization state plus the five-minute
  throttle.
- Single invalidation works even after membership deactivation and is idempotent.
- Organization revoke does not affect sibling-organization sessions.
- Global revoke supports both revoke-all and preserve-one behavior.
- Hostile input and caller search paths cannot change resolution or SQL execution.

### 6.3 Later routed acceptance

The later grant and route conversion requires a separate written GO and controlled deploy. Its
CloudVault matrix must cover session creation, activity refresh, logout, cached-session denial,
organization-scoped revoke, global revoke, password change, password reset, and membership changes.
Brightside remains limited to the separately authorized minimal smoke after CloudVault is green.

## 7. Strawman

- Five functions add catalog and migration burden before any live risk reduction.
- Session creation through a generic callable can become an impersonation primitive if granted
  without a route-specific proof.
- Bulk revoke can become a cross-tenant denial-of-service primitive if granted directly.
- Split cache keys can leave stale entries during rollback if the live resolver is not authoritative.

## 8. Steelman

- One coherent mutation vocabulary prevents each auth route from inventing a different privileged
  write path.
- Owner-only deployment permits catalog and real-role review before any runtime capability expands.
- Session-ID results eliminate raw-token enumeration for cache cleanup.
- Column-scoped owner privileges are materially narrower than broad table writes.
- Additive functions remain compatible with the retained production revision and do not change
  request behavior.

## 9. Pre-Mortem

| If                                                    | Then                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Runtime receives an unexpected new grant              | Fail catalog acceptance, stop, and do not deploy routes            |
| Create accepts inactive or cross-org identity         | Fail integration tests and keep the function owner-only            |
| Refresh resurrects an expired session                 | Fail the unit and preserve the current refresh path                |
| Bulk revoke returns raw tokens                        | Reject the projection and do not merge                             |
| Cache eviction cannot be composed from session IDs    | Keep the current routed mutation paths and revise the cache design |
| Migration changes existing function checksums or ACLs | Fail closed and do not hand-edit an applied migration              |

## 10. Explicit exclusions

- Runtime `EXECUTE` on any new function.
- Session route or helper conversion.
- Redis key or TTL changes.
- Login, 2FA, registration, reset, public-link, viewer-session, or access-request conversion.
- `DATABASE_URL_ADMIN` removal.
- Web entrypoint or migrator-job changes.
- W1-3 or P0-4 changes.
- Production deployment or customer communication.

## 11. Status

**W1-2 UNIT 7 SESSION MUTATION FOUNDATION: IMPLEMENTED IN DRAFT, NOT MERGED, NOT DEPLOYED, NOT
ROUTED.**

W1-2 Units 1 through 6 remain acceptance-closed. W1-2 overall remains open. The live runtime grant
matrix remains login candidate, session resolve, and organization resolve only.

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_SESSION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v2.md`
- `src/lib/auth/session.ts`
- `src/lib/auth/bootstrapRepository.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/auth/change-password/route.ts`
- `src/app/api/auth/reset-password/route.ts`
- `src/app/api/users/[userId]/route.ts`
- `prisma/schema.prisma`
