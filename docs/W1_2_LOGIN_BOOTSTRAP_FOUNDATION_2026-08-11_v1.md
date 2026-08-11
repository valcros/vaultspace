# W1-2 Login Bootstrap Foundation

- **Date:** 2026-08-11
- **Evidence version:** 1
- **Control family:** Database privilege split
- **Implementation unit:** Additive login-candidate foundation
- **Status:** Analysis complete, implementation authorized
- **Governing design:** W1-2 Database Privilege Split Design
- **Dependency:** W1-1 closed by written Advisor decision on 2026-08-11
- **Security freeze:** Active
- **P0-4:** Accepted and unchanged

## 1. Decision summary

Implement the first W1-2 unit as an additive, unused-in-production login bootstrap foundation:

1. Create a dedicated vaultspace_bootstrap_owner role with NOLOGIN, NOINHERIT, NOSUPERUSER,
   NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, and NOREPLICATION.
2. Give that owner SELECT only on public.users, public.user_organizations, and
   public.organizations.
3. Add role-specific SELECT policies for that owner on those three FORCE RLS tables.
4. Add one exact SECURITY DEFINER function for deterministic active login-candidate resolution.
5. Return only the password-login projection approved by the governing design.
6. Revoke function execution from PUBLIC and do not grant execution to vaultspace_app in this
   foundation unit.
7. Add a typed BootstrapRepository method backed by the ordinary runtime db client.
8. Add real PostgreSQL catalog, privilege, projection, hostile-input, and neutral-denial tests.
9. Do not convert the login route in this unit.

The function and repository are established before route conversion so their database behavior can
be reviewed independently. The current bootstrapDb path and DATABASE_URL_ADMIN remain available.

## 2. Platform constraint and compatible owner model

The Munger production database is Azure Database for PostgreSQL Flexible Server version 15.
Microsoft documents that PostgreSQL 15 and earlier Azure Flexible Server administrators cannot
create nonadmin roles with BYPASSRLS.

The governing design requires a NOLOGIN owner and allows controlled FORCE RLS access to belong only
to that owner. This unit implements that intent without BYPASSRLS:

- the owner remains NOBYPASSRLS;
- FORCE RLS remains enabled;
- three policies name only vaultspace_bootstrap_owner;
- the runtime role is not a member of that owner;
- recursive role reachability from vaultspace_app to the owner must be empty;
- the callable function is SECURITY DEFINER, static SQL, and owned by the NOLOGIN role;
- the function is not executable by PUBLIC or vaultspace_app in this foundation unit.

This is narrower than granting BYPASSRLS. W1-3 can remove the current broad empty-context identity
policies while retaining these owner-only policies and the reviewed function surface.

## 3. Exact implementation boundary

### 3.1 Additive database migration

The migration will:

- create the owner if absent and normalize every role attribute;
- revoke any runtime membership in the owner;
- grant schema USAGE and exact table SELECT privileges;
- create one policy per required table for the owner only;
- create one function with one text argument and a named table return type;
- set search_path to pg_catalog;
- use fully qualified public objects;
- use static SQL only;
- transfer ownership to vaultspace_bootstrap_owner;
- revoke all execution from PUBLIC;
- leave vaultspace_app without execution permission;
- add a contract comment containing the versioned control identifier.

The migration will not:

- change or remove the broad bootstrap policies scheduled for W1-3;
- grant BYPASSRLS;
- change FORCE RLS;
- alter user, organization, or membership rows;
- create a login credential;
- add a Key Vault secret;
- change the web, worker, or job environment;
- modify Azure resources.

### 3.2 Login-candidate projection

The function accepts one email value and returns at most one row with:

- user ID;
- normalized stored email;
- first and last name;
- password hash;
- user active state;
- two-factor enabled state;
- organization ID;
- organization name;
- organization slug;
- organization role.

It does not return:

- TOTP secret;
- backup-code hashes;
- email verification timestamp;
- profile title or relationship;
- other organizations;
- permission or group data;
- session tokens;
- reset tokens;
- unrelated user fields.

The function requires:

- nonempty normalized email;
- active user;
- active organization membership;
- active organization;
- deterministic membership choice by membership creation time and ID.

Unknown, inactive, or malformed identities return no row. The function does not reveal which
predicate failed.

### 3.3 Typed repository

The repository will:

