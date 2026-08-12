# W1-2 Login Route Conversion

- **Date:** 2026-08-12
- **Evidence version:** 1
- **Control family:** Database privilege split
- **Implementation unit:** First routed bootstrap conversion, login candidate only
- **Status:** Analysis complete, implementation prepared in draft
- **Governing design:** W1-2 Database Privilege Split Design
- **Dependency:** W1-2 Units 1 through 3 acceptance-closed
- **Security freeze:** Active
- **P0-4:** Accepted and unchanged

## 1. Decision summary

Convert only `POST /api/auth/login` candidate lookup from the admin-backed `bootstrapDb.user`
surface to `BootstrapRepository.findLoginCandidate`. Grant `vaultspace_app` EXECUTE only on the
already deployed and accepted function `public.bootstrap_login_candidate_v1(text)`.

This is the first routed W1-2 conversion. It does not convert 2FA completion, session resolution,
session mutation, organization resolution, registration, password reset, public links, or access
requests. It does not remove `DATABASE_URL_ADMIN`.

The route retains:

- email and password input validation;
- login rate limits before account lookup or bcrypt work;
- application-side password verification;
- the existing signed 2FA temporary-token branch;
- organization-scoped session creation and last-login update;
- session-cookie behavior;
- bounded login audit capture; and
- the existing successful response projection.

The route gains a strict no-fallback rule. A null function result is a neutral HTTP 401 denial. A
database or mapping error returns the existing generic HTTP 500 response and cannot cause an admin
client lookup.

## 2. Why login is the first routed family

The three accepted foundations are live and inert:

- `bootstrap_login_candidate_v1`;
- `bootstrap_session_resolve_v1`; and
- `bootstrap_organization_resolve_v1`.

Login is the smallest independently reviewable route conversion:

- one route owns the candidate lookup;
- one function already returns the exact password-login projection;
- password verification and all post-candidate writes remain unchanged;
- the runtime grant is one exact function signature;
- CloudVault can prove successful and denied outcomes without room or document access; and
- rollback is an application revision rollback while the additive grant remains narrowly scoped.

Session resolution is not selected because the current path also performs cache verification,
activity refresh, expiry deactivation, logout invalidation, and user-wide invalidation. The
accepted session-resolve function is read-only and does not yet replace that mutation surface.

Organization resolution is not selected because the family spans custom-domain middleware,
subdomain middleware, public branding, request headers, and the organization landing page. That is
a broader first routed cut than one login candidate lookup.

## 3. Exact implementation boundary

### 3.1 Additive grant migration

The migration:

- verifies the exact NOLOGIN owner posture;
- rejects owner membership drift;
- verifies the one expected login function, owner, signature, SECURITY DEFINER setting,
  SQL language, volatility, parallel mode, `search_path`, source checksum, and contract marker;
- requires owner-only execution before the new grant;
- verifies the existing runtime role is LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB,
  NOCREATEROLE, and NOREPLICATION when that role already exists;
- rejects runtime reachability to the owner;
- grants EXECUTE only on `public.bootstrap_login_candidate_v1(text)`;
- verifies the session and organization functions remain unexecutable by the runtime role; and
- rejects every unexpected EXECUTE grantee, including `PUBLIC`.

Fresh disposable databases create `vaultspace_app` after Prisma migrations through the guarded RLS
test setup. When the role is absent during migration, that setup applies and verifies the same exact
login-function grant. This preserves fresh-database portability without creating or storing a
runtime credential in a Prisma migration.

The migration does not change function source, function ownership, RLS policies, FORCE state,
owner table privileges, schemas, tables, sequences, rows, Azure resources, or Key Vault.

### 3.2 Login route

The route:

- calls `bootstrapRepository.findLoginCandidate(email)` only after both rate-limit checks pass;
- never imports or calls `bootstrapDb`;
- treats no row as `Invalid email or password` with HTTP 401;
- passes only the submitted password and returned password hash to bcrypt;
- uses the returned user ID for the signed 2FA temporary token;
- uses the returned organization ID for the existing `withOrgContext` transaction;
- uses the returned role for the existing audit actor type; and
- returns the established user and organization response fields.

