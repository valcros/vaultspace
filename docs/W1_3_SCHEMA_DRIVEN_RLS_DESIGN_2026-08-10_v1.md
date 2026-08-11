# W1-3 Schema-Driven RLS Completeness Design

- **Date:** 2026-08-10
- **Status:** Design only, Advisor review required
- **Decision owner:** Stakeholder Advisor
- **Implementation status:** Blocked pending explicit W1-3 GO
- **Dependency:** W1-2 bootstrap replacement must be proven before broad bootstrap policies are removed or new FORCE RLS can affect authentication

## 1. Decision summary

Make the Prisma schema, not a hand-maintained table array, the source for tenant-table discovery. Every Prisma model with a direct `organizationId` field must have enabled RLS, FORCE RLS, at least one approved policy, runtime-role privileges appropriate to its workload, a negative two-organization test fixture, or an explicit reviewed exception. Indirect tenant tables and global security tables must be classified in a checked manifest with a rationale and a different isolation control.

Move RLS DDL into reviewed migrations executed by the W1-2 one-shot migrator. Fix `page_views` to use `app.current_org_id`. Remove broad no-context identity policies only after W1-2 bootstrap functions are proven. Make CI query a disposable PostgreSQL catalog and fail when the schema, manifest, policies, FORCE state, privileges, or negative fixture coverage drift.

## 2. Repository inventory

This inventory compares tracked Prisma and SQL artifacts. It is not a statement about the current live database. Live state must be verified later through `pg_catalog` in the approved non-customer path.

### 2.1 Direct tenant models

The current Prisma schema has 35 models with a direct `organizationId` field.

| Prisma model             | Table                      | Repository policy evidence      | Repository FORCE evidence |
| ------------------------ | -------------------------- | ------------------------------- | ------------------------- |
| `UserOrganization`       | `user_organizations`       | Central policy file             | Central policy file       |
| `Session`                | `sessions`                 | Missing                         | Missing                   |
| `Room`                   | `rooms`                    | Central policy file             | Central policy file       |
| `Folder`                 | `folders`                  | Central policy file             | Central policy file       |
| `Document`               | `documents`                | Central policy file             | Central policy file       |
| `DocumentVersion`        | `document_versions`        | Central policy file             | Central policy file       |
| `FileBlob`               | `file_blobs`               | Central policy file             | Central policy file       |
| `PreviewAsset`           | `preview_assets`           | Central policy file             | Central policy file       |
| `ExtractedText`          | `extracted_texts`          | Central policy file             | Central policy file       |
| `SearchIndex`            | `search_indexes`           | Central policy file             | Central policy file       |
| `Link`                   | `links`                    | Central policy file             | Central policy file       |
| `LinkVisit`              | `link_visits`              | Missing                         | Missing                   |
| `ViewSession`            | `view_sessions`            | Central policy file             | Central policy file       |
| `Permission`             | `permissions`              | Central policy file             | Central policy file       |
| `RoleAssignment`         | `role_assignments`         | Missing                         | Missing                   |
| `Group`                  | `groups`                   | Central policy file             | Central policy file       |
| `Event`                  | `events`                   | Central policy file             | Central policy file       |
| `RoomTemplate`           | `room_templates`           | Missing                         | Missing                   |
| `Notification`           | `notifications`            | Missing                         | Missing                   |
| `NotificationPreference` | `notification_preferences` | Missing                         | Missing                   |
| `Invitation`             | `invitations`              | Central policy file             | Central policy file       |
| `PasswordResetToken`     | `password_reset_tokens`    | Missing                         | Missing                   |
| `Question`               | `questions`                | Missing                         | Missing                   |
| `Answer`                 | `answers`                  | Missing                         | Missing                   |
| `Checklist`              | `checklists`               | Missing                         | Missing                   |
| `ChecklistItem`          | `checklist_items`          | Missing                         | Missing                   |
| `CalendarEvent`          | `calendar_events`          | Missing                         | Missing                   |
| `Bookmark`               | `bookmarks`                | Missing                         | Missing                   |
| `AccessRequest`          | `access_requests`          | Missing                         | Missing                   |
| `NotificationTemplate`   | `notification_templates`   | Missing                         | Missing                   |
| `Message`                | `messages`                 | Missing                         | Missing                   |
| `PageView`               | `page_views`               | Migration policy uses wrong GUC | Missing                   |
| `SignatureRequest`       | `signature_requests`       | Missing                         | Missing                   |
| `Webhook`                | `webhooks`                 | Migration policy                | Missing                   |
| `UserDashboardLayout`    | `user_dashboard_layouts`   | Missing                         | Missing                   |

