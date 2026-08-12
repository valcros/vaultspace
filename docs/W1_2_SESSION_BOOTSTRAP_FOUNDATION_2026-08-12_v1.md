# W1-2 Session Bootstrap Foundation

- **Date:** 2026-08-12
- **Evidence version:** 1
- **Control family:** Database privilege split
- **Implementation unit:** Additive session-resolve foundation
- **Status:** Analysis complete, implementation authorized
- **Governing design:** W1-2 Database Privilege Split Design
- **Dependency:** W1-2 Unit 1 acceptance-closed by written Advisor decision on 2026-08-12
- **Security freeze:** Active
- **P0-4:** Accepted and unchanged

## 1. Decision summary

Implement the next W1-2 unit as one additive session-resolve capability that remains inert in
production:

1. Extend `vaultspace_bootstrap_owner` with `SELECT` on `public.sessions` only.
2. Add one exact `SECURITY DEFINER` function for resolving an active, unexpired,
   organization-bound application session.
3. Reuse the three active-row owner policies already deployed for users, memberships, and
   organizations.
4. Return only the projection required to construct a validated session snapshot and decide
   whether activity refresh is due.
5. Revoke function execution from `PUBLIC` and do not grant execution to `vaultspace_app` in this
   foundation unit.
6. Extend the typed `BootstrapRepository` through the ordinary runtime `db` client.
7. Add unit and real PostgreSQL catalog, privilege, projection, hostile-input, expiry, and neutral
   denial tests.
8. Do not convert `validateSession`, server-component session resolution, middleware, logout, or
   any route in this unit.

This is the smaller of the two Advisor-authorized next-slice options. It establishes the next
reviewable database surface without changing request behavior. `DATABASE_URL_ADMIN`,
`bootstrapDb`, startup migrations, and the existing session paths remain available.

## 2. Why session resolve is the next bounded capability

Session resolution is a prerequisite for removing the admin connection from the public web
process. It currently performs pre-tenant reads before an organization context is known and is
duplicated across `validateSession` and server-component resolution.

The read boundary can be separated safely from session mutation:

- this unit resolves one valid session and returns a minimal snapshot;
- a later unit can add refresh and invalidation functions with their own locking and mutation
  contracts;
- route conversion can then compose the reviewed read and mutation capabilities;
- runtime execution remains withheld until that conversion unit has parity and CloudVault tests.

Combining resolve, refresh, logout, cache behavior, and route conversion now would expand the
failure surface and make neutral-denial regressions harder to isolate.

## 3. Exact implementation boundary

### 3.1 Additive migration

The migration will:

- verify the existing owner has the exact `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`,
  `NOCREATEDB`, `NOCREATEROLE`, and `NOREPLICATION` posture;
- fail if the runtime role can reach or assume the owner;
- grant `SELECT` on `public.sessions` to the owner;
- preserve the existing exact privileges on users, user organizations, and organizations;
- create one SQL function with one text argument and a named table return type;
- use fully qualified objects and static SQL only;
- set `search_path` to `pg_catalog`;
- transfer ownership to `vaultspace_bootstrap_owner` through temporary migrator membership, then
  revoke that membership;
- revoke all execution from `PUBLIC` and any pre-existing runtime grant before ownership transfer;
- add a versioned contract comment;
- fail the transaction if role, function, ownership, configuration, or ACL posture is not exact.

The migration will not:

- enable RLS on `sessions` or change FORCE RLS posture;
- change the existing active-row owner policies;
- mutate any session, user, membership, or organization row;
- grant `INSERT`, `UPDATE`, `DELETE`, sequence, schema-create, or role-create privileges;
- create a credential or Key Vault secret;
- change Azure resources, the web entrypoint, or a deployment workflow;
- remove or edit the already applied Unit 1 migration.

### 3.2 Function contract

The proposed exact signature is:

`public.bootstrap_session_resolve_v1(text)`

The input is one opaque session token. The function returns at most one row and requires:

- an exact stored-token match;
- an active session;
- a non-null organization binding;
- an idle expiry later than the database statement timestamp;
- a creation timestamp still inside the existing seven-day absolute maximum;
- an active user;
- an active membership for the session's exact user and organization;
- an active organization.

The function returns:

- session ID;
- user ID and organization ID;
- session creation, idle-expiry, and last-active timestamps;
- user email, first name, last name, and active state;
- organization name and slug;
- membership role, `canManageUsers`, and `canManageRooms`.

The function does not return:

- the raw session token;
- IP address or user agent;
- password hash;
- TOTP secret or backup-code hashes;
- unrelated memberships or organizations;
- document, room, link, reset, or customer data.

