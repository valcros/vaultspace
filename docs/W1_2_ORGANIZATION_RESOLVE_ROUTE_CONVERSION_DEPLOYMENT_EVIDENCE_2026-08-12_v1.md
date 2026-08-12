# W1-2 Organization Resolve Route Conversion Deployment Evidence

- **Date:** 2026-08-12
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Organization slug, custom-domain, public-branding, and landing resolution
- **Source PR:** #137
- **Reviewed source head:** `c3755a78481d2adf2dec21f1b65e77bfae6579e8`
- **Merge commit and deployed release:** `6210f9d27ce34856d08cbfeb893c0e064aa057e3`
- **Exact-head PR CI:** `31627081661`, success
- **Exact-main CI:** `31633471355`, success
- **Deployment:** `31634219354`, attempt 1 success
- **Live web revision:** `ca-vaultspace-web--0000293`
- **Result:** Deployment, catalog posture, CloudVault organization-family matrix, and bounded
  Brightside smoke green
- **W1-2 Unit 6 status:** Technical acceptance criteria met, pending written Advisor close-out
- **W1-2 overall status:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Scope and boundary

This unit converted only the accepted public organization-resolution family to the constrained
organization bootstrap function. It:

- granted `vaultspace_app` EXECUTE on exactly
  `public.bootstrap_organization_resolve_v1(text, text)`, in addition to the already accepted login
  and session-resolve grants;
- retained `PUBLIC` denial;
- converted header slug, canonical subdomain, custom-domain, public-branding, and organization
  landing resolution to the runtime-backed `BootstrapRepository`;
- removed direct `bootstrapDb` use from the four converted production files;
- reused the approved public organization projection without a second branding query; and
- limited public branding output to name, slug, logo URL, primary color, and favicon URL.

This unit did not:

- convert session creation, activity refresh, logout, invalidation, revocation, or cache behavior;
- change login, session resolve, two-factor completion, registration, password reset, links, rooms,
  documents, or any other route family;
- remove `DATABASE_URL_ADMIN` from the public web workload;
- change the web entrypoint or migration execution model;
- apply W1-3 FORCE RLS or remove bootstrap policies;
- change P0-4, malware scanning, networking, DNS, certificates, firewall, private networking, HA,
  or geo posture;
- access CloudVault room or document data;
- enumerate Brightside rooms or access Brightside document metadata or content; or
- run production `deep=true` health.

## 2. Human review and exact-head validation

Human review covered the complete PR #137 diff and confirmed:

- the migration fails closed on bootstrap-owner posture, zero membership reachability, exact
  function contract, source checksum, and pre-grant ACL drift;
- the complete runtime grant matrix is exactly login candidate, session resolve, and organization
  resolve;
- no other public `bootstrap_*` function or overload becomes executable by `vaultspace_app`;
- `PUBLIC` remains denied;
- the four converted production files contain no `bootstrapDb` import, call, or fallback;
- the public branding response contains only the five approved public fields;
- operational error logs are categorical and exclude exception details;
- session mutation remains source-bound unchanged; and
- no route family outside public organization resolution changed.

The reviewed PR head was `c3755a78481d2adf2dec21f1b65e77bfae6579e8`. Exact-head PR CI run
`31627081661` completed successfully. It included lint, formatting, type checking, unit tests, RLS
integration, provider integration, E2E, production build, standalone build, container build, and
the organization conversion tests.

## 3. Authorized local cleanup

Before merge, the following two disposable local PostgreSQL containers were removed exactly as
authorized:

- `vaultspace-w1-2-org-route-v1`; and
- `vaultspace-w1-2-org-route-v2`.

Only those container records and writable layers were removed. Images, volumes, other containers,
files, Azure resources, and production data were untouched.

## 4. Controlled merge and exact-main CI

Before merge:

- workflow `251547585` was active;
- no real deployment was queued or in progress;
- the workflow was disabled and verified as `disabled_manually`; and
- live production remained healthy on
  `9c465f81799440c8bdd40dd6b0df1e3a250a96d1 / ca-vaultspace-web--0000292`.

PR #137 was marked ready and merged with an exact-head guard. The resulting main tip was
`6210f9d27ce34856d08cbfeb893c0e064aa057e3`.

Exact-main CI run `31633471355` completed successfully on that merge commit. The E2E suite and the
web and worker immutable image publications were green. No deployment started while workflow
`251547585` was disabled.

After exact-main CI was green:

- main still equaled the approved merge commit;
- no real deployment was active or queued;
- the deploy workflow was re-enabled and verified as `active`;
- enablement did not start a deployment; and
- exactly one workflow dispatch was issued for the exact main SHA.

## 5. Single deployment and live identity

Deploy run `31634219354` succeeded on attempt 1 for
`6210f9d27ce34856d08cbfeb893c0e064aa057e3`. No second dispatch was issued. Recovery did not run.

The pipeline passed rollback-source capture, immutable-image checks, password-reset delivery
compatibility, migration application, worker readiness, reconciler verification, web cutover, all
three job updates, quick health, strict web convergence, traffic validation, and final worker
readiness.

