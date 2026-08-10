# W1-3 Schema-Driven RLS Design

- **Status:** DESIGN ONLY, awaiting Stakeholder Advisor GO
- **Freeze scope:** P0-3 tenant-isolation assurance
- **Implementation authorization:** Not granted by this document

## Decision summary

RLS coverage will be derived from the Prisma schema and verified against a migrated disposable PostgreSQL database in CI. Every model with an `organizationId` field must map to a table with RLS enabled, FORCE RLS enabled, and an approved policy, or appear in a small explicit exception registry with rationale, owner, and negative tests.

The page-view GUC will be corrected from `app.organization_id` to `app.current_org_id`. The broad no-context user lookup will be replaced by the narrow W1-2 bootstrap surface before the public web admin URL is removed. Correct RLS must not ship until 2FA, access-request, session, invitation, registration, password-reset, and viewer-bootstrap paths pass with the runtime role.

## Current-state observations

1. `scripts/rls-audit.ts` uses a stale hard-coded list of 19 expected tables, including a nonexistent `watermark_configs` table.
2. The Prisma schema currently has 35 models with an `organizationId` field.
3. The central `prisma/rls-policies.sql` directly enables and forces RLS for only 15 of those 35 mapped tables.
4. The central file also covers `organizations`, `users`, and indirect `group_memberships`, which need special membership or parent policies even though those models do not carry a direct `organizationId` field.
5. `page_views` and `webhooks` received migration-level RLS policies, but they are absent from the central policy and audit inventories.
6. The `page_views` migration uses `app.organization_id`; application transactions set `app.current_org_id`.
7. Neither the page-view nor webhook migration applies FORCE RLS.
8. The no-context `user_bootstrap_lookup` row policy permits every user row when `app.current_org_id` is unset. PostgreSQL row policies cannot restrict columns, so normal table SELECT privileges can expose password hashes and TOTP fields to the runtime role.
9. The 2FA continuation performs pre-context reads and writes through the normal database client.
10. Access-request routes already use `withOrgContext()`, but the `access_requests` table is absent from the central RLS policy file. Correctly forcing RLS may expose untested query assumptions.
11. Sessions and password-reset tokens have nullable `organizationId` fields and need explicit bootstrap treatment rather than a generic equality policy.
12. Migrations and policy application currently occur in more than one place. W1-2 must establish the one-shot migrator before W1-3 removes bootstrap policies or applies aggressive FORCE RLS.

## Prisma tenant-model inventory

The following models currently contain `organizationId`:

| Prisma model           | Table                      | Field    | Current central policy posture               |
| ---------------------- | -------------------------- | -------- | -------------------------------------------- |
| UserOrganization       | `user_organizations`       | required | Covered and forced                           |
| Session                | `sessions`                 | nullable | Missing, bootstrap exception required        |
| Room                   | `rooms`                    | required | Covered and forced                           |
| Folder                 | `folders`                  | required | Covered and forced                           |
| Document               | `documents`                | required | Covered and forced                           |
| DocumentVersion        | `document_versions`        | required | Covered and forced                           |
| FileBlob               | `file_blobs`               | required | Covered and forced                           |
| PreviewAsset           | `preview_assets`           | required | Covered and forced                           |
| ExtractedText          | `extracted_texts`          | required | Covered and forced                           |
| SearchIndex            | `search_indexes`           | required | Covered and forced                           |
| Link                   | `links`                    | required | Covered and forced                           |
| LinkVisit              | `link_visits`              | required | Missing                                      |
| ViewSession            | `view_sessions`            | required | Covered and forced                           |
| Permission             | `permissions`              | required | Covered and forced                           |
| RoleAssignment         | `role_assignments`         | required | Missing                                      |
| Group                  | `groups`                   | required | Covered and forced                           |
| Event                  | `events`                   | required | Covered and forced                           |
| RoomTemplate           | `room_templates`           | required | Missing                                      |
| Notification           | `notifications`            | required | Missing                                      |
| NotificationPreference | `notification_preferences` | required | Missing                                      |
| Invitation             | `invitations`              | required | Covered and forced                           |
| PasswordResetToken     | `password_reset_tokens`    | nullable | Missing, bootstrap exception required        |
| Question               | `questions`                | required | Missing                                      |
| Answer                 | `answers`                  | required | Missing                                      |
| Checklist              | `checklists`               | required | Missing                                      |
| ChecklistItem          | `checklist_items`          | required | Missing                                      |
| CalendarEvent          | `calendar_events`          | required | Missing                                      |
| Bookmark               | `bookmarks`                | required | Missing                                      |
| AccessRequest          | `access_requests`          | required | Missing                                      |
| NotificationTemplate   | `notification_templates`   | required | Missing                                      |
| Message                | `messages`                 | required | Missing                                      |
| PageView               | `page_views`               | required | Migration-only policy, wrong GUC, not forced |
| SignatureRequest       | `signature_requests`       | required | Missing                                      |
| Webhook                | `webhooks`                 | required | Migration-only policy, not forced            |
| UserDashboardLayout    | `user_dashboard_layouts`   | required | Missing                                      |

