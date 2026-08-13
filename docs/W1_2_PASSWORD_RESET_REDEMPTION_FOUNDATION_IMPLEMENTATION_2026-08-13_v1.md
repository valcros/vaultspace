# W1-2 Password Reset Redemption Foundation Implementation

- **Date:** 2026-08-13
- **Advisor authorization:** ADV-2026-08-13-06
- **Implementation version:** 1
- **Unit:** W1-2 Unit 10 password-reset redemption foundation
- **Draft PR:** #145
- **Starting branch head:** `680028993ee4a62be828ae23f7daa1bb2a44b73d`
- **Security freeze:** Active
- **Runtime route conversion:** Not included

## 1. Outcome

Unit 10 now has an inert, two-function password-reset redemption foundation:

1. `bootstrap_password_reset_candidate_v1(text)` returns only a positive eligibility marker or no
   row.
2. `bootstrap_password_reset_redeem_v1(text, text)` derives the subject from the stored reset row,
   takes the account-global advisory lock, repeats authorization under deterministic row locks,
   consumes one credential, updates the derived password, supersedes other reset flows, wipes
   recovery material, and revokes the derived subject's sessions.

Both procedures are owned only by `vaultspace_bootstrap_owner`. `PUBLIC` and `vaultspace_app` have
no execution privilege. The live reset route has not been changed and the runtime execution matrix
remains the nine Unit 9 functions.

## 2. Implemented scope

### 2.1 Migration

The additive migration:

- validates the exact Unit 9 owner posture and nine-function runtime matrix before changing state;
- requires the reviewed direct runtime reset-table residual to be exactly `SELECT`, `INSERT`,
  `UPDATE`, and `DELETE` on reset tokens and recoveries;
- snapshots that residual and proves it is unchanged before commit;
- grants the no-login owner only the required reset selector, lifecycle, password, and row-lock
  columns;
- gives the owner no table-level write privilege on users, reset tokens, recoveries, or sessions;
- adds owner-only active-user and active-organization SELECT policies so caller transaction context
  cannot suppress account-global resolution;
- adds owner-only UPDATE policies and one harmless update column on users, memberships, and
  organizations solely for deterministic `FOR UPDATE` locks under forced RLS;
- creates the two exact signatures with fully qualified static SQL, safe search path, contract
  markers, and source checksums;
- removes temporary schema creation and role membership in the same transaction; and
- proves final owner privileges, policies, function posture, ACLs, source, and unchanged runtime
  reachability.

### 2.2 Candidate contract

The candidate function accepts only:

- `prh1:` followed by 64 lowercase hexadecimal characters; or
- a strict 43-character legacy base64url selector.

It requires an unused, unexpired row, an active derived user, and between 1 and 64 active
memberships in active organizations. It returns only `candidate_proven = true` or no row. No flow,
identity, token, request, role, expiry, or recovery field is projected.

### 2.3 Redemption contract

The redemption function accepts only the stored selector and an exact cost-12 bcrypt hash. It does
not accept a user ID, organization ID, flow ID, session ID, preserved session ID, or audit scope.

Its required order is implemented as:

1. non-locking exact selector lookup to derive the account lock key;
2. account-global advisory transaction lock;
3. active user row lock;
4. active membership and organization locks in canonical organization order;
5. presented reset row lock;
6. other unused reset row locks in canonical flow order;
7. recovery row locks in canonical flow order;
8. password, token, recovery, and session mutations; and
9. one minimum server-only result envelope.

A neutral denial returns no row. An internal invariant failure raises a categorical error and rolls
back the caller transaction.

### 2.4 Repository

`PasswordResetCapabilityRepository` uses only the ordinary database query client and accepts a
transaction query client. It:

- validates current and legacy stored-selector forms;
- validates exact cost-12 bcrypt shape;
- parameterizes both function calls;
- rejects duplicate rows, false markers, extra projection fields, malformed identifiers,
  mismatched paired arrays, duplicate or non-canonical IDs, invalid actor types, and more than 64
  audit organizations; and
- emits only categorical errors without selector, hash, token, or recovery data.

The live reset route does not import this repository.

## 3. Privilege posture

### 3.1 Runtime role

`vaultspace_app` remains executable on exactly:

1. login candidate;
2. session resolve;
3. organization resolve;
4. session create;
5. session refresh;
6. exact-token session invalidate;
7. self-bound other-session revoke;
8. administrator organization-scoped target revoke; and
9. administrator global single-organization target revoke.

It cannot execute either Unit 10 function or either generic bulk-revoke primitive.

Direct reset-token and recovery table privileges remain an explicit residual. They are unchanged
because administrator lifecycle routes still cancel reset flows directly. Raw provider-correlation
access remains denied.

### 3.2 Function owner

