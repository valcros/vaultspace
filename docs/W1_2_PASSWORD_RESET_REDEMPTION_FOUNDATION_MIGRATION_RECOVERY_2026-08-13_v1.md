# W1-2 Unit 10 Password Reset Foundation Migration Recovery

Date: 2026-08-13

Authorization: ADV-2026-08-13-08

## Incident

Controlled staging deploy run `31723999076` attempted release
`c81a4227e0b091cfd4cc8d046d48f820784c6b05`. Prisma started migration
`20260813150000_w1_2_password_reset_redemption_foundation` and surfaced only:

```text
ERROR: current transaction is aborted, commands ignored until end of transaction block
```

The migration transaction rolled back with zero applied steps. No Container App mutation began.
Unit 9 release `404c9f949bc4d24973ecf1290f99ff640c422dd3` remained healthy on web revision
`ca-vaultspace-web--0000299` and worker revision `ca-vaultspace-worker--0000282`.

## Exact reproduction

A disposable PostgreSQL `15.18` environment reproduced the staging catalog and role boundary:

- database and application tables owned by `vaultspaceadmin`;
- `public` schema owned by `azure_pg_admin`;
- `vaultspaceadmin` modeled as a non-superuser member of `azure_pg_admin` with `BYPASSRLS`,
  `CREATEDB`, and `CREATEROLE`;
- `vaultspace_app` modeled as the ordinary login role with no bypass or role-management power;
- `vaultspace_bootstrap_owner` modeled as `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, and
  `NOBYPASSRLS`;
- staging schema, policies, function ownership, and ACLs cloned without application data;
- the exact 49 successful Prisma migration records copied before Unit 10.

Results:

1. Direct `psql` execution as `vaultspaceadmin` passed.
2. The real `npm run db:migrate` wrapper as `vaultspaceadmin` passed.
3. The real wrapper as `vaultspace_app` reproduced the exact secondary staging error.
4. `psql -v ON_ERROR_STOP=1` as `vaultspace_app` exposed the primary failure:
   `BOOTSTRAP_OWNER_TABLE_PRIVILEGES_INVALID` in the first preflight block.

The staging deploy workflow supplied `MIGRATION_DATABASE_URL` from the generic
`secrets.DATABASE_URL` binding. The correction requires a dedicated
`secrets.MIGRATION_DATABASE_URL` credential contract.

## Corrective contract

1. Staging migration execution reads only `secrets.MIGRATION_DATABASE_URL`.
2. The workflow must not map migrations from `secrets.DATABASE_URL`.
3. The Unit 10 migration rejects a session whose current role is exactly `vaultspace_app` with
   `BOOTSTRAP_MIGRATION_RUNTIME_CREDENTIAL_FORBIDDEN`.
4. The read-only role and catalog preflight executes before `BEGIN` so credential failures retain
   their primary categorical error.
5. All grants, policies, functions, comments, ownership transfers, and final catalog checks remain
   inside one explicit transaction.
6. The corrected migration continues to grant zero password-reset function execution to
   `vaultspace_app` and `PUBLIC`.

## Validation

- corrected runtime-credential failure through the real Prisma wrapper: categorical
  `BOOTSTRAP_MIGRATION_RUNTIME_CREDENTIAL_FORBIDDEN`, with no secondary aborted-transaction
  masking;
- corrected migration through the real Prisma wrapper under the Azure-like non-superuser
  migration identity: PASS;
- complete 50-migration chain under PostgreSQL `15.18`: PASS;
- Unit 10 production-like staging-clone capability checks: 9/9 PASS;
- RLS integration suite: 94/94 PASS across 9 files;
- deployment workflow contract suite: 61/61 PASS;
- application unit suite: 1,385 PASS, 7 skipped across 148 files;
- TypeScript type check: PASS;
- ESLint: PASS with 0 errors and 1 pre-existing warning;
- Prisma schema validation: PASS;
- production Next.js build: PASS.

## Operational prerequisites

The corrective PR does not create or modify credential state. Before a new deployment:

1. Obtain explicit credential-write confirmation.
2. Provision repository or staging-environment secret `MIGRATION_DATABASE_URL` with the reviewed
   migration-owner connection. Never put its value in source, logs, evidence, or PR text.
3. Confirm the secret connects as the reviewed non-runtime migration identity.
4. Under the approved deployment ceremony, mark the failed staging record rolled back with:

   ```text
   npx prisma migrate resolve --rolled-back 20260813150000_w1_2_password_reset_redemption_foundation
   ```

5. Issue no deploy until exact-main CI and image publication are green.
6. Use exactly one newly authorized staging dispatch.

## Explicit exclusions

- no manual staging DDL;
- no broad application grant;
- no Unit 10 route conversion;
- no `DATABASE_URL_ADMIN` removal;
- no W1-3 or P0-4 change;
- no retry under ADV-2026-08-13-08.