Special tenant-bearing tables without a direct `organizationId` field:

- `organizations`: membership-scoped and bootstrap-resolvable.
- `users`: membership-scoped and bootstrap-resolvable, with sensitive-column constraints handled through W1-2.
- `group_memberships`: tenant determined through the parent group.
- provider inbox and password-reset recovery or correlation tables: capability-specific database grants and existing isolation contracts, not generic tenant-table access.

The inventory above is design evidence, not a substitute for generated CI inventory. Model additions must be discovered automatically.

## Schema-driven inventory mechanism

Add a CI tool that reads Prisma DMMF from the checked-in schema and emits:

- Prisma model name;
- mapped PostgreSQL table name from `@@map`;
- whether `organizationId` exists and is nullable;
- relevant relation path for approved indirect tenant tables; and
- exception identifier if present.

Use the Prisma version pinned by the repository. If stable DMMF access requires an explicit development dependency, pin it to the same Prisma version rather than relying on an incidental transitive package.

Maintain a small reviewed exception registry in source control. Every entry must include:

- table;
- reason a generic organization equality policy is unsafe or impossible;
- allowed role or function surface;
- negative test name;
- owner; and
- expiry or review condition.

CI fails when:

- a new `organizationId` model lacks RLS coverage or an exception;
- an exception refers to a removed model;
- a mapped table lacks `relrowsecurity`;
- a non-exempt table lacks `relforcerowsecurity`;
- no policy exists for the runtime role;
- policy expressions use an unapproved GUC;
- the runtime role owns a tenant table, is superuser, or has BYPASSRLS; or
- broad user-table bootstrap access is present after W1-2 cutover.

## Policy contract

### Standard required-organization tables

For a table whose `organizationId` is required:

```sql
USING ("organizationId" = current_setting('app.current_org_id', true))
WITH CHECK ("organizationId" = current_setting('app.current_org_id', true))
```

Apply both ENABLE and FORCE RLS. Use command-specific policies only where immutable or append-only behavior requires narrower grants.

### Indirect tenant tables

`group_memberships` must resolve the parent group's organization. Similar future indirect tables require a documented relation expression and cross-tenant insert test.

### Organizations and users

Ordinary runtime access must require active membership under `app.current_org_id`.

No-context table-wide policies will be removed after the W1-2 bootstrap functions are deployed and proven. Bootstrap functions return fixed columns and at most one logical record; the runtime role cannot directly select password hashes, TOTP secrets, backup codes, or unrelated users with no tenant context.

### Sessions

Session tokens are pre-tenant credentials. Generic no-context SELECT on `sessions` is not acceptable.

Use a narrow W1-2 bootstrap function to resolve one active session token into minimal user and organization identity. Session mutation by token or session ID must be performed through narrow functions or after organization context is established. Nullable legacy sessions are denied to normal runtime access and handled through a documented cleanup or exception path.

### Password reset

Password-reset tokens are pre-tenant credentials and some historical rows have nullable `organizationId`. Preserve the existing recovery and provider-correlation isolation contracts.