- call the exact function signature with a parameterized Prisma query;
- normalize the email once;
- map the database projection into a narrow TypeScript type;
- return null for no candidate;
- reject unexpected duplicate rows or invalid role values;
- never fall back to bootstrapDb;
- never log the email, password hash, or returned row;
- remain unused by the login route until the next reviewed implementation unit.

## 4. Security invariants

All of these must be true before the unit is reviewable:

1. vaultspace_bootstrap_owner cannot log in.
2. The owner is not superuser and does not bypass RLS.
3. The owner cannot create roles, databases, or replication connections.
4. vaultspace_app cannot SET ROLE directly or transitively to the owner.
5. The owner has no table privilege outside the exact three-table SELECT set introduced here.
6. The function has exactly one signature and no overload.
7. The function owner is exact.
8. SECURITY DEFINER is enabled.
9. search_path is exactly pg_catalog.
10. The source contains no dynamic SQL.
11. PUBLIC cannot execute the function.
12. vaultspace_app cannot execute the function before the route-conversion unit grants it.
13. The owner-only policies apply only to SELECT.
14. The function returns only the documented projection.
15. Hostile search_path and SQL-shaped email input do not change resolution.
16. Inactive user, membership, and organization states return neutral no-row results.
17. A user with two active memberships receives the deterministic first membership.

## 5. Verification plan

### 5.1 Static and unit checks

- Type-check the repository projection.
- Prove the exact function call is parameterized.
- Prove null, one-row, duplicate-row, and invalid-role mapping behavior.
- Prove no import or call from the login route is introduced.
- Prove the foundation does not grant runtime execution.
- Prove no DATABASE_URL_ADMIN, entrypoint, workflow, Azure, or Key Vault file changes are in the
  diff.

### 5.2 Disposable PostgreSQL integration

Run the real migration and RLS setup against local disposable PostgreSQL, then prove:

- exact owner attributes;
- exact table privileges;
- exact role-specific policies;
- no role-membership reachability;
- exact function signature, owner, language, SECURITY DEFINER state, volatility, search_path, and
  return columns;
- PUBLIC and runtime execution denial by default;
- temporary exact runtime grant enables only the reviewed call;
- active candidate projection;
- inactive user, membership, and organization neutral denial;
- wrong and SQL-shaped email neutral denial;
- deterministic membership selection;
- absence of TOTP secret and backup-code columns;
- hostile caller search_path has no effect;
- direct SET ROLE to the owner is denied;
- the temporary test grant is revoked in cleanup.

### 5.3 Not part of this unit

- Login route conversion.
- 2FA bootstrap conversion.
- Session bootstrap conversion.
- Registration, password reset, organization resolution, public links, or access requests.
- One-shot Azure migrator job.
- Web entrypoint migration removal.
- Web DATABASE_URL_ADMIN removal.
- Key Vault access changes.
- Production deployment or CloudVault auth-matrix execution.

## 6. Strawman

### What if this is over-designed for one login query?

The existing login route already selects a deliberate projection through Prisma and is
rate-limited. A database function, owner role, policies, catalog contract, and integration suite
add substantial maintenance for one lookup. A simpler repository that uses bootstrapDb would
improve code organization with less work.

That simpler repository would not change the privilege boundary. Compromise of the public process
would still expose the full admin connection. W1-2 specifically requires the future route to work
through the constrained runtime credential.

### Why not convert login in the same unit?

Combining function creation, runtime grant, repository mapping, and route behavior would make a
login failure harder to isolate. The additive foundation provides no live behavior change and lets
reviewers prove the database surface before it becomes callable by production web traffic.

### Why not use BYPASSRLS on the owner?

Production is PostgreSQL 15 on Azure Flexible Server, where nonadmin BYPASSRLS roles cannot be
created. Role-specific RLS policies produce a smaller and platform-compatible privilege than
BYPASSRLS.

### Is an owner-only policy just another broad policy?

It allows the NOLOGIN owner to see qualifying rows on three tables. Unlike the current
empty-context policies, it does not apply to the runtime role. The owner cannot be assumed by the
runtime role, and access is exposed only through exact SECURITY DEFINER functions. The policy is
broad enough to resolve an identity before tenant context but narrow in role, command, table, and
callable projection.

### Could this wait for the migrator job?

The migration remains additive and can run through the existing reviewed migration path. Building
the function boundary first provides the bootstrap surface that Phase 2 must prove before startup
DDL or the admin URL can be removed. The one-shot migrator job remains a separate control-family
unit.

