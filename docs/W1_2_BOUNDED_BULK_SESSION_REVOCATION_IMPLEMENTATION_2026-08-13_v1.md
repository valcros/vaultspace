# W1-2 Unit 9 Bounded Bulk Session Revocation Implementation

- Date: 2026-08-13
- Advisor authorization: ADV-2026-08-13-03
- Unit: W1-2 Unit 9
- Source PR: #143
- Starting main: `f0df9a18644872f86826443119e38fd20169e730`
- Security freeze: Active
- Admin database URL: Retained
- W1-3: Not started

## 1. Implemented boundary

Unit 9 converts the authenticated bulk session revocation family and the Redis session cache key.
It adds three credential-bound database wrappers:

1. `bootstrap_session_revoke_self_others_v1(text)` for signed-in password changes.
2. `bootstrap_session_revoke_admin_user_org_v1(text, text)` for tenant membership role and active-state changes.
3. `bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)` for email and two-factor changes to a single-organization identity.

The runtime role receives `EXECUTE` only on these wrappers in addition to the six Unit 8 functions.
The generic organization and global revocation primitives remain owner-only and are not called by
application routes.

Password-reset redemption and tenant-admin account deletion remain on their established paths.
The shared-identity deletion policy approved by ADV-2026-08-13-03 is recorded for the later account
lifecycle unit and is not implemented in Unit 9.

## 2. Authorization contracts

The self-service wrapper accepts only the validated actor token. PostgreSQL derives the actor user
and preserved session ID. A valid actor with no other active session receives an authorized nullable
sentinel. An invalid actor receives no row.

The organization-scoped admin wrapper accepts an actor token and target user ID. PostgreSQL requires
an active actor session, active actor identity, active exact membership, active organization, and an
exact `ADMIN` role. The organization ID is derived from the actor session. The target must have a
membership in that organization.

The global admin wrapper repeats the admin checks and counts every target membership, including
inactive memberships. Authorization succeeds only when the target has exactly one membership and
that membership belongs to the actor organization.

Every wrapper performs proof and revocation in one SQL statement. The existing admin PATCH route
retains its target user and membership locks in the surrounding Prisma transaction. The no-login
owner retains only session column write privileges, so Unit 9 does not add user, membership, or
organization write privileges solely to support row locks.

## 3. Membership inventory policy

The original owner-specific membership policy exposed active rows only. That policy could not prove
the approved all-memberships invariant for a shared identity with an inactive second membership.

The migration replaces it with an owner-specific permissive SELECT policy over the membership
inventory. This changes row visibility only for `vaultspace_bootstrap_owner`, which remains NOLOGIN,
NOINHERIT, NOSUPERUSER, and NOBYPASSRLS. Its table and column privilege matrix remains unchanged.
Existing bootstrap functions continue to apply explicit active-membership predicates where their
contracts require active membership.

## 4. Application transaction changes

The server-only authentication helper returns the validated `SessionData` and the exact cookie token
as a separate credential object. The token is not added to `SessionData`, responses, audit metadata,
logs, errors, analytics, or client code.

The signed-in password-change route updates the password and invokes the self-bound wrapper in the
same organization transaction. A neutral wrapper result aborts the transaction. Cache eviction runs
after commit.

The admin PATCH route uses the organization wrapper for role or membership-active changes. It uses
the single-organization global wrapper for email or two-factor changes. A neutral organization result
retains the route's existence-hiding response. A neutral global result preserves the shared-identity
403 contract. Identity or membership changes cannot commit without authorization-proven revocation.

## 5. Cache-key conversion

Session cache keys now use `session:v2:<sessionId>`. The live PostgreSQL resolver runs before every
cache read and remains the only authorization source. Cache envelope version 2 is populated only
after successful live resolution.

Exact-token invalidation, refresh, bounded bulk wrappers, and deferred legacy paths now pass session
IDs to cache eviction. Old token-keyed entries are unreachable and expire under the existing
60-second TTL. Cache deletion failures remain non-authoritative and log categorical counts only.

## 6. Catalog contract

After migration, `vaultspace_app` may execute exactly nine `bootstrap_*` functions:

1. login candidate;
2. session resolve;
3. organization resolve;
4. session create;
5. session refresh;
6. exact-token invalidate;
7. self-others revoke;
8. admin organization-scoped user revoke; and
9. admin global single-organization user revoke.

The two generic revocation functions remain denied to both `vaultspace_app` and `PUBLIC`. All three
new wrappers are owned by `vaultspace_bootstrap_owner`, use `SECURITY DEFINER`, are volatile and
parallel unsafe, set `search_path=pg_catalog`, have contract markers, and are source-checksummed.

## 7. Verification completed before PR publication

- Full unit and route suite: 1,378 passed across 146 test files; 7 tests and 1 test file skipped
  under their existing guards.
- TypeScript type-check: Passed.
- Production Next.js build: Passed.
- ESLint: Passed with one pre-existing unrelated hook-dependency warning and no errors.
- Prettier and diff whitespace checks: Passed.
- Fresh PostgreSQL 15 migration chain: All 49 migrations applied.
- Guarded fresh-role RLS setup: Passed with the exact nine-function matrix.
- PostgreSQL behavior integration: 16 passed.
- Production-like migration prestate: Exact Unit 8 six-function runtime matrix verified before the
  Unit 9 migration; Unit 9 migration then committed cleanly.
- Generic primitives remained owner-only in both fresh and production-like paths.
- No file, workflow, Azure resource, production database, or deployment was changed during local
  validation.

The first disposable container run detected an incorrect locally calculated source MD5. The
transaction rolled back. The fingerprint was corrected, then the migration passed from a clean
second container. A final integration invocation initially used the wrong disposable superuser
password and connected to no database; after resetting only the local disposable credentials, the
same 16-test PostgreSQL matrix passed. Both disposable containers were retained and stopped pending
explicit cleanup authorization.

## 8. Explicit exclusions

- No runtime `EXECUTE` on either generic bulk function.
- No password-reset redemption conversion.
- No tenant-admin account deletion conversion.
- No registration, public-link, viewer-session, or access-request conversion.
- No workflow path-filter change.
- No migrator or entrypoint cutover.
- No `DATABASE_URL_ADMIN` removal.
- No W1-3 or P0-4 change.
- No production merge or deployment under implementation-only authority.

## References

- `docs/W1_2_BULK_SESSION_REVOCATION_CONVERSION_PROPOSAL_2026-08-13_v1.md`
- `prisma/migrations/20260813050000_w1_2_bounded_bulk_session_revocation/migration.sql`
- `src/lib/auth/sessionMutationRepository.ts`
- `src/lib/auth/session.ts`
- `src/lib/middleware/auth.ts`
- `src/app/api/auth/change-password/route.ts`
- `src/app/api/users/[userId]/route.ts`
- `tests/integration/bootstrap-session-mutation.test.ts`
- `scripts/setup-rls-test-db.ts`