Token issue, claim, consume, supersede, and recovery operations must use narrow W1-2 functions with concurrency tests. Do not expose generic token-table reads to the app role.

### Page views and webhooks

- Recreate the page-view policy using `app.current_org_id`.
- Apply FORCE RLS to `page_views` and `webhooks`.
- Add both tables to the generated coverage and disposable negative tests.
- Verify page-view insert and aggregate queries still work inside `withOrgContext()`.

## Migration source of truth

RLS changes must be delivered through reviewed Prisma migrations owned by the W1-2 migrator job. The web startup must not replay a mutable policy script on every replica.

`prisma/rls-policies.sql` may remain as a generated or bootstrap artifact, but CI must prove it matches the migration-derived target posture. A stale hand-maintained list cannot be the only source of truth.

The migration should be idempotent only where rerunning is an explicit requirement. Normal Prisma migration history remains the evidence boundary.

## Test plan

### Coverage guard

- Generate the 35-model inventory from Prisma.
- Migrate a disposable PostgreSQL database.
- Query `pg_class`, `pg_namespace`, `pg_policy`, `pg_roles`, and grants.
- Fail on missing ENABLE RLS, FORCE RLS, policy, approved GUC, or exception.

### Two-organization runtime-role negative tests

Populate every tenant-bearing model with synthetic rows in Org A and Org B using the admin fixture connection. Then connect as the NOBYPASSRLS runtime role and prove for each standard table:

- no context returns no rows and rejects writes;
- Org A context returns only Org A rows;
- Org A context cannot select an Org B row by known ID;
- Org A context cannot insert an Org B `organizationId`;
- Org A context cannot update a row into Org B;
- Org A context cannot delete an Org B row; and
- Org B context has the symmetric behavior.

The test harness must cover newer tables explicitly, including access requests, messages, page views, webhooks, notifications, dashboard layouts, signatures, questions, checklists, calendars, bookmarks, room templates, link visits, and role assignments.

### Auth and bootstrap regressions

- Password login works only through the W1-2 narrow bootstrap path.
- Unknown-user response does not reveal existence.
- 2FA TOTP and backup-code continuation work with the selected organization context.
- Session validation, refresh, logout, and revocation work without direct broad session access.
- Registration and invitation acceptance work without no-context user-table SELECT.
- Forgot and reset password work through narrow token operations.
- Access-request list and review work under organization context and deny cross-tenant IDs.
- Public link and viewer-session bootstrap work through the centralized W1-1 link evaluator.
- Normal client cannot select password hashes, TOTP secrets, backup codes, or unrelated user rows with no organization context.

### Live verification after deployment

Use `pg_catalog` only and do not query Brightside rows. Record:

- runtime role name and NOBYPASSRLS status;
- table RLS and FORCE flags;
- policy names and commands;
- approved GUC expressions; and
- deployed migration version.

CloudSpace and synthetic fixtures own behavioral verification.

## Sequencing with W1-2

W1-2 bootstrap functions and the migrator job must be deployed before W1-3 removes broad bootstrap policies or forces RLS on tables used by pre-context auth paths.

Safe sequence:

1. Add schema-driven coverage reporting in CI without changing live policies.
2. Deploy W1-2 bootstrap replacement while current policies remain compatible.
3. Prove the CloudSpace auth matrix.
4. Add policies and FORCE RLS in small table families through the migrator.
5. Remove broad no-context user policies.
6. Run runtime-role negative tests and pg_catalog verification.

If a table family breaks a route, stop before the next family and use the prepared policy rollback migration or forward repair.

## Rollout and rollback

Before deployment, record current release, revisions, image digests, migration version, policy inventory, and role flags.

Detection within five minutes:

- one-shot migrator result;
- pg_catalog posture check;
- quick health only;
- CloudSpace login, session, 2FA, room access, access-request, link, and logout checks;
- route error-rate monitoring; and
- runtime-role negative probes against synthetic fixtures.

Rollback requires both application and policy preparation:

1. Retain the prior web and worker revisions.
2. Keep migrations backward-compatible with the prior application until smoke is green.
3. Prepare a reviewed forward rollback migration for any policy family whose stricter policy can brick the previous application.
4. Route traffic back only after the database posture is compatible with the prior revision.
5. Do not disable all RLS as a generic rollback.