Quick uncached health returned HTTP 200 with `Cache-Control: no-store, max-age=0`:

| Field                  | Result                                     |
| ---------------------- | ------------------------------------------ |
| Status                 | healthy                                    |
| Mode                   | azure                                      |
| Release                | `6210f9d27ce34856d08cbfeb893c0e064aa057e3` |
| Revision               | `ca-vaultspace-web--0000293`               |
| Degraded capabilities  | none                                       |
| Reset token write mode | hmac                                       |
| Recovery configured    | true                                       |

The pipeline initially observed the expected dual-active transition, then the approved convergence
retry confirmed the new revision as the sole active exact-release revision at 100 percent traffic
on attempt 2.

## 6. Workload coherence and rollback posture

The web workload converged to exactly one active revision with 100 percent traffic:

- web revision: `ca-vaultspace-web--0000293`;
- health: Healthy;
- provisioning: Provisioned;
- running: Running;
- replicas: 1;
- traffic: 100 percent; and
- web runnable digest:
  `sha256:2143b011de776728506cea3f84df62a6acdb8adb31387fd04bcd520129744fdc`.

The worker and all three scheduled jobs use one coherent worker digest:

`sha256:9ddbf5e8138e0ea80a9a1dd0e3ac225eeff994f5282c7460260766418517a65e`

| Workload                         | Result                         |
| -------------------------------- | ------------------------------ |
| `ca-vaultspace-worker--0000276`  | Healthy, Provisioned, deployed |
| `ca-vaultspace-delayed-waker`    | Provisioned, deployed digest   |
| `ca-vaultspace-invite-lifecycle` | Provisioned, deployed digest   |
| `ca-vaultspace-pwreset-recon`    | Provisioned, deployed digest   |

The immediate prior web rollback source remains retained:

- revision: `ca-vaultspace-web--0000292`;
- status: inactive, Healthy, and Provisioned; and
- runnable digest:
  `sha256:cd532df2c877cbae2221f66e51056365d3fa6e1e28db27bc591f84ba893a2953`.

The captured prior coherent worker digest remains:

`sha256:73a1b26ae59372fb086ab21190a0cec7998678bac125b60e3dfceb31162b3d45`

No revision or image was deleted. The deploy workflow remains active.

## 7. Production catalog acceptance

Catalog verification used a process-local connection obtained from the existing Munger Key Vault.
The secret value was not printed, persisted, written to a file, or placed in a command argument.
Queries were limited to PostgreSQL catalog, role, function, and migration metadata except for the
separately authorized synthetic CloudVault fixture operations.

Migration `20260812190000_w1_2_organization_route_conversion` is finished and has not been rolled
back.

### 7.1 Owner posture

`vaultspace_bootstrap_owner` remains:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEDB;
- NOCREATEROLE;
- NOREPLICATION;
- without members; and
- unreachable directly or transitively by `vaultspace_app`.

### 7.2 Organization function contract

The organization-resolve function remained exact:

- signature: `public.bootstrap_organization_resolve_v1(text, text)`;
- identity arguments: `input_lookup_kind text, input_lookup_value text`;
- owner: `vaultspace_bootstrap_owner`;
- language: SQL;
- SECURITY DEFINER: true;
- volatility: stable;
- parallel mode: restricted;
- configuration: `search_path=pg_catalog`;
- contract marker: `vaultspace-contract:w1-2-organization-resolve-v1`;
- stored source SHA-256:
  `27cc50a7040e357fc49cb9a838432df9b0a5b9845aa49640acf2a71d4bc14df7`;
- `vaultspace_app` EXECUTE: true; and
- `PUBLIC` EXECUTE: false.

The live runtime EXECUTE matrix was:

| Function                                       | `vaultspace_app` EXECUTE |
| ---------------------------------------------- | ------------------------ |
| `bootstrap_login_candidate_v1(text)`           | yes                      |
| `bootstrap_session_resolve_v1(text)`           | yes                      |
| `bootstrap_organization_resolve_v1(text,text)` | yes                      |
| every other public `bootstrap_*`               | no                       |

The exact ACL inspection showed only the owner and `vaultspace_app` on the three approved
functions. `PUBLIC` has no EXECUTE on any public `bootstrap_*` function. The owner itself did not
become reachable.

## 8. CloudVault organization-family acceptance

The versioned runner
`scripts/cloudvault-w1-2-organization-resolve-acceptance-v1.cjs` performed bounded production
acceptance against the retained active synthetic organization named exactly `CloudVault` with slug
`cloudvault-w1-2-verify`. It used one dedicated synthetic VIEWER identity with a generated
process-memory password. No password or database secret was printed or persisted.