Unknown, malformed, inactive, unbound, expired, absolute-max-expired, revoked-membership, and
inactive-organization inputs return no row. The function does not reveal which condition failed.
Time validity uses the database statement timestamp. The caller cannot supply a past timestamp to
resurrect an expired session.

### 3.3 Typed repository

The repository method will:

- validate the expected base64url token shape before querying;
- call the exact function signature through a parameterized Prisma query;
- map the named database projection to a narrow TypeScript type;
- convert timestamps to valid `Date` instances;
- return `null` for no result;
- fail closed on duplicate rows, invalid roles, missing fields, invalid timestamps, or inactive
  projections;
- never use or fall back to `bootstrapDb`;
- never log the token or returned row;
- remain unused by all routes and session helpers in this unit.

## 4. Security invariants

All of these must be true before the unit is reviewable:

1. `vaultspace_bootstrap_owner` retains its exact constrained attributes.
2. `vaultspace_app` cannot reach or assume the owner.
3. The owner has table `SELECT` only on sessions and the three previously approved identity tables.
4. The owner has no write, sequence, schema-create, or unrelated table privilege.
5. The new function has one signature and no overload.
6. The function owner, language, volatility, parallel mode, and search path are exact.
7. The function source contains no dynamic SQL.
8. `PUBLIC` cannot execute the function.
9. `vaultspace_app` cannot execute the function before route conversion.
10. The function returns no raw token, credential, 2FA material, or unrelated row data.
11. Token input is a bound parameter and hostile caller search paths have no effect.
12. Inactive and expired states return the same neutral no-row result as an unknown token.
13. The session's user, organization, and membership identities must all match the stored binding.
14. A session beyond either idle expiry or absolute maximum cannot resolve.
15. Existing Unit 1 login function posture and behavior remain green.
16. No production route imports or calls the new repository method.

## 5. Verification plan

### 5.1 Static and unit checks

- Prove malformed tokens do not query PostgreSQL.
- Prove the exact function call is parameterized.
- Prove null, one-row, duplicate-row, invalid-role, invalid-date, and incomplete-row behavior.
- Prove the result contains only the documented keys.
- Prove the route and session-helper import graph is unchanged.
- Prove the diff has no runtime execution grant, `DATABASE_URL_ADMIN`, entrypoint, workflow, Azure,
  Key Vault, W1-3, or scan change.

### 5.2 Disposable PostgreSQL integration

Run all migrations and RLS setup against a fresh PostgreSQL 15 database, then prove:

- exact owner attributes and recursive role non-reachability;
- exact four-table `SELECT` privilege set and no other table privileges;
- exact function signature, result projection, owner, language, `SECURITY DEFINER` state,
  volatility, parallel mode, search path, comment, and stored source checksum;
- owner-only execution ACL in the inert posture;
- runtime and `PUBLIC` execution denial by default;
- one temporary exact runtime grant enables only the reviewed function call;
- active session projection under a hostile caller search path;
- neutral denial for malformed, unknown, inactive, unbound, idle-expired, absolute-max-expired,
  inactive-user, inactive-membership, and inactive-organization cases;
- no raw token or protected identity material in the projection;
- temporary test execution is revoked before commit;
- the existing login-candidate integration remains green.

### 5.3 Not part of this unit

- Runtime execution grant.
- Session route or helper conversion.
- Session refresh or invalidation mutation.
- Redis cache contract changes.
- Login or 2FA route conversion.
- Organization, domain, registration, reset, public-link, or access-request functions.
- One-shot migrator job or web entrypoint changes.
- `DATABASE_URL_ADMIN` removal.
- Production deployment or CloudVault auth-matrix execution.
- W1-3 policy removal or production FORCE changes.

## 6. Strawman

### What if this is unnecessary because sessions are already high-entropy and the table has no RLS?

The raw session lookup is only one part of validation. The public web currently uses an elevated
connection to join or separately read the user, membership, and organization state required to
accept the session. Those identity tables are RLS-protected and pre-tenant. A constrained function
removes the need for broad admin reads when this path is later converted.

### Why not grant the runtime role direct `SELECT` on sessions?

Direct table access would let any compromised query enumerate active session rows and token
metadata. The function exposes one equality lookup and never returns the raw token, IP address, or
user agent.

### Why not convert `validateSession` now?

The current path also deactivates expired sessions, refreshes activity, checks Redis, and clears
cache entries. Converting all of that in the same unit would combine read privileges, mutations,
cache semantics, and user-visible authentication behavior. The inert function can be reviewed and
catalog-tested first.

### Why not accept a caller-supplied current time for deterministic tests?

That would let an untrusted runtime caller choose a past time and resolve expired sessions. The
database statement timestamp is authoritative. Tests create fixtures relative to the real database
clock instead.