The function requires active user, active membership, and active organization state. Because it
returns a neutral no-row result when any predicate fails, the routed path no longer distinguishes a
known user without an active organization through a separate HTTP 403 response. This is an
intentional reduction in account-state disclosure and matches the accepted function contract.

### 3.3 Explicit exclusions

This unit does not:

- change password hashing or bcrypt cost;
- change rate-limit keys, thresholds, or providers;
- return or log password hashes, TOTP secrets, backup codes, tokens, or candidate rows;
- convert `POST /api/auth/2fa/validate`;
- convert session resolve, refresh, invalidation, logout, or server-component session helpers;
- convert organization middleware, public branding, or landing pages;
- remove or stop creating `bootstrapDb` elsewhere;
- remove the public-web admin URL;
- change entrypoint DDL or create the one-shot migrator;
- change W1-3, P0-4, malware scanning, networking, firewall, HA, or geo posture; or
- access Brightside or customer data.

## 4. Security invariants

All of the following must hold:

1. `vaultspace_bootstrap_owner` remains NOLOGIN and NOBYPASSRLS.
2. `vaultspace_app` cannot assume the owner directly or transitively.
3. `PUBLIC` cannot execute the login function.
4. `vaultspace_app` can execute only the login function among the three accepted foundations.
5. The grant names the exact text signature and cannot apply to a future overload.
6. The login function source checksum remains the accepted value.
7. The route contains no `bootstrapDb` import, call, or error fallback.
8. Rate limiting completes before candidate lookup and bcrypt.
9. Unknown, inactive, membership-revoked, and organization-inactive candidates return the same
   neutral denial.
10. Invalid passwords return the same neutral denial.
11. Repository or database failure creates no session and returns no internal detail.
12. Successful password login preserves org-bound session and audit behavior.
13. A 2FA-enabled candidate receives the established signed temporary-token response without a
    password-login session.
14. The session and organization functions remain owner-only.
15. `DATABASE_URL_ADMIN` remains present until the complete replacement-path matrix is green.

## 5. Verification plan

### 5.1 Static and unit checks

- Prove the route imports `bootstrapRepository` and does not reference `bootstrapDb`.
- Prove rate limiting occurs before candidate lookup.
- Prove a null candidate skips bcrypt and session creation.
- Prove an invalid password skips session creation.
- Prove repository failure fails closed without a fallback.
- Prove 2FA temporary-token behavior remains unchanged.
- Prove password-login session, response, and audit fields remain unchanged.
- Run repository projection and parameterization tests.
- Run type-check, lint, formatting, and the full unit suite.

### 5.2 Disposable PostgreSQL integration

Run all migrations and guarded RLS setup against PostgreSQL 15, then prove:

- exact owner and runtime role posture;
- exact owner table privileges;
- exact function signature, owner, source checksum, `search_path`, and contract marker;
- EXECUTE ACL contains only owner and runtime;
- runtime can resolve an active candidate through the ordinary `DATABASE_URL` client;
- runtime cannot execute the session or organization functions;
- `PUBLIC` cannot execute the login function;
- inactive user, membership, and organization states return neutral denial;
- deterministic first active membership remains stable;
- hostile SQL-shaped email input and hostile caller search path do not alter behavior; and
- the runtime still cannot `SET ROLE` to the owner.

Run a second Azure-like migration path with `vaultspace_app` present before the conversion migration
to prove that the migration itself owns the production grant.

### 5.3 Controlled deployment gate, not authorized by this draft

If a later Advisor GO authorizes deployment:

1. Disable workflow `251547585` before merge.
2. Merge only after exact-head review and fully green PR CI.
3. Require exact-main CI and immutable image publication.
4. Re-enable with no side-effect deployment.
5. Dispatch exactly once for the approved main SHA.
6. Verify migration and exact live ACL before testing login.
7. Run the bounded CloudVault login-family matrix first.
8. Roll back to the retained Unit 3 revision on any deploy or CloudVault failure.
9. Do not touch Brightside for this family unless separately directed.

