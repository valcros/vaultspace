# W1-2 Organization Resolve Route Conversion Validation

- **Date:** 2026-08-12
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Organization slug, custom-domain, public-branding, and landing resolution
- **Status:** Implemented and locally validated, not merged, not deployed
- **Production baseline:** `9c465f81799440c8bdd40dd6b0df1e3a250a96d1` / `ca-vaultspace-web--0000292`
- **W1-2 overall:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Outcome

The organization-resolution family is prepared as the next W1-2 conversion unit. The ordinary
runtime role receives EXECUTE only on the already accepted
`public.bootstrap_organization_resolve_v1(text, text)` function, in addition to the previously
routed login and session-resolve functions. Organization slug, custom-domain, public-branding, and
landing-page resolution now use `BootstrapRepository` with no administrative database fallback.

No session mutation, login, two-factor, registration, password-reset, link, viewer, or room path was
changed. `DATABASE_URL_ADMIN` remains present. No W1-3 or P0-4 work was started.

## 2. Dependency decision

Organization resolution was selected before session mutation because it is one cohesive capability
with an accepted live function, a typed repository projection, and a bounded public surface. The
session-mutation family requires a new multi-action contract for creation, activity refresh,
single-token invalidation, organization and global revocation, transaction composition, and cache
effects. A partial mutation conversion would leave an ambiguous split path.

## 3. Implemented boundary

### 3.1 Catalog grant

The new migration:

- verifies the exact bootstrap-owner attributes and zero membership reachability;
- verifies the organization function signature, owner, language, SECURITY DEFINER posture,
  volatility, parallel restriction, fixed search path, source checksum, and contract marker;
- requires the pre-deploy organization-function ACL to be owner-only;
- grants `vaultspace_app` EXECUTE on the exact organization signature;
- verifies login, session resolve, and organization resolve are executable;
- rejects EXECUTE on any unexpected public `bootstrap_*` function or overload;
- rejects `PUBLIC` or any unexpected organization-function grantee; and
- restores zero owner memberships before commit.

The migration does not recreate the function or grant table, sequence, schema-create, role,
ownership, or BYPASSRLS privileges.

The guarded fresh-database setup applies and verifies the same exact three-function matrix after it
creates the local runtime role.

### 3.2 Application routes

The following production surfaces now use the runtime-backed repository:

- header-based organization resolution by slug or custom domain;
- custom-domain resolution;
- canonical subdomain resolution;
- the public branding endpoint; and
- the organization landing page.

The public branding endpoint reuses the accepted public projection and no longer performs a second
organization query. Its response remains limited to name, slug, logo URL, primary color, and favicon
URL. Operational failures are logged categorically without exception messages, database URLs, query
text, or stack traces.

All four converted production files are statically guarded against `bootstrapDb` use. The session
mutation implementation is also pinned unchanged by a source-boundary regression test.

## 4. Local validation

### 4.1 Static and application validation

| Gate                               | Result                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| Focused organization unit tests    | PASS, 4 files and 17 tests                                         |
| Complete unit test suite           | PASS, 145 files and 1,361 tests; 1 file and 7 tests skipped        |
| ESLint                             | PASS, zero errors; one pre-existing hook warning outside this unit |
| TypeScript no-emit check           | PASS                                                               |
| Prettier check                     | PASS                                                               |
| Optimized Next.js production build | PASS                                                               |
| Git whitespace check               | PASS                                                               |

The focused tests cover canonical slug preference, custom-domain fallback, subdomain resolution,
localhost and IP rejection before database access, neutral missing behavior, public-branding
projection, removal of the second branding query, categorical error logging, and source boundaries.

### 4.2 Disposable PostgreSQL validation

A new versioned disposable PostgreSQL container applied all 46 migrations from an empty database.
The constrained RLS setup then created the ordinary runtime role and verified the exact grant
matrix.

The production-like branch was exercised separately by revoking the organization grant after role
creation and applying only the new migration. It restored the expected grant successfully.

A hostile synthetic `bootstrap_*` function was then granted to the runtime role. The new migration
rejected that catalog state as required. The synthetic function was removed from the disposable
database, the exact migration was reapplied, and the expected three-function posture was restored.

The complete RLS integration suite then passed:

- 7 files passed;
- 69 tests passed;
- login, session resolve, and organization resolve catalog and runtime contracts passed;
- W1-1 room authorization and link admission passed; and
- password-reset provider and RLS postures passed.

The disposable containers are stopped and retained for review:

- `vaultspace-w1-2-org-route-v1`
- `vaultspace-w1-2-org-route-v2`

No container was deleted.

## 5. Production continuity during preparation

Unit 5 evidence PR `#136` was merged as
`9c465f81799440c8bdd40dd6b0df1e3a250a96d1`. Exact-main CI run `31624803267` succeeded. The normal
workflow-run deployment `31625524697` also succeeded without a manual dispatch.

An uncached quick health check returned:

- status `healthy`;
- mode `azure`;
- release `9c465f81799440c8bdd40dd6b0df1e3a250a96d1`;
- revision `ca-vaultspace-web--0000292`;
- `Cache-Control: no-store, max-age=0`; and
- no degraded components.

This docs-and-acceptance successor does not reopen Unit 5. No `deep=true` health check was used.

The two Advisor-authorized Unit 5 scratch files were deleted. No other file was removed.

## 6. Merge and deployment gate

This implementation is not authorized for merge or deployment by this validation record. A later
Advisor GO must control:

1. human review and exact-head PR CI;
2. temporary disablement of deploy workflow `251547585` with no active real deploy;
3. exact-head merge and exact-main image publication;
4. workflow re-enablement with no side-effect deploy;
5. exactly one dispatch for the accepted post-merge SHA;
6. catalog validation of the exact three-function runtime EXECUTE matrix;
7. a CloudVault organization-family matrix for slug, subdomain, custom domain, branding, inactive,
   missing, and malformed cases;
8. minimal read-only Brightside shell, known-room, logout, and protected re-entry validation only
   after CloudVault is green; and
9. versioned production evidence and written close-out.

`DATABASE_URL_ADMIN` must remain present throughout this unit. No session-mutation conversion,
admin-URL removal, W1-3 enforcement, or second deployment is implied.

## 7. Status stamp

**W1-2 ORGANIZATION RESOLVE ROUTE CONVERSION: IMPLEMENTED AND LOCALLY VALIDATED, NOT MERGED, NOT
DEPLOYED.**

W1-2 Units 1 through 5 remain acceptance-closed. Production EXECUTE remains login candidate plus
session resolve only. Organization EXECUTE remains withheld in production. Session mutations remain
unchanged. `DATABASE_URL_ADMIN` remains present. W1-2 overall remains OPEN. W1-3 remains not
started.

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_ORGANIZATION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v1.md`
- `docs/W1_2_ORGANIZATION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `prisma/migrations/20260812050000_w1_2_organization_bootstrap_foundation/migration.sql`
- `prisma/migrations/20260812190000_w1_2_organization_route_conversion/migration.sql`
- `scripts/setup-rls-test-db.ts`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/middleware/auth.ts`
- `src/lib/middleware/customDomain.ts`
- `src/app/api/public/branding/route.ts`
- `src/app/org/[slug]/page.tsx`
- `tests/integration/bootstrap-organization-resolve.test.ts`
