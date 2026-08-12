# W1-2 Organization Resolve Route Conversion

- **Date:** 2026-08-12
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Organization slug, custom-domain, and public-branding resolution
- **Status:** Analysis complete, implementation not started
- **Prior unit:** W1-2 Unit 5 session-resolve read conversion, acceptance-closed
- **W1-2 overall:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Decision

Use the already deployed and accepted
`public.bootstrap_organization_resolve_v1(text, text)` function for the next routed conversion.
Grant `vaultspace_app` EXECUTE on that exact signature, then convert the complete public-web
organization-resolution family from direct `bootstrapDb.organization` calls to
`BootstrapRepository`.

This unit is preferred over a partial session-mutation conversion because the organization
function, typed repository projection, validation, and production catalog posture already exist.
The remaining session-mutation family still requires a new multi-action database contract spanning
refresh, single-token invalidation, organization-scoped revocation, global revocation, transaction
composition, and cache-token return. It must not be approximated by replacing only the two current
administrative calls.

## 2. Exact current dependency inventory

The public web currently has six direct administrative organization reads across four production
surfaces:

| Surface                          |                    Current direct reads | Required replacement                              |
| -------------------------------- | --------------------------------------: | ------------------------------------------------- |
| `resolveOrganizationFromHeaders` |                 slug plus custom domain | Repository slug or custom-domain lookup           |
| `resolveCustomDomain`            |                           custom domain | Repository custom-domain lookup                   |
| `resolveSubdomain`               |                                    slug | Repository slug lookup                            |
| Public branding API              | organization ID after header resolution | Reuse the repository's public branding projection |
| Organization landing page        |                                    slug | Repository slug lookup                            |

The public branding route currently resolves the organization once from request headers and then
performs a second administrative lookup by organization ID. The existing repository already returns
the exact public branding projection, so the second query is unnecessary and must be removed rather
than replaced with a new function capability.

The organization function is already live, owner-only, and unrouted. Its projection contains only:

- organization ID;
- name;
- canonical slug;
- custom domain;
- logo URL;
- primary color; and
- favicon URL.

It does not return email-sender configuration, retention settings, storage limits, membership data,
room data, link data, or other customer information.

## 3. Exact implementation boundary

### 3.1 Grant migration

Add one migration that:

1. Verifies the exact `vaultspace_bootstrap_owner` posture.
2. Verifies the owner has no direct or transitive runtime reachability and no residual membership.
3. Resolves exactly one `public.bootstrap_organization_resolve_v1(text, text)` function.
4. Verifies its owner, SQL language, SECURITY DEFINER posture, stable volatility, restricted
   parallel mode, `search_path=pg_catalog`, source checksum, and contract marker.
5. Verifies its pre-existing EXECUTE ACL is owner-only.
6. Temporarily grants migrator membership only if required to issue the runtime grant.
7. Grants `vaultspace_app` EXECUTE on the exact organization function signature.
8. Restores zero owner memberships.
9. Verifies the complete runtime matrix is exactly login candidate, session resolve, and
   organization resolve.
10. Verifies `PUBLIC` and every unexpected role remain denied.

The migration does not create, replace, or alter the already applied organization function. It does
not grant new table, sequence, schema-create, or role privileges.

### 3.2 Application conversion

Convert the following files as one route family:

- `src/lib/middleware/auth.ts`
- `src/lib/middleware/customDomain.ts`
- `src/app/api/public/branding/route.ts`
- `src/app/org/[slug]/page.tsx`

The conversion must:

- use the ordinary runtime-backed `bootstrapRepository` singleton;
- use `resolveOrganizationBySlug` for canonical subdomain and landing-page slugs;
- use `resolveOrganizationByCustomDomain` for custom hostnames;
- preserve hostname, port, main-domain, localhost, and IP filtering before database calls;
- preserve active-organization filtering inside the reviewed function;
- reuse the resolved public branding projection without a second database lookup;
- preserve neutral not-found behavior for absent or inactive organizations;
- keep unexpected operational failures categorical and free of database exception details; and
- contain no `bootstrapDb` import, call, or fallback in the converted files.

### 3.3 Type boundary

Expose the public organization projection through the middleware result only where the branding
route needs it. Existing callers that require only organization ID and slug must remain compatible.
No private organization field may be added to the projection to avoid an extra query.

## 4. Explicit exclusions

This unit does not:

- change session refresh, logout, invalidation, creation, or cache behavior;
- change login, two-factor completion, registration, password reset, administrator reset, viewer
  sessions, links, or public access requests;
- remove `DATABASE_URL_ADMIN` from the public web workload;
- change the web entrypoint or migration execution model;
- create or replace the organization function;
- grant the bootstrap owner new table privileges;
- apply W1-3 FORCE RLS or remove bootstrap policies;
- change P0-4 or malware scanning;
- change networking, custom-domain DNS, certificates, firewall, private networking, HA, or geo
  posture;
- query Brightside or other customer data during implementation; or
- use production `deep=true` health.

## 5. Parity and failure contracts

| Case                            | Required result                                    |
| ------------------------------- | -------------------------------------------------- |
| Active canonical slug           | Exact organization ID and canonical slug           |
| Active custom domain            | Exact organization ID and canonical slug           |
| Active public branding          | Exact approved public branding projection          |
| Inactive organization           | Neutral not found                                  |
| Unknown slug or custom domain   | Neutral not found                                  |
| Malformed slug or custom domain | Reject before database query                       |
| Duplicate projection            | Fail closed with a categorical repository error    |
| Malformed projection            | Fail closed with a categorical repository error    |
| Database or function failure    | No administrative fallback and no raw error detail |
| Main host, localhost, or IP     | Preserve existing non-tenant resolution behavior   |

