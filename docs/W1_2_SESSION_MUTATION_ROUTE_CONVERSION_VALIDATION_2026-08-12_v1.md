# W1-2 Session Mutation Route Conversion Validation

- **Date:** 2026-08-12
- **Advisor authorization:** ADV-2026-08-12-03
- **Evidence version:** 1
- **Starting main:** `b3694487169336303592a18d20afda9e250494d6`
- **Branch:** `agent/w1-2-session-mutation-route-conversion-v1`
- **Scope:** Session create, sliding refresh, and exact-token invalidate
- **Production status:** Unchanged by this validation

## 1. Result

Local validation is green for the accelerated Unit 8 implementation. The application role receives
only the three new narrow session-mutation capabilities in addition to the three previously routed
resolve capabilities. The two caller-selected bulk-revoke functions remain owner-only and
unrouted.

The implementation converts all four production session-creation call sites, the throttled
activity-refresh path, and exact-token logout invalidation. No converted path contains a direct
session table mutation or administrative database fallback.

## 2. Exact runtime ACL transition

The disposable PostgreSQL proofs produced this exact application-role execution set:

1. `bootstrap_login_candidate_v1(text)`;
2. `bootstrap_organization_resolve_v1(text, text)`;
3. `bootstrap_session_create_v1(text, text, text, timestamptz, text, text)`;
4. `bootstrap_session_invalidate_v1(text)`;
5. `bootstrap_session_refresh_v1(text)`; and
6. `bootstrap_session_resolve_v1(text)`.

The application role has no execution privilege on:

- `bootstrap_session_revoke_user_org_v1(text, text)`; or
- `bootstrap_session_revoke_user_global_v1(text, text)`.

`PUBLIC` has no execution privilege on any bootstrap function. The owner remains `NOLOGIN`,
`NOINHERIT`, `NOSUPERUSER`, and `NOBYPASSRLS`. The application role cannot reach the owner, and no
owner membership remains after migration.

## 3. Source and route validation

Static validation proved:

- no production `db.session.create`, `bootstrapDb.session.create`, or `tx.session.create` call;
- no production direct session update on the converted create, refresh, or exact-token invalidate
  paths;
- no production `bootstrapDb.session` reference;
- no live import or call of either generic bulk-revoke repository method;
- no grant of either bulk-revoke function in the Unit 8 migration;
- the login, 2FA completion, registration, and initial setup routes use the shared constrained
  session-creation helper;
- `validateSession` refreshes through the mutation repository only after authoritative live
  resolution;
- logout resolves audit context through the already-routed resolver and invalidates through the
  exact-token mutation function; and
- Redis remains an accelerator, with targeted eviction after refresh and invalidate.

The existing bulk session revocation helpers remain transaction-local and unchanged for password,
identity, membership, and account-lifecycle operations.

## 4. Automated validation

| Gate                                       | Result                                                  |
| ------------------------------------------ | ------------------------------------------------------- |
| Focused Unit 8 and route tests             | 73 passed across 8 files                                |
| Full unit and component suite              | 1,373 passed, 7 skipped, 146 files passed and 1 skipped |
| Full RLS integration suite                 | 78 passed across 8 files                                |
| Unit 8 real-role PostgreSQL mutation suite | 9 passed                                                |
| TypeScript                                 | Passed                                                  |
| ESLint                                     | Passed with one pre-existing unrelated hook warning     |
| Repository-wide Prettier check             | Passed                                                  |
| `git diff --check`                         | Passed                                                  |
| Production Next.js build                   | Passed                                                  |
| Acceptance runner syntax check             | Passed                                                  |

The RLS suite initially identified one historical Unit 6 static assertion that required the old
administrative refresh implementation to remain in `session.ts`. The assertion was updated to
retain its valid security boundary, proving generic caller-selected bulk mutations remain on their
established paths and are not routed through the bulk repository methods. The focused suite and
the complete 1,373-test suite passed after that correction.