Repository SQL therefore shows policy evidence for 17 of 35 direct tenant models and FORCE evidence for 15 of 35. Those counts are drift indicators, not live findings.

### 2.2 Page-view GUC mismatch

Migration `20260402110000_add_page_views_ip_allowlist` creates `page_views_tenant_isolation` with:

```sql
current_setting('app.organization_id', true)
```

The application consistently establishes:

```sql
SET LOCAL app.current_org_id = ...
```

The page-view policy can therefore see no matching tenant context even when the application uses `withOrgContext()` correctly. The repair must drop and recreate the policy with `app.current_org_id`, add an explicit `WITH CHECK`, and FORCE RLS.

### 2.3 Stale audit and repair lists

`scripts/rls-audit.ts`, `scripts/rls-fix.ts`, and `prisma/rls-policies.sql` contain separate hard-coded table arrays or statements. They predate many tenant models. The audit script also lists deferred `watermark_configs`, which has no current Prisma model, while omitting newer real tables.

CI currently runs a real constrained role, but setup applies the stale central policy file and tests mostly exercise the older core tables. A green RLS job therefore does not prove complete current-schema coverage.

### 2.4 Bootstrap and auth routes that will be affected

Correct RLS will break routes that rely on missing policy coverage or no-context access unless W1-2 lands first. High-risk paths include:

- `Session`, which has nullable `organizationId` and currently no RLS;
- login and session resolution;
- 2FA validation, which currently reads and updates `User` through an unscoped runtime client;
- public access requests, which currently use unscoped `db` queries and writes;
- password reset and administrator reset across account-global state;
- invitation, domain, public link, and viewer-session bootstrap;
- multi-organization user safeguards.

W1-3 must not ship FORCE RLS that bricks these routes. W1-2's narrow bootstrap functions are a hard prerequisite for removing broad no-context policies.

## 3. Schema-derived manifest

### 3.1 Discovery source

Add one versioned RLS manifest and verifier. The verifier reads the generated Prisma DMMF and uses each model's database table mapping. Any model with a scalar field named `organizationId` is automatically classified as `direct_tenant`.

The manifest does not manually enumerate direct tenant models as its source. It supplies required policy metadata and classifications that cannot be inferred from Prisma alone.

Conceptual shape:

```typescript
type RlsClassification =
  | { kind: 'direct_tenant'; policy: string; fixture: string }
  | { kind: 'indirect_tenant'; parentPath: string; policy: string; fixture: string }
  | { kind: 'global_protected'; control: string; rationale: string }
  | { kind: 'global_public'; control: string; rationale: string };
```

CI fails if:

- a Prisma model with `organizationId` lacks `direct_tenant` treatment;
- a manifest entry points to a missing model or table;
- a tenant entry lacks a named policy or negative fixture;
- an exception lacks a non-empty rationale and control owner;
- a model changes table mapping without a matching catalog result;
- the disposable database lacks ENABLE, FORCE, or the expected policy after migrations.

### 3.2 Indirect and global tables

Models without a direct `organizationId` must be explicitly reviewed. Examples include:

- `Organization`, isolated by its own `id` and bootstrap functions;
- `User`, isolated through active `UserOrganization` membership and narrow bootstrap functions;
- `GroupMembership`, isolated through its parent `Group`;
- password-reset recovery and provider-correlation tables, which are global security state protected by specialized roles, functions, triggers, and direct privilege revocation;
- provider event inbox, which is isolated from the ordinary application role;
- pure reference or system-global tables, if any, with read-only or public-row controls.

An indirect classification is not an exemption from tests. The policy must use a parent relation, and the fixture must prove cross-tenant denial.

### 3.3 Exceptions

The preferred outcome is no exception for any direct `organizationId` model. Nullable or system-wide rows require policy branches, not omission. Examples:

- `Session.organizationId` can use narrow security-definer session functions for pre-tenant lookup and organization-bound policies for normal use.
- `RoomTemplate.organizationId` can allow organization rows plus specifically defined system or public templates.
- account-global password reset state can be accessed through W1-2 functions while direct table access remains denied.

Any direct-model exception discovered during implementation requires a written rationale in the manifest and separate Advisor approval before merge.

## 4. Policy contract

### 4.1 Canonical tenant key

All tenant policies use:

```sql
NULLIF(current_setting('app.current_org_id', true), '')
```

No policy may use `app.organization_id`, a session-wide `SET`, request headers, or request-body tenant IDs.

`withOrgContext()` remains the ordinary application boundary and uses `SET LOCAL` inside a transaction.