### Does adding `SELECT` on sessions broaden the owner too far?

It broadens only the NOLOGIN function owner, which remains unreachable by the runtime role. The
runtime role receives no execute grant in this unit. Catalog tests require the exact four-table
set, and the callable projection omits the token and metadata.

## 7. Steelman

### Blast radius if the current posture remains

The public web can use `DATABASE_URL_ADMIN` during every session-bearing request. A server-side
compromise can therefore move from one session cookie to broad identity and database authority.

### Why this unit is worth preparing independently

- It addresses a high-frequency pre-tenant path without changing live behavior.
- It reuses the accepted NOLOGIN owner and owner-policy pattern.
- It adds only one table privilege and one exact function.
- It proves idle and absolute expiry, active membership, and organization binding inside the
  database boundary.
- It reduces the later route-conversion diff to execution grant, orchestration, and parity logic.
- It preserves immediate rollback because no application path calls the new surface.

### Contract alignment

The unit advances the governing design's typed bootstrap API, minimal projections, static SQL,
exact grants, neutral denials, and real-role integration tests. It makes no claim that the public
web admin credential has been removed.

## 8. Pre-Mortem

Assume this foundation caused an incident.

### Failure: migration changes the accepted Unit 1 owner posture

Likely cause:

- unexpected role membership or ownership drift;
- a broader grant than the exact sessions `SELECT` addition;
- an attempt to edit the applied Unit 1 migration.

Detection:

- fail-closed role and membership preflight;
- exact table-privilege catalog assertion;
- review proves a new additive migration is used.

Rollback:

- stop before merge or deploy;
- if applied later, leave the inert function ungranted while a corrective migration is reviewed;
- never edit the applied migration or perform ad hoc production DDL.

### Failure: function accepts an expired or revoked session

Likely cause:

- missing idle or absolute expiry predicate;
- membership joined only by user, not by exact organization;
- inactive organization or user predicate omitted.

Detection:

- real PostgreSQL negative fixtures for every state;
- exact projection and function-source review;
- later CloudVault parity matrix before route conversion.

Rollback:

- keep runtime execution revoked;
- correct through a new migration;
- do not wire routes or grant direct table access as a shortcut.

### Failure: function leaks raw session or credential material

Likely cause:

- table row return type;
- `SELECT *`;
- repository accepts undocumented columns.

Detection:

- named return-column catalog assertion;
- exact result-key test;
- protected-column source checks;
- source checksum.

Rollback:

- keep the function inert and correct it through a new migration;
- do not grant runtime execution.

### Failure: route behavior changes despite the inert boundary

Likely cause:

- an accidental import into `validateSession`, server components, middleware, or logout;
- a runtime execute grant included in the migration.

Detection:

- import-graph and diff review;
- unit test proving the current route modules are untouched;
- function ACL check.

Rollback:

- reject the PR or restore the branch before merge;
- if discovered after an additive deploy, keep the old route path and revoke only through a
  reviewed migration.

### Failure: green mocks hide a PostgreSQL privilege defect

Detection:

- disposable PostgreSQL 15 is mandatory;
- tests run through the actual runtime role with a temporary exact grant;
- catalog checks cover roles, memberships, privileges, function metadata, ACLs, and source.

Rollback:

- no route depends on the function;
- keep runtime execution withheld and fix forward through a reviewed migration.

## 9. Rollback and deployment posture

Before merge, rollback is closing the draft or abandoning this branch.

If the additive migration is later applied:

- keep runtime and `PUBLIC` execution revoked;
- keep all current session and authentication paths unchanged;
- retain the prior web revision;
- do not reverse the migration during immediate application rollback;
- correct any catalog issue through a new migration only.

This analysis authorizes preparation and draft review of the inert unit. It does not authorize a
production deploy, runtime grant, route conversion, or admin URL removal. Merge and deployment
remain separate review gates.

## 10. Go or no-go

**GO** for implementation of one additive, inert session-resolve foundation under this boundary.

**NO-GO** for runtime execution, route wiring, session mutation, deployment, or
`DATABASE_URL_ADMIN` removal.

The security freeze and silent-hardening posture remain active. P0-4 remains accepted and
unchanged. W1-3 production enforcement remains blocked until W1-2 is proven.

## 11. References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_2026-08-11_v1.md`
- `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_DEPLOYMENT_EVIDENCE_2026-08-11_v1.md`
- `prisma/schema.prisma`
- `prisma/rls-policies.sql`
- `prisma/migrations/20260811231000_w1_2_login_bootstrap_foundation/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/serverComponentSession.ts`
- `src/lib/middleware/auth.ts`
- `tests/integration/bootstrap-login-candidate.test.ts`