## 5. Fresh-database migration proof

Disposable PostgreSQL 15 container `vaultspace-w1-2-session-mutation-route-v2` was used on local
port 56438.

- All 48 migrations applied from an empty database.
- Unit 8 migration completed successfully.
- RLS test-role setup installed and verified the exact six-function runtime matrix.
- Runtime create, refresh, and exact-token invalidate succeeded through the application role.
- Runtime execution of both bulk-revoke functions was denied.
- Active user, membership, and organization checks remained fail closed.
- Refresh throttle, idle expiry, absolute expiry, hostile inputs, and idempotent invalidate passed.

## 6. Azure-like constrained-migrator proof

Disposable PostgreSQL 15 container `vaultspace-w1-2-session-mutation-route-azure-v1` was used on
local port 57438.

The database owner and migrator had `LOGIN`, `CREATEDB`, and `CREATEROLE`, but did not have
`SUPERUSER`, `BYPASSRLS`, or replication. All 48 migrations first applied while the runtime role was
absent, exercising the safe migration return path. The runtime role was then created, the prior
three grants were established, and the Unit 8 migration was executed by the constrained migrator.

The resulting catalog matched the reviewed contract:

- exact six-function application execution set;
- both bulk functions owner-only;
- all eight functions denied to `PUBLIC`;
- owner role posture unchanged;
- owner table-level `INSERT`, `UPDATE`, and `DELETE` absent on sessions;
- reviewed column-scoped writes retained; and
- zero residual owner memberships.

The final migration review added explicit pre-transition and post-transition rejection of any
`PUBLIC` execution on every `bootstrap_*` function. The revised migration was then applied from a
fresh 48-migration chain and through a constrained-migrator clone. The exact catalog matrix and all
nine real-role mutation tests remained green.

## 7. Production acceptance runner

`scripts/cloudvault-w1-2-session-mutation-route-acceptance-v1.cjs` is included but has not been run.
It is reserved for the separately controlled Unit 8 deployment and requires an exact HTTPS target,
the retained CloudVault slug, an exact full release SHA, and the administrative fixture connection.
It never prints secret values.

The runner checks:

1. exact release health and Azure mode;
2. migration completion, owner posture, function checksums, exact six-function application ACL,
   owner-only bulk revoke, and `PUBLIC` denial;
3. login-created session identity and metadata;
4. `/api/auth/me` and protected shell resolution;
5. the approved CloudVault public organization projection;
6. safe synthetic sliding refresh with authoritative database advancement;
7. logout exact-token invalidation and post-logout cache denial;
8. neutral unknown-token denial; and
9. synthetic session, membership, and user soft cleanup while retaining CloudVault.

The Brightside minimal smoke remains an operator step after CloudVault is green because it uses an
existing authorized customer-visible path and must preserve the established privacy boundary.

## 8. Retained disposable resources

No local container was deleted. The following Unit 8 containers are retained pending a separate
cleanup authorization:

| Container                                         | State   | Purpose                                                  |
| ------------------------------------------------- | ------- | -------------------------------------------------------- |
| `vaultspace-w1-2-session-mutation-route-v1`       | Exited  | Initial port-proxy warm-up attempt; no migration applied |
| `vaultspace-w1-2-session-mutation-route-v2`       | Running | Fresh database and full RLS validation                   |
| `vaultspace-w1-2-session-mutation-route-azure-v1` | Running | Azure-like constrained-migrator validation               |

## 9. Control status

- `DATABASE_URL_ADMIN` remains present.
- W1-3 is not started.
- P0-4 is unchanged.
- Production execution remains the prior three-function matrix until a controlled Unit 8 deploy.
- The deployment workflow remains active and unchanged.
- No merge or deployment is authorized by this validation record.

## 10. Status

**LOCAL VALIDATION GREEN. DRAFT PR AND EXACT-HEAD CI ARE THE NEXT AUTHORIZED CHECKPOINT.**