`vaultspace_bootstrap_owner` remains NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB,
NOCREATEROLE, and NOREPLICATION with zero direct or transitive memberships. It receives no table
level write privilege and no schema creation privilege after migration commit.

## 4. Verification results

### 4.1 Migration and catalog

- PostgreSQL 15 fresh chain: 50/50 migrations applied.
- Production-like prestate: 49 prior migrations, exact nine runtime grants, and broad reset-table
  residual established before Unit 10.
- Unit 10 against production-like prestate: PASS.
- Runtime residual snapshot: 152 table and expanded column ACL facts preserved exactly.
- Both function source MD5 values match the reviewed migration.
- Fresh RLS setup after migration: PASS.

### 4.2 Unit and integration tests

- Focused repository and auth tests: 32/32 PASS.
- Unit 10 real-role PostgreSQL groups: 9/9 PASS.
- Complete RLS integration suite: 94/94 PASS across 9 files.
- Complete unit suite: 1,385 PASS, 7 skipped across 148 files.
- TypeScript: PASS.
- Unit 10 scoped formatting: PASS.
- Production build: PASS.
- Lint: PASS with one unrelated pre-existing React hook warning.

The Unit 10 matrix covers current and legacy selectors, every neutral candidate state, exact subject
derivation, other-user isolation, recovery wiping, flow supersession, session revocation, replay
denial, bcrypt validation, double-redemption serialization, issuance serialization, deactivation
serialization, surrounding-transaction rollback, hostile search path and tenant GUC input, exact
ACLs, exact owner privileges, and the administrator lifecycle residual.

## 5. Strawman

- The first unauthenticated write-capability family adds more owner-only privilege and RLS policy
  surface.
- A candidate call creates an eligibility oracle before bcrypt.
- Existing runtime reset-table privileges remain broad during this inert unit.
- The foundation requires a second controlled unit before the route can use it.

## 6. Steelman

- PostgreSQL derives every mutation scope from one stored capability row and accepts no caller
  selected identity or tenant scope.
- The candidate returns no identity and prevents invalid anonymous requests from forcing bcrypt
  work.
- The owner has exact column privileges, no table-level writes, no login, and no runtime role
  reachability.
- Inert deployment separates the first database write-capability risk from anonymous route
  conversion risk.
- The broad reset-table residual is asserted rather than hidden, and remains a hard gate for later
  contraction.

## 7. Pre-mortem

| If                                                                          | Then                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------- |
| A caller transaction GUC suppresses or broadens reset resolution            | Fail the hostile-context matrix and stop before merge |
| The account advisory lock follows any row lock                              | Fail the source-order and concurrency matrix          |
| A valid selector changes a different user                                   | Treat as a critical authorization defect and stop     |
| Audit insertion failure cannot roll back redemption                         | Fail the transaction rollback matrix and stop         |
| Unit 10 changes the runtime reset-table residual                            | Fail migration before commit                          |
| Either new function becomes runtime or PUBLIC executable                    | Fail the exact catalog matrix                         |
| A returned envelope contains credential or recovery material                | Fail repository mapping and source review             |
| Existing login, session, organization, or bounded revoke behavior regresses | Fail the complete RLS suite                           |

## 8. Deliberate exclusions

- No live reset route import or call.
- No runtime execution grant on either Unit 10 function.
- No anonymous or administrator reset issuance conversion.
- No provider delivery, worker, or recovery lifecycle conversion.
- No administrator lifecycle cancellation conversion.
- No direct reset-table privilege contraction.
- No `DATABASE_URL_ADMIN` removal.
- No deploy workflow, Azure, W1-3, or P0-4 change.

## 9. Operational note

Disposable PostgreSQL containers `vaultspace-w1-2-unit10-foundation-v1` and
`vaultspace-w1-2-unit10-foundation-v2` are retained. No cleanup is performed without a separate
Advisor authorization.

PR #145 must remain draft until the exact implementation head is green and the Advisor issues the
ADV-2026-08-13-07 controlled merge and deploy decision. No merge, workflow disablement, deployment,
runtime grant, or route conversion is authorized by this implementation record.

## References

- `docs/W1_2_PASSWORD_RESET_CAPABILITY_CONTRACT_PROPOSAL_2026-08-13_v1.md`
- `prisma/migrations/20260813150000_w1_2_password_reset_redemption_foundation/migration.sql`
- `src/lib/auth/passwordResetCapabilityRepository.ts`
- `src/lib/auth/passwordResetCapabilityRepository.test.ts`
- `tests/integration/bootstrap-password-reset-capability.test.ts`
- `tests/integration/bootstrap-login-candidate.test.ts`
- `tests/integration/bootstrap-session-mutation.test.ts`
- `src/app/api/auth/reset-password/route.ts`
- `src/app/api/users/[userId]/route.ts`
- `scripts/setup-rls-test-db.ts`
- `package.json`