| Authorized check                                                      | Result |
| --------------------------------------------------------------------- | ------ |
| Quick health matches the exact Unit 6 release                         | PASS   |
| Conversion migration and exact three-function catalog posture         | PASS   |
| Login and session retain exact CloudVault identity                    | PASS   |
| Header slug returns only approved public branding fields              | PASS   |
| Canonical CloudVault wildcard subdomain returns approved branding     | PASS   |
| Custom-domain header resolves without a DNS change                    | PASS   |
| Organization landing resolves to the canonical organization login     | PASS   |
| Unknown slug and domain return the same neutral branding response     | PASS   |
| Inactive CloudVault returns neutral branding and is restored promptly | PASS   |
| Login and session recover after the bounded inactive check            | PASS   |
| Logout succeeds and the old session returns 401                       | PASS   |

Result: **11/11 PASS**.

The approved public projection was checked for exact keys. It contains only name, slug, logo URL,
primary color, and favicon URL. The runner temporarily supplied a non-routable synthetic custom
domain because the retained CloudVault organization had no custom domain. No DNS or Azure binding
changed. Cleanup restored the original null custom-domain state.

The runner temporarily soft-disabled only the retained synthetic CloudVault organization to prove
neutral inactive behavior, restored it immediately in a `finally` path, and then proved login and
session recovery. Final cleanup confirmed:

- CloudVault is active;
- its exact name and slug are unchanged;
- its custom domain is restored to null;
- synthetic sessions are inactive;
- the synthetic membership is inactive; and
- the synthetic user is inactive.

No CloudVault room, folder, document, link, preview, download, export, or content endpoint was used.

### 8.1 Acceptance-runner corrections

Two pre-final runner executions stopped on test-harness contract assumptions after all preceding
checks had passed:

1. The first expected `/api/auth/me` to include a top-level organization object. The established
   route returns only the authenticated user profile. The corrected runner verifies exact
   CloudVault identity from the login response and the authoritative session row.
2. The second expected the unauthenticated organization landing to render HTTP 200. The established
   product contract is HTTP 307 to `/auth/login?org=cloudvault-w1-2-verify`. The corrected runner
   binds that exact neutral redirect.

Both stopped runs completed synthetic cleanup and restored CloudVault. Neither represented a live
application defect, and neither triggered a deployment or rollback. The final execution passed all
11 checks.

## 9. Brightside bounded read-only smoke

CloudVault acceptance was green before any Brightside access. The user established an authenticated
Brightside session in Chrome on the canonical application host. The authenticated shell visibly
identified Brightside.

One focused browser-history lookup located exactly one previously known Brightside room route. The
room identifier, title, customer data, and document data were not read or recorded. The room list
was not opened.

| Authorized check                                      | Result |
| ----------------------------------------------------- | ------ |
| Existing Brightside session and authenticated shell   | PASS   |
| Brightside organization identity visible              | PASS   |
| Previously known room route on the authenticated host | PASS   |
| Logout through the application UI                     | PASS   |
| Protected known-room re-entry after logout is denied  | PASS   |

The known route remained on the expected room path, presented the authenticated application main
region, and showed no login form, fatal-error state, or room-not-found state. No room name, room
identifier, document name, metadata, preview, download, export, or content was read or recorded.

Logout through the application account menu returned the tab to the canonical login route. A direct
re-entry attempt to the same known room path remained on the login route and did not expose the
authenticated room. The Brightside account was left logged out.

## 10. Environment boundary

The live web template still contains exactly one `DATABASE_URL_ADMIN` entry, and that entry remains
secret-backed. The ordinary runtime `DATABASE_URL` entry remains present. No secret value was read
from Container Apps metadata or recorded in evidence.

Session mutation remains on the established path. No admin URL removal, web entrypoint change,
W1-3 enforcement, P0-4 change, networking change, or second deployment occurred.

## 11. Status and next gate

**W1-2 UNIT 6 ORGANIZATION RESOLVE ROUTE CONVERSION: DEPLOYED, CATALOG GREEN, CLOUDVAULT 11/11
GREEN, BRIGHTSIDE MINIMAL SMOKE GREEN, PENDING WRITTEN ADVISOR CLOSE-OUT.**

W1-2 overall remains OPEN. `DATABASE_URL_ADMIN` remains present on the public web workload. Runtime
EXECUTE is limited to login candidate, session resolve, and organization resolve. Session mutations
remain unconverted. This evidence and acceptance runner are ready for publication in a draft PR for
Advisor review. Unit 6 must not be called acceptance-closed until written Advisor close-out.

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_ORGANIZATION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_ORGANIZATION_BOOTSTRAP_FOUNDATION_DEPLOYMENT_EVIDENCE_2026-08-12_v1.md`
- `docs/W1_2_ORGANIZATION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v1.md`
- `docs/W1_2_ORGANIZATION_RESOLVE_ROUTE_CONVERSION_VALIDATION_2026-08-12_v1.md`
- `prisma/migrations/20260812050000_w1_2_organization_bootstrap_foundation/migration.sql`
- `prisma/migrations/20260812190000_w1_2_organization_route_conversion/migration.sql`
- `scripts/cloudvault-w1-2-organization-resolve-acceptance-v1.cjs`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/middleware/auth.ts`
- `src/lib/middleware/customDomain.ts`
- `src/app/api/public/branding/route.ts`
- `src/app/org/[slug]/page.tsx`
