# W1-2 Unit 10 Password Reset Foundation DDL Collation Recovery

Date: 2026-08-13

Authorization: ADV-2026-08-13-10

## Incident

Controlled staging deployment run `31731399089` attempted corrected main release
`733c470298f3ea942753ba8864ceaf7ddfbaf065`. The dedicated migration credential authenticated
as `vaultspaceadmin`, and the read-only role and catalog preflight passed. Prisma then reported
only the secondary aborted-transaction error while applying
`20260813150000_w1_2_password_reset_redemption_foundation`.

The deployment stopped before any Container App or job mutation. Live staging remained healthy on
Unit 9 release `404c9f949bc4d24973ecf1290f99ff640c422dd3`, web revision
`ca-vaultspace-web--0000299`, and worker revision `ca-vaultspace-worker--0000282`.

## Rollback-only diagnostic

The reviewed migration was streamed to `psql -v ON_ERROR_STOP=1` under `vaultspaceadmin` with these
invariants:

- the source and diagnostic stream matched the exact main migration blob;
- the stream contained exactly one DDL `BEGIN`;
- the terminal `COMMIT` was replaced in memory by an explicit `ROLLBACK`;
- the stream contained no `COMMIT`;
- connection termination after an error also guaranteed transaction rollback;
- no migration bookkeeping command was executed.

The statement-level diagnostic exposed the primary categorical failure:

```text
BOOTSTRAP_RUNTIME_RESET_PRIVILEGES_CHANGED
```

Post-diagnostic catalog checks proved that both Unit 10 functions and all five Unit 10 policies
remained absent, and that the bootstrap owner retained zero membership rows.

## Root cause

The temporary prestate table and the current `information_schema` expression each contained the
same 152 exact `vaultspace_app` ACL keys. Set-difference queries returned zero added rows and zero
missing rows.

The final assertion nevertheless compared unequal arrays because the two unqualified
`ORDER BY acl_key` expressions inherited different collations:

- the temporary-table text key used the database `en_US.utf8` collation;
- the identifier-derived `information_schema` expression used `C` ordering.

Mixed-case column identifiers made the order divergence observable. Examples included
`cipherVersion`, `ciphertext`, `provider`, and `providerAcceptedAt`. The privilege set did not
change. Only the array order differed.

## Correction

Both exact ACL arrays now use the same deterministic ordering expression:

```sql
ORDER BY acl_key COLLATE pg_catalog."C"
```

The comparison remains fail-closed and continues to detect every added, removed, or modified ACL
key. It no longer treats an implicit-collation ordering difference as privilege drift.

A focused source contract requires exactly two explicitly `C`-collated ACL aggregations and rejects
the former implicit-order expression.

## Staging proof of correction

The corrected migration was streamed through the same rollback-only staging diagnostic. Every
grant, policy, function, ownership, checksum, ACL, and runtime-matrix assertion completed, followed
by the explicit terminal result:

```text
DO
DO
ROLLBACK
```

Follow-up catalog checks again proved:

- zero persisted Unit 10 functions;
- zero persisted Unit 10 policies;
- zero residual bootstrap-owner memberships;
- no Container App, job, environment, or traffic mutation.

## Corrective validation

- real migration wrapper under the Azure-like PostgreSQL 15.18 non-superuser identity: PASS;
- complete 50-migration chain: PASS;
- focused Unit 10 production-like capability suite: 9/9 PASS;
- RLS integration suite: 94/94 PASS across nine files;
- application unit suite: 1,385 PASS and 7 skipped across 148 files;
- TypeScript type check: PASS;
- ESLint: PASS with zero errors and one pre-existing warning;
- Prisma schema validation: PASS;
- production Next.js build: PASS;
- Advisor-authorized diagnostic container cleanup: COMPLETE.

## Operational posture

- Deploy workflow `251547585` remains `disabled_manually`.
- The second failed Prisma row remains unresolved with zero applied steps.
- The dedicated staging `MIGRATION_DATABASE_URL` secret remains present and masked.
- No corrective merge or deployment is authorized under ADV-2026-08-13-10.
- A separate Advisor approval is required before migration resolution, merge, workflow enablement,
  or a new staging dispatch.
