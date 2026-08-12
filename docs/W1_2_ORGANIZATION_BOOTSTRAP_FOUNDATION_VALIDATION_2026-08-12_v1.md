# W1-2 Organization Bootstrap Foundation Validation

- **Date:** 2026-08-12
- **Evidence version:** 1
- **Control family:** Database privilege split
- **Implementation unit:** Additive organization-resolve foundation
- **Status:** Prepared for draft review, not merged, not deployed, and not used by a route
- **Analysis record:** `docs/W1_2_ORGANIZATION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- **Analysis-first commit:** `2b48ca9`
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Outcome

The additive organization bootstrap foundation is implemented and locally validated on fresh
PostgreSQL 15 databases. The unit introduces:

1. One static, exact SECURITY DEFINER function that resolves an active organization by canonical
   slug or custom domain.
2. One typed `BootstrapRepository` projection for organization identity and existing public
   branding fields.
3. Unit and real PostgreSQL catalog, privilege, lookup-isolation, projection, hostile-input, and
   neutral-denial tests.
4. CI RLS-matrix coverage for the new integration suite.

The implementation deliberately does not:

- add any table, sequence, schema-create, or write privilege to `vaultspace_bootstrap_owner`;
- grant function execution to `PUBLIC` or `vaultspace_app`;
- import or call the new repository methods from middleware, public branding, forgot password, or
  any route;
- change custom-domain or subdomain parsing;
- change `bootstrapDb`;
- remove `DATABASE_URL_ADMIN`;
- change the web entrypoint, deployment workflow, Azure, or Key Vault;
- change W1-3 policy posture;
- change malware scanning or P0-4 behavior;
- access CloudVault, Brightside, or customer data; or
- deploy this branch.

## 2. Analysis-first chronology

The mandatory Strawman, Steelman, Pre-Mortem, rollback, and go or no-go record was committed as
`2b48ca9` before the migration, repository, test, package, or validation files were created.

The implementation boundary remained unchanged after validation:

- one new read-only function;
- no new owner privilege;
- one typed, unused repository capability;
- runtime and `PUBLIC` execution withheld; and
- no route, infrastructure, or deployment change.

## 3. Database contract proved

### 3.1 Owner posture and privileges

`vaultspace_bootstrap_owner` remains:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEDB;
- NOCREATEROLE;
- NOREPLICATION;
- unreachable directly or transitively from `vaultspace_app`; and
- unavailable to `vaultspace_app` through `SET ROLE`.

The owner has schema `USAGE`, not schema `CREATE`, and table `SELECT` only on:

- `organizations`;
- `sessions`;
- `user_organizations`; and
- `users`.

The migration adds no owner table, sequence, schema-create, or write privilege.

### 3.2 Function posture

- Exact signature: `public.bootstrap_organization_resolve_v1(text, text)`.
- Exact identity arguments: `input_lookup_kind text, input_lookup_value text`.
- Exact owner: `vaultspace_bootstrap_owner`.
- SQL language.
- Stable and parallel restricted.
- SECURITY DEFINER enabled.
- Exact `search_path=pg_catalog` configuration.
- Fully qualified table reference.
- Static SQL with no dynamic execution.
- Exact contract comment: `vaultspace-contract:w1-2-organization-resolve-v1`.
- Stored source SHA-256:
  `27cc50a7040e357fc49cb9a838432df9b0a5b9845aa49640acf2a71d4bc14df7`.
- Owner is the only role with execution in the foundation posture.
- `PUBLIC` cannot execute the function.
- `vaultspace_app` cannot execute the function.

### 3.3 Lookup behavior

The function accepts only:

- `SLUG` with a 1 through 100 character lowercase slug value; or
- `CUSTOM_DOMAIN` with a 1 through 255 character canonical lowercase multi-label hostname.

The repository trims and lowercases caller inputs and rejects malformed values before issuing a
query. PostgreSQL independently repeats the lookup-kind, length, shape, and active-organization
guards.

The function returns one row only when the requested kind matches the corresponding unique
organization field and the organization is active. The projection includes only:

- organization ID;
- name;
- slug;
- custom domain;
- logo URL;
- primary color; and
- favicon URL.

It does not return sender identity, audit settings, retention settings, storage limits, membership,
user, room, document, link, token, or credential data.

Unknown kind, cross-kind lookup, malformed input, SQL-shaped input, inactive organization, and
unknown organization all return the same neutral no-row result.

## 4. Validation executed

### 4.1 Focused repository tests

- Test file: `src/lib/auth/bootstrapRepository.test.ts`.
- Tests: 21 of 21 passed.
- New organization cases cover exact parameterization, slug and domain normalization, malformed
  inputs without a database call, neutral no-row, duplicate rejection, minimal mapping, and
  malformed-projection rejection.

### 4.2 Fresh PostgreSQL 15 migration and RLS proof

A new `postgres:15-alpine` container and blank database were used.

- Fresh migrations: 43 of 43 applied.
- New migration:
  `20260812050000_w1_2_organization_bootstrap_foundation`.
- Guarded RLS test-role setup: passed.
- CI-parity RLS repair and provider-boundary verification: passed.
- Existing login and session functions remained present and owner-only.
- New organization function posture and source checksum matched exactly.

The complete RLS integration command passed:

- test files: 7 of 7;
- tests: 69 of 69;
- W1-2 organization foundation: 4 of 4; and
- W1-2 login and session foundations remained green.

The matrix also preserved W1-1 room authorization, W1-1 link-admission concurrency, RLS tenant
isolation, and password-reset provider-evidence behavior.

The first full-matrix invocation omitted the disposable-database allow marker from the Vitest
process. The guard stopped one populated-migration fixture before it ran, while the other 68 tests
passed. The command was rerun with `ALLOW_RLS_TEST_DB_SETUP=true`, matching CI, and all 69 tests
passed. No product or test code changed to address that harness invocation error.

### 4.3 Azure-like non-superuser migration proof

A second fresh PostgreSQL 15 database was owned and migrated by a role with:

- LOGIN;
- CREATEDB;
- CREATEROLE;
- NOSUPERUSER;
- NOBYPASSRLS; and
- NOREPLICATION.

All 43 migrations applied successfully through that role. Final catalog output confirmed:

- the migrator remained non-superuser and without BYPASSRLS;
- `vaultspace_bootstrap_owner` remained non-superuser and without BYPASSRLS;
- the organization resolver owner is `vaultspace_bootstrap_owner`;
- SECURITY DEFINER is true;
- volatility is stable;
- parallel mode is restricted;
- `search_path=pg_catalog`; and
- the migration record is finished and not rolled back.

The first read-only display query after migration needed explicit text casts for PostgreSQL internal
one-character catalog fields. The corrected read-only query returned the expected posture. The
migration itself had already completed successfully and was not rerun or changed.

### 4.4 Application checks

- `npm run type-check`: passed.
- `npm run lint`: passed with zero errors and one pre-existing hook dependency warning outside the
  diff.
- `npm test`: 141 files passed and 1 file intentionally skipped; 1,334 tests passed and 7 tests
  intentionally skipped.
- `npm run build`: passed, including compilation, TypeScript, and 37 static pages.
- Changed TypeScript, JSON, and Markdown Prettier check: passed.
- `git diff --check`: passed.
- Function source checksum recomputation: matched the pinned SHA-256.
- Static import check: the new organization resolver appears only in the repository and its tests.

The production build generated a quote-style-only change in `next-env.d.ts`; that generated change
was restored and is not part of the unit.

## 5. Unit 2 evidence-merge operational note

Before Unit 3 implementation, evidence PR #130 was confirmed fully green and exact-scope, then
merged as `ae355d39c21b6d4b7b04a5cbec9b6960ead3cc0e`.

The docs-only main CI run `31562877978` later failed only in the standalone password-reset browser
step. Its optimized production build completed, then the test web server exited with signal 139
before the browser test could start. All other jobs passed, including ordinary E2E, type-check,
lint, unit tests, RLS integration, security scan, Build, and main image publication.

Deploy workflow run `31563321859` skipped because main CI was not successful. No production
deployment occurred. Quick uncached health remained HTTP 200 with `no-store`, release
`b9c2e0018d5e0727f8cfe515d2e335c46ecafe96`, and revision
`ca-vaultspace-web--0000286`.

No rerun or waiver was self-granted. A separate short GO is required to rerun the failed main CI
job if a clean Unit 2 paper-trail gate is desired.

## 6. Disposable local infrastructure posture

The PostgreSQL containers contain only synthetic databases, roles, and fixtures. They were stopped
after validation and retained rather than deleted:

- `vaultspace-w1-2-org-foundation-v1`;
- `vaultspace-w1-2-org-foundation-v2`; and
- `vaultspace-w1-2-org-foundation-azure-v1`.

No Azure database, CloudVault row, Brightside row, or customer data was used.

## 7. Rollback and deployment posture

Before merge, rollback is closing the draft or abandoning this branch.

If the additive migration is later reviewed, merged, and deployed:

- keep runtime and `PUBLIC` execution revoked;
- keep all existing organization-resolution and public-branding paths unchanged;
- retain the prior web and worker revisions and images;
- do not edit or reverse the applied migration during immediate application rollback; and
- correct any catalog issue through a new reviewed migration.

Because no route calls the function and runtime execution is withheld, the database object can
remain inert while a correction is reviewed.

## 8. Gate status

### Ready for draft review

- Analysis-first record.
- One additive read-only organization function.
- No new owner privilege.
- Typed, unused repository methods.
- PostgreSQL 15 fresh-migration and real-role integration proof.
- Azure-like non-superuser migration proof.
- Exact catalog, ACL, source, projection, isolation, and neutral-denial tests.
- Full local application, build, and RLS regression evidence.

### Still blocked

- Merge or production deployment without human review and controlled deployment authorization.
- Runtime execute grant.
- Middleware, public-branding, forgot-password, or route conversion.
- Session mutation or password-reset bootstrap implementation.
- CloudVault matrix for a replacement path.
- Web entrypoint DDL removal.
- One-shot Azure migrator cutover.
- Web `DATABASE_URL_ADMIN` removal.
- W1-3 bootstrap-policy removal or production FORCE changes.

## 9. Standing status

W1-1 remains closed. W1-2 Units 1 and 2 remain acceptance-closed. This organization-resolve
foundation is implemented locally, not merged, not deployed, and not callable by the runtime.
The public web admin database privilege remains open. W1-3 production enforcement has not started.
The security freeze and silent-hardening posture remain active. P0-4 remains accepted and
unchanged.

## References

- PR #130
- Main CI run `31562877978`
- Deploy workflow run `31563321859`
- `docs/W1_2_ORGANIZATION_BOOTSTRAP_FOUNDATION_2026-08-12_v1.md`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `prisma/migrations/20260812050000_w1_2_organization_bootstrap_foundation/migration.sql`
- `src/lib/auth/bootstrapRepository.ts`
- `src/lib/auth/bootstrapRepository.test.ts`
- `tests/integration/bootstrap-organization-resolve.test.ts`
- `package.json`