## 6. Verification plan

### 6.1 Static and unit verification

- Prove the four converted files contain no `bootstrapDb` reference.
- Prove the repository is called with normalized, parameterized slug and custom-domain inputs.
- Prove malformed inputs do not reach PostgreSQL.
- Prove the public branding response is built from the reviewed projection without a second query.
- Prove active slug, subdomain, custom domain, inactive, missing, and operational-error behavior.
- Prove categorical logging does not include exception messages, stack traces, database codes, or
  query text.
- Prove session mutation, login, and other auth families do not change.

### 6.2 Disposable PostgreSQL verification

- Apply the complete migration chain in a fresh database.
- Apply the grant migration through the constrained Azure-like migrator path.
- Verify the exact owner posture and zero membership reachability.
- Verify EXECUTE is limited to the three accepted bootstrap signatures.
- Verify `PUBLIC` remains denied.
- Verify function checksum and contract marker remain unchanged.
- Prove runtime slug and custom-domain lookups return only the approved projection.
- Prove inactive, missing, malformed, and cross-form inputs return no row.

### 6.3 Controlled production acceptance gate

A later Advisor GO must govern merge and deployment. The expected sequence is:

1. Human review and exact-head PR CI.
2. Disable deploy workflow `251547585` and verify no active real deployment.
3. Merge with an exact-head guard.
4. Wait for exact-main CI and immutable image publication.
5. Re-enable the workflow without a side-effect deployment.
6. Dispatch exactly once for the exact post-merge main SHA.
7. Verify migration and exact catalog ACL posture.
8. Run a CloudVault organization-family matrix for slug, subdomain, custom domain, public branding,
   inactive, missing, and malformed cases.
9. Only after CloudVault is green, run the existing minimal Brightside custom-host or canonical-host
   shell, known-room, logout, and protected re-entry smoke without content access.
10. Publish versioned evidence and stop for written close-out.

Retain `ca-vaultspace-web--0000290`, `ca-vaultspace-web--0000291`, and their prior digests through
the controlled deployment. Roll back on any organization-resolution or Brightside failure. Do not
issue a second deployment without a new GO.

## 7. Strawman, Steelman, and Pre-Mortem

### Strawman

- Organization resolution sits before login and tenant context, so one mapping regression could
  make every custom domain or organization login appear missing.
- Converting middleware, branding, and the landing page together touches more public entry points
  than the preceding session-read unit.
- Reusing the branding projection could accidentally expose a field that was not public before.
- A broad EXECUTE grant or an unexpected overload could turn a small public lookup into a wider
  bootstrap capability.

### Steelman

- The exact function and typed repository have already been deployed inert, catalog-verified, and
  acceptance-closed in Unit 3.
- One existing static function replaces all six direct administrative organization reads without
  adding a new database capability.
- The function enforces active state and returns less data than the organization model surface.
- Converting the complete slug, custom-domain, and branding family avoids leaving a hidden direct
  administrative lookup behind.
- The application can eliminate the branding route's second query by reusing the reviewed public
  projection.

### Pre-Mortem

| If                                                    | Detection                                     | Response                                           |
| ----------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Valid CloudVault slug or domain resolves to not found | Unit, integration, and CloudVault matrix      | Roll back; inspect normalization and lookup kind   |
| Inactive organization resolves                        | Integration and CloudVault inactive case      | Fail acceptance and roll back                      |
| Branding includes a private field                     | Type, mapper, response, and integration tests | Block merge; do not widen the projection           |
| Organization function grant widens or overload drifts | Migration and catalog ACL checks              | Fail migration or acceptance; do not route traffic |
| Custom hostname works but canonical subdomain breaks  | Paired domain matrix                          | Roll back; no partial acceptance                   |
| Operational exception details reach logs or clients   | Focused error-path tests                      | Replace with categorical logging before merge      |
| Brightside shell or known room fails after deploy     | Minimal Brightside smoke after CloudVault     | Immediate rollback and stop                        |
| Admin URL is removed during this unit                 | Diff and deployment review                    | Reject as out of scope                             |

## 8. Status stamp

**W1-2 ORGANIZATION RESOLVE ROUTE CONVERSION: ANALYSIS COMPLETE, IMPLEMENTATION NOT STARTED, NOT
MERGED, NOT DEPLOYED.**

W1-2 Units 1 through 5 remain acceptance-closed. Runtime EXECUTE remains limited to login candidate
and session resolve until a later controlled deployment. Organization EXECUTE remains withheld in
production. Session mutation remains unchanged. `DATABASE_URL_ADMIN` remains present. W1-2 overall
remains OPEN. W1-3 remains not started.

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_ORGANIZATION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_ORGANIZATION_BOOTSTRAP_FOUNDATION_DEPLOYMENT_EVIDENCE_2026-08-12_v1.md`
- `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v2.md`
- `prisma/migrations/20260812050000_w1_2_organization_bootstrap_foundation/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/middleware/auth.ts`
- `src/lib/middleware/customDomain.ts`
- `src/app/api/public/branding/route.ts`
- `src/app/org/[slug]/page.tsx`
- `tests/integration/bootstrap-organization-resolve.test.ts`