### 4.2 Required posture per tenant table

Each direct or indirect tenant table requires:

- `ENABLE ROW LEVEL SECURITY`;
- `FORCE ROW LEVEL SECURITY`;
- an explicitly named policy;
- explicit `USING` and `WITH CHECK` predicates for writable commands;
- appropriate table and sequence privileges for the runtime role;
- no policy that allows all rows merely because tenant context is empty;
- a two-organization negative fixture for SELECT, INSERT, UPDATE, and DELETE where the model supports those operations.

Append-only or specialized tables can have narrower command policies and revoked table privileges. The manifest records those differences.

### 4.3 Identity and bootstrap policies

After W1-2 is proven:

- remove `user_bootstrap_lookup`, which currently exposes every user row to the normal role when context is empty;
- remove broad no-context `user_organizations` lookup;
- remove broad invitation-token lookup in favor of a narrow function;
- remove bootstrap insert policies that permit generic no-context inserts;
- restrict organization, domain, branding, session, link, and access-request bootstrap to the exact W1-2 functions;
- preserve only tenant-context policies for direct Prisma use.

The ordinary runtime client must return no user rows with no org context. Password hashes, TOTP secrets, and backup-code hashes are available only through the narrow function paths described in W1-2.

### 4.4 Page views

The page-view repair must:

- replace `app.organization_id` with `app.current_org_id`;
- add `WITH CHECK` for inserts and updates;
- FORCE RLS;
- prove Organization A can create and read its page views;
- prove Organization B and no-context runtime queries cannot read, insert, update, or delete Organization A page views;
- preserve the authorized viewer page-view route through `withOrgContext()`.

### 4.5 Policy deployment source

Do not edit previously applied migrations. Add a new idempotent or single-application migration that repairs all current policy gaps and records the expected manifest version. The W1-2 migrator job applies it.

`prisma/rls-policies.sql` must stop being an independent, drifting table list. It may be generated from the same manifest for disposable setup, or replaced by migration-led setup plus the catalog verifier. There must be one source for expected coverage.

`scripts/rls-fix.ts` must no longer create roles or FORCE a stale array during ordinary deployment. Role provisioning and policy changes belong to reviewed migrations or explicit one-shot administration, with catalog verification after each.

## 5. CI and catalog verification

### 5.1 Static schema guard

Run after Prisma generation:

1. Read DMMF models, mapped table names, and scalar fields.
2. Derive all direct tenant models from `organizationId`.
3. Compare with the manifest and fixture registry.
4. Reject stale entries and unreviewed exceptions.
5. Reject SQL or code references to `app.organization_id`.
6. Reject new broad empty-context policies outside approved security-definer functions.

### 5.2 Disposable database posture guard

After all migrations, connect as an administrative test owner only for catalog inspection and assert:

- every expected table exists;
- `relrowsecurity` and `relforcerowsecurity` are true;
- expected policy names and commands exist;
- `USING` and `WITH CHECK` expressions reference the canonical key or approved parent relation;
- the runtime role is NOSUPERUSER and NOBYPASSRLS;
- the runtime role cannot assume privileged roles;
- broad bootstrap policies are absent;
- protected global tables retain their specialized privilege revocations;
- function grants match the W1-2 manifest.

Then connect as the runtime role for all behavioral tests.

### 5.3 Fixture registry

Create one synthetic fixture builder for every tenant manifest entry. Each builder returns Organization A and Organization B row identities and cleanup behavior. CI fails if a new tenant model has no builder.

For each writable tenant model, the shared harness proves:

- Organization A context can create an A row;
- Organization A can read and update the A row when permitted;
- Organization B cannot read, update, or delete the A row;
- Organization B cannot insert a row carrying Organization A's ID;
- no-context runtime access sees no A row and cannot mutate it;
- direct SQL without an application `organizationId` filter is still isolated.

Where delete or update is intentionally revoked, the Organization A operation must also fail with the documented privilege contract.

### 5.4 Auth and public-route regressions

Run the W1-2 CloudVault and disposable auth matrix again after RLS repair. Add focused tests for:

- 2FA validation with signed temporary user and organization identity;
- TOTP and one-time backup code;
- session lookup and refresh;
- invited and non-invited registration;
- forgot-password, reset-password, and administrator reset;
- public link and viewer session;
- public access-request create, duplicate detection, list, approve, and deny;
- custom domain and branding;
- users with memberships in two organizations.

These route tests must use the real runtime role and real policies where practical, not only mocked Prisma clients.

## 6. CloudVault and live verification

### 6.1 CloudVault