The CloudVault login-family matrix should include:

- successful password login, `/api/auth/me`, logout, and post-logout 401;
- invalid password;
- unknown user;
- inactive user;
- inactive membership;
- inactive organization;
- deterministic membership selection;
- 2FA-required response with no password-login session; and
- catalog proof that only the login function is runtime-executable.

## 6. Strawman

The current admin-backed lookup works, is rate-limited, and has years of route-level behavior around
it. Routing through a SQL function adds a migration and a dependency on function ACLs before the
admin URL can be removed. A function outage can now block all logins even while the admin URL is
still present.

The narrowest operational answer could be to keep the current route until all bootstrap functions
exist, then switch everything in one release. That would avoid a mixed old/new authentication
period.

This alternative concentrates too much behavior in one cutover. A login-only conversion proves
the runtime role, exact grant, repository, migration, deployment, and CloudVault evidence pattern
before session, domain, reset, and public-link families depend on it.

## 7. Steelman

The public web can currently instantiate a broadly privileged database client during every login
attempt. Converting the candidate lookup removes that route's need to use the admin connection
without changing password verification or session writes.

This unit is small but meaningful:

- the public request calls only one reviewed function;
- the function returns the minimum data needed for password verification;
- runtime execution is limited by exact signature;
- denied states are neutral;
- there is no silent admin fallback;
- the established login transaction and audit path remain intact; and
- the admin URL remains available for unconverted families and application rollback.

## 8. Pre-Mortem

### Failure: runtime lacks EXECUTE after deployment

Detection:

- migration or live catalog verification fails;
- every candidate lookup returns a generic login failure;
- CloudVault successful login fails before session creation.

Response:

- do not grant broadly or use `PUBLIC` as a repair;
- roll back the web revision;
- correct the exact-signature grant through a reviewed migration.

### Failure: an overload or ACL drift broadens access

Detection:

- catalog function-count, signature, and ACL assertions fail;
- session or organization function privilege checks become true.

Response:

- stop before merge or deployment;
- do not weaken the checks;
- repair catalog drift through a versioned migration.

### Failure: route silently falls back to the admin client

Detection:

- static source assertion finds `bootstrapDb`;
- repository-error unit test unexpectedly succeeds or performs another lookup.

Response:

- block review;
- retain generic failure until the narrow path is healthy;
- never use fallback as an availability repair.

### Failure: CloudVault login behavior changes

Likely causes include membership-selection drift, lost session fields, 2FA response changes, or an
unexpected RLS denial.

Response:

- roll back to the retained Unit 3 web revision within the impact budget;
- keep the additive grant in place because the prior revision does not call it;
- preserve evidence and prepare a reviewed correction;
- do not remove the admin URL or continue to another routed family.

## 9. Rollback

Before merge, close the draft PR or abandon the branch.

After migration but before web cutover, stop and retain the current live revision. Do not revoke or
change privileges ad hoc.

After web cutover, reactivate the retained Unit 3 revision and restore 100 percent traffic if login
acceptance fails. The prior revision still uses `bootstrapDb`, so the additive runtime grant does
not change its behavior. Correct the grant or route through a later reviewed migration and code PR.

## 10. Gate statement

This draft is a GO for review of one login-family route conversion.

It is a NO-GO for merge, production deployment, additional runtime grants, session or organization
route conversion, entrypoint changes, `DATABASE_URL_ADMIN` removal, W1-3 enforcement, P0-4 changes,
or Brightside testing without the next written gate.

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_2026-08-11_v1.md`
- `docs/W1_2_LOGIN_BOOTSTRAP_FOUNDATION_DEPLOYMENT_EVIDENCE_2026-08-11_v1.md`
- `prisma/migrations/20260811231000_w1_2_login_bootstrap_foundation/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `src/app/api/auth/login/route.ts`
- `scripts/setup-rls-test-db.ts`
- `tests/integration/bootstrap-login-candidate.test.ts`