## Strawman

- Applying FORCE RLS to every `organizationId` model can be over-broad for sessions and password-reset tokens that exist before organization context.
- A schema-driven guard can create the appearance of completeness while policies are logically wrong.
- The simplest 80 percent control is to add the obvious missing tables and fix the page-view GUC without introducing DMMF tooling.
- Some tables may already be protected by application joins or capability-specific grants, making a generic policy redundant.
- Rolling many table families into one migration increases outage and rollback risk.

## Steelman

- New tenant models have already drifted beyond the hard-coded RLS list. Manual inventory has failed as a control.
- App authorization and the constrained role cannot contain cross-tenant SQL if a tenant table has no effective RLS.
- The wrong page-view GUC is direct evidence that policy and application contracts have diverged.
- The public web still holds an admin URL, so complete RLS is a necessary independent defense even after W1-2 removes that URL.
- CI must fail at the schema-change moment, not after a later security review discovers an uncovered table.

## Pre-Mortem

Assume this change caused an incident:

- FORCE RLS blocks 2FA login because the continuation has no organization context.
- Session validation cannot resolve the session token, logging out every user.
- Access-request or notification pages return 500 because their queries omit `withOrgContext()`.
- A page-view policy is fixed for inserts but breaks analytics reads that use a different transaction path.
- A policy permits SELECT but lacks `WITH CHECK`, allowing cross-tenant inserts or organization reassignment.
- The runtime role owns a table, so FORCE or owner behavior differs from CI.
- A generated inventory misses a mapped table because of parser drift.
- Green table-count checks miss sensitive columns exposed through the broad user bootstrap policy.
- A single large migration exceeds the five-minute budget and application rollback cannot undo the policy posture.

Detection within five minutes:

- CloudSpace full auth and route matrix;
- per-table synthetic negative tests;
- pg_catalog ENABLE and FORCE assertions;
- policy-expression and grant inspection;
- application error-rate comparison; and
- explicit password and TOTP column-denial tests.

Rollback:

- policy changes are split by table family;
- each family has a tested forward rollback migration;
- prior application revisions remain available;
- the migrator serializes DDL; and
- global RLS disable is forbidden as a routine recovery action.

False confidence controls:

- Generated inventory proves coverage existence, not policy correctness.
- Same-tenant positive tests do not prove cross-tenant denial.
- SELECT denial does not prove INSERT, UPDATE, and DELETE denial.
- Admin-connection tests do not exercise runtime enforcement.
- pg_catalog posture does not prove 2FA, reset, session, access-request, or link workflows remain operational.

Silent-hardening risk:

- Brightside may experience login or room failures without understanding that a security control changed. CloudSpace and synthetic coverage must precede production traffic, and rollback must remain within five minutes.

## Go or no-go recommendation

**Recommendation:** GO for implementation only after W1-2 bootstrap replacement design is approved and the CloudSpace auth matrix is available.

Required before coding:

1. Approve the 35-model inventory and the explicit treatment of nullable session and password-reset tables.
2. Approve DMMF-based CI inventory and the exception-registry format.
3. Approve migration families rather than one all-table policy migration.
4. Approve the requirement that no-context broad user SELECT is removed only after W1-2 is proven.

## References

- `prisma/schema.prisma`
- `prisma/rls-policies.sql`
- `prisma/migrations/20260402110000_add_page_views_ip_allowlist/migration.sql`
- `prisma/migrations/20260402130500_add_webhooks/migration.sql`
- `scripts/rls-audit.ts`
- `scripts/setup-rls-test-db.ts`
- `tests/integration/rls.test.ts`
- `tests/integration/auth-me-rls.test.ts`
- `tests/integration/auth-account-routes-rls.test.ts`
- `src/lib/db.ts`
- `src/lib/auth/session.ts`
- `src/app/api/auth/2fa/validate/route.ts`
- `src/app/api/rooms/[roomId]/access-requests/route.ts`
- `src/lib/rls-startup-guard.ts`