CloudVault is the only live organization authorized for full CRUD validation. Use synthetic rooms, users, groups, links, access requests, 2FA state, and tenant rows. Record categorical results and synthetic identifiers only.

Run:

- full W1-1 authorization matrix;
- full W1-2 auth and bootstrap matrix;
- newer-table cross-tenant read and write negatives;
- page-view create and analytics read in the correct organization;
- no-context direct runtime denial;
- role and catalog posture queries.

### 6.2 Catalog evidence

After deployment, use read-only `pg_catalog` and `information_schema` queries through the approved non-customer verification path to record:

- table name;
- ENABLE and FORCE state;
- policy name and command;
- runtime role attributes;
- exact function signatures and grantees;
- manifest version or release SHA.

Do not query customer rows, counts, names, emails, document metadata, or contents. Do not print connection strings or secret values.

### 6.3 Brightside

Do not run RLS negative tests, SQL probes, access-request tests, 2FA mutation, link mutation, room enumeration, or customer-data queries against Brightside. After CloudVault is green, production verification is limited to quick uncached health plus the separately authorized minimal login, known single-room path, and logout.

## 7. Deployment sequence

W1-3 deploys only after W1-2 is complete and the web runtime is operating without the admin URL.

1. Complete static manifest and disposable catalog tests.
2. Complete all runtime-role two-organization tests.
3. Prove the W1-2 auth matrix with the repaired policies in a disposable environment.
4. Apply the RLS migration through the one-shot migrator job in CloudVault's environment.
5. Run catalog posture verification before candidate web traffic.
6. Run the CloudVault auth, authorization, access-request, 2FA, page-view, and newer-table matrix.
7. Record current production revisions, digests, and release before production mutation.
8. Apply the production migration through the same one-shot job.
9. Verify production catalog posture without querying customer rows.
10. Deploy the compatible web and worker revisions through the pipeline.
11. Verify Azure readiness and quick uncached identity health only.
12. Run CloudVault smoke first, then minimal Brightside smoke.

Policy DDL must set bounded lock and statement timeouts. If the migration cannot complete within the unannounced impact budget, stop and request a planned window.

## 8. Rollback

Application rollback alone cannot undo FORCE RLS. The implementation PR must include a reviewed, bounded rollback migration before forward deployment.

The rollback migration may only:

- restore the exact prior policy definitions for tables changed by W1-3;
- remove FORCE or RLS only from tables that lacked it before W1-3;
- restore the prior bootstrap policies only if the prior web revision requires them;
- preserve all tenant data and all unrelated policies;
- preserve provider evidence privileges and immutable audit controls.

It runs only through the one-shot migrator under incident authorization. It is not an ad hoc `psql` command and is not applied merely because one synthetic assertion is inconvenient.

Immediate response to an auth or availability incident:

1. Stop traffic movement or restore the prior compatible web revision.
2. If the prior revision remains incompatible with the new policies, execute the prepared rollback migration.
3. Confirm quick health and CloudVault auth.
4. Run the minimal Brightside smoke.
5. Record that W1-3 remains open and the security freeze remains active.

Any observed cross-organization access is an incident. Stop testing, preserve evidence, do not query additional rows, and escalate to the Advisor.

## 9. Strawman

### What if every service already filters by organization ID?

Many services use `withOrgContext()` and explicit `organizationId` filters. That is valuable, but newer tenant tables lack complete RLS posture and one existing policy uses the wrong GUC. RLS is the independent control for an omitted filter, unsafe raw query, or future route.

### What simpler control achieves most of the risk reduction?

Adding missing tables to the current hard-coded arrays would improve today's snapshot. It would drift again when the next model lands, would not prove live catalog state, and would not require a negative fixture. Schema-derived discovery plus catalog verification is the smallest durable control.

### What workflows might break?

- login and session bootstrap;
- 2FA validation;
- registration and invitation lookup;
- password reset and account-global locks;
- public link and viewer session resolution;
- public access requests;
- system or public room templates;
- notifications, dashboard, Q&A, checklist, calendar, bookmark, message, signature, webhook, and analytics paths that currently depend on missing RLS.

This is why W1-2 proof and the route regression matrix are hard prerequisites.

### Are we over-engineering for a single-room Beta?

Brightside's single-room posture limits one class of product exposure, but RLS is organization isolation across all tenant data, not merely room isolation. The schema already contains many multi-tenant feature tables. The guard prevents future schema drift at low marginal cost.

## 10. Steelman

### Blast radius if unfixed