## 7. Steelman

### Blast radius if the current posture remains

The public web process can instantiate bootstrapDb with DATABASE_URL_ADMIN. A server-side code
execution or injection defect can therefore bypass RLS and use broad database authority.

### Why this unit is worth shipping before route conversion

- It introduces no user-visible behavior.
- It gives security review a small database-only surface.
- It proves Azure PostgreSQL 15 compatibility before a live auth path depends on it.
- It establishes the owner, policy, projection, and typed-call pattern reusable by later bootstrap
  families.
- It creates negative tests for privilege reachability and catalog drift.
- It preserves immediate rollback because no route changes.

### Contract alignment

The unit advances least privilege, typed bootstrap access, static SQL, minimal projections, exact
grants, FORCE RLS compatibility, and real-role testing. It does not claim the web admin credential
is removed.

## 8. Pre-Mortem

Assume this foundation caused an incident.

### Failure: migration cannot create or normalize the owner role

Likely cause:

- Azure administrator role restrictions;
- an unexpected existing role owner or membership;
- role alteration blocked by platform policy.

Detection:

- migration fails before application or workload mutation;
- exact catalog preflight reports the failing attribute;
- no web cutover occurs.

Rollback:

- stop the deploy;
- leave the prior web revision live;
- do not retry repeatedly;
- adjust the additive migration in a new migration after review.

### Failure: the function leaks more identity material than intended

Likely cause:

- a table row return type;
- an accidental SELECT star;
- a later overload;
- repository mapping of an undocumented column.

Detection:

- return-column catalog assertion;
- exact projection integration test;
- protected-name overload check;
- source-contract review.

Rollback:

- no production route calls this unit;
- keep execution revoked;
- correct it through a new migration;
- do not edit an applied migration.

### Failure: vaultspace_app can assume the owner

Likely cause:

- direct or inherited role membership;
- creator defaults;
- a future role grant.

Detection:

- recursive membership-closure test;
- SET ROLE negative test;
- catalog verification before any runtime EXECUTE grant.

Rollback:

- stop the deploy or route-conversion unit;
- revoke the exact membership through the migration path;
- preserve evidence for review.

### Failure: role-specific policy does not work under FORCE RLS

Likely cause:

- policy targets the wrong role;
- function owner drift;
- caller context or search_path changes resolution;
- missing table grant.

Detection:

- real NOBYPASSRLS owner test on FORCE RLS tables;
- active and inactive candidate fixtures;
- hostile search_path test.

Rollback:

- no production route depends on the function;
- correct policy or ownership through a new additive migration.

### Failure: green mocks hide a real PostgreSQL privilege defect

Detection:

- disposable PostgreSQL is mandatory;
- test as the actual runtime role;
- inspect pg_roles, pg_auth_members, pg_policy, pg_proc, information_schema privileges, and
  has_function_privilege;
- do not accept unit tests alone.

### Failure: silent hardening changes Brightside login

This foundation does not route login traffic through the new function. Any Brightside behavior
change would therefore indicate unrelated deployment drift and must stop the sequence. No
Brightside test or customer-data access is needed for this unit.

## 9. Rollback

Before merge:

- close the PR or remove the unmerged branch changes.

After migration in a nonproduction environment:

- do not edit the applied migration;
- keep function execution revoked;
- add a reviewed migration if the owner, policy, or function must be corrected.

After an accidental production apply:

- the current web route remains on bootstrapDb and does not call the function;
- keep PUBLIC and runtime execution revoked;
- leave the prior application revision available;
- use the migrator path for any catalog correction;
- do not drop roles, functions, or policies ad hoc.

## 10. Go or no-go

**GO for implementation of this additive foundation.**

The Steelman justifies the work, PostgreSQL 15 has a compatible least-privilege design, the unit
does not change live authentication, and rollback is immediate because no production route or
runtime grant depends on the function.

**NO-GO for login route conversion, runtime EXECUTE grant, web startup DDL removal, or
DATABASE_URL_ADMIN removal in this unit.**

## 11. References

- docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md
- prisma/schema.prisma
- prisma/rls-policies.sql
- scripts/setup-rls-test-db.ts
- src/lib/db.ts
- src/app/api/auth/login/route.ts
- tests/integration/rls.test.ts
- Microsoft Azure PostgreSQL access management:
  https://learn.microsoft.com/en-us/azure/postgresql/security/security-access-control