Any route using a newer table without an explicit organization predicate can read or write across organizations under the normal runtime role. Missing FORCE can also allow a table owner to bypass a present policy. The stale audit can report a reassuring partial result.

### Defense-in-depth failure

Application authorization, RLS, and database privilege separation are meant to be independent. Current gaps allow one application mistake to combine with missing table policy, while the open W1-2 issue gives the public web process an elevated fallback.

### Contract alignment

The design enforces the canonical session-derived tenant context, constrained runtime role, FORCE RLS, default deny, and CI-backed tenant isolation. It also narrows identity bootstrap instead of treating an empty GUC as a trusted state.

### Cost of delay versus careful change

The table count and route surface make this a high-breakage change. Delaying after W1-2 leaves known policy gaps. Applying it before W1-2 risks bricking login and public workflows. The selected order minimizes both risks.

## 11. Pre-Mortem

Assume W1-3 caused an incident.

### Failure: login and 2FA fail after FORCE RLS

Likely cause: a route still uses direct no-context Prisma access, a bootstrap function grant is missing, or the signed 2FA token lacks organization binding.

Detection within five minutes:

- disposable real-role auth matrix;
- CloudVault candidate login and 2FA smoke;
- categorical route errors without sensitive logging.

Rollback:

- restore the prior revision;
- run the prepared policy rollback only if needed for compatibility;
- do not re-grant broad user-table SELECT as an emergency shortcut.

### Failure: access-request or link workflows return 500

Likely cause: newer tables are now protected but the public bootstrap write still uses direct Prisma access.

Detection:

- CloudVault synthetic public access request and link matrix;
- no-context negative tests paired with approved function-positive tests.

Rollback:

- restore the prior revision and prior policies through the reviewed path;
- keep customer traffic away from the synthetic route until fixed.

### Failure: migration blocks production writes

Likely cause: FORCE or policy DDL waits on a long transaction.

Detection:

- lock timeout, statement timeout, job duration, and Azure job state;
- deployment stops before traffic movement.

Rollback:

- let the bounded transaction fail and roll back;
- do not retry repeatedly;
- request a planned window if safe application requires more than five minutes.

### Failure: a new policy allows cross-tenant inserts

Likely cause: `USING` was added without a correct `WITH CHECK`, or a nullable/system branch is too broad.

Detection:

- per-model Organization B insertion of Organization A identity;
- disposable catalog expression inspection;
- CloudVault synthetic negative tests.

Rollback:

- stop the deployment and preserve evidence;
- run the reviewed rollback migration if already applied;
- escalate any actual live cross-organization evidence immediately.

### Failure: CI is green but a table remains uncovered

Likely cause: the guard parses a stale text list, ignores mapped table names, or has an unchecked exception.

Detection:

- DMMF-derived model discovery;
- disposable catalog comparison;
- mandatory fixture registry;
- live non-customer catalog evidence.

Rollback or mitigation:

- do not declare W1-3 complete;
- add the model, policy, FORCE state, and fixture before another deploy.

### False confidence from green tests

An app-role query can pass because fixtures omitted a table, because the admin client performed assertions, or because explicit application filters hide an absent policy. The acceptance suite must deliberately omit application filters, use the actual runtime role, inspect FORCE state, and require a fixture for every manifest entry.

### Silent-hardening behavior change

Previously successful routes may return empty data or 500 when RLS begins enforcing missing context. Brightside may see this as a broken product. CloudVault must exercise the full route matrix first, and the prior revision plus prepared policy rollback must fit the five-minute budget.

## 12. Go or no-go

**GO for Advisor review of this design.**

**NO-GO for implementation.** Implementation requires a written W1-3 Advisor GO that accepts the schema-derived manifest, the direct-model no-exception preference, removal of broad bootstrap policies after W1-2 proof, the prepared policy rollback migration, and the CloudVault plus catalog verification plan.

W1-2 must be proven before W1-3 enforcement reaches production. The security freeze remains active. P0-4 remains accepted and unchanged.

## References

- `CANONICAL_CONTRACTS.md`
- `PERMISSION_MODEL.md`
- `prisma/schema.prisma`
- `prisma/rls-policies.sql`
- `prisma/migrations/20260402110000_add_page_views_ip_allowlist/migration.sql`
- `prisma/migrations/20260402130500_add_webhooks/migration.sql`
- `scripts/rls-audit.ts`
- `scripts/rls-fix.ts`
- `scripts/setup-rls-test-db.ts`
- `tests/integration/rls.test.ts`
- `src/lib/db.ts`
- `src/app/api/auth/2fa/validate/route.ts`
- `src/app/api/rooms/public/request-access/route.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-staging.yml`
