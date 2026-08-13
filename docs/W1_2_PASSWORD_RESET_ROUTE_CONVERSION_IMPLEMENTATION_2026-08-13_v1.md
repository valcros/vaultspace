# W1-2 Unit 11 Password Reset Route Conversion Implementation

- Date: 2026-08-13
- Advisor authorization: ADV-2026-08-13-13
- Unit: W1-2 Unit 11
- Source PR: #149
- Starting head: `1874e867483e73090be9746185e0e6ce143edcf9`
- Security freeze: Active
- Admin database URL: Retained
- W1-3: Not started

## 1. Implemented boundary

Unit 11 converts only `POST /api/auth/reset-password` from direct administrative database access
to the Unit 10 password-reset capability contract. The runtime role receives `EXECUTE` on exactly
the candidate and redemption functions. The application runtime matrix increases from nine to
eleven approved `bootstrap_*` functions.

Anonymous issuance, administrator issuance, delivery transitions, account lifecycle cancellation,
direct reset-table privilege contraction, `DATABASE_URL_ADMIN` removal, and W1-3 remain excluded.
The two generic bulk session-revocation procedures remain owner-only.

## 2. Route authorization flow

The route accepts the existing current public token shape and strict 43-character legacy tokens.
Current public tokens are converted to non-reversible `prh1:` lookups in the application by using
`SESSION_SECRET`. Public tokens, stored lookups, passwords, hashes, and session identifiers are not
included in logs, responses, or audit metadata.

The ordinary repository first calls `bootstrap_password_reset_candidate_v1(text)`. A missing or
neutral candidate returns the exact HTTP 400 response before bcrypt cost-12 work begins. Candidate
success is not mutation authorization. The redemption function repeats every eligibility check
under its advisory and row locks.

After hashing, the route opens one ordinary-role `db.$transaction`. It establishes an empty
bootstrap context, invokes `bootstrap_password_reset_redeem_v1(text, text)` through a repository
bound to that transaction, and accepts only the validated result envelope. There is no
`bootstrapDb`, direct reset model access, direct user or session mutation, nested `withOrgContext`,
or administrative fallback on the converted route.

## 3. Atomic audit composition

The redemption envelope supplies the subject identity, canonical organization audit scopes,
membership-derived actor types, flow identifiers, and revoked session identifiers. The route sets
`app.current_org_id` transaction-locally for each database-derived organization by using
`setTransactionOrganizationContext`. The helper operates on the existing transaction and never
opens a nested transaction.

Completion and sibling-supersession events use `createSecurityAuditEvent`, which propagates any
failure. The completion idempotency key is
`password-reset-<flowId>-completed-<organizationId>`. Supersession retains
`password-reset-<supersededFlowId>-superseded-<organizationId>`.

An audit failure rolls back the password mutation, token claim, recovery wipe, sibling
supersession, session revocations, and earlier audit inserts as one PostgreSQL transaction. A
candidate or redemption race returns the same neutral token response and creates no audit.

## 4. Post-commit cache behavior

After the database transaction commits, the route sends only returned session IDs to
`clearSessionCache`. The existing helper targets `session:v2:<sessionId>` keys and records only
categorical counts. A cache-provider failure does not reverse a committed password reset. Every
future session resolution queries live PostgreSQL first, so a stale cache entry cannot authorize a
revoked session.

## 5. Catalog contract

The Unit 11 migration runs a read-only fail-closed guard before its DDL transaction. It verifies:

1. the no-login owner posture and zero role memberships;
2. exact signatures, owners, languages, security-definer flags, volatility, search paths, source
   checksums, result types, and contract markers for the two Unit 10 functions;
3. owner-only prestate ACLs and denial of PUBLIC execution on every `bootstrap_*` function;
4. the exact nine-function runtime prestate and denial of generic bulk revocation;
5. the 152-key direct reset-table privilege residual; and
6. rejection of the runtime credential as the migration identity.

The transactional section snapshots the reset-table ACL residual, grants only the two reviewed
password-reset signatures, restores zero owner memberships, proves the exact eleven-function
runtime matrix, proves the two generic procedures remain owner-only, and compares the residual ACL
snapshot with deterministic `pg_catalog."C"` collation.

Fresh disposable databases create the runtime role after migrations. The guarded RLS setup script
therefore mirrors the same two grants and asserts the exact eleven-function matrix before running
integration tests.

## 6. Verification scope

The implementation adds or updates coverage for:

- candidate-before-bcrypt ordering;
- current HMAC lookup and strict legacy-token handling;
- identical invalid, expired, candidate-denied, and redemption-race responses;
- one ordinary-role transaction for redemption and all authoritative audits;
- transaction-local organization RLS context derived only from the SQL envelope;
- deterministic completion and supersession keys;
- audit failure rollback and post-commit cache failure behavior;
- token, lookup, secret, and session-ID log non-disclosure;
- exact eleven-function catalog posture and owner-only generic functions;
- real-role candidate and redemption execution;
- concurrent redemption, issuance serialization, account deactivation, and full transaction
  rollback;
- preservation of the temporary administrator lifecycle privilege residual; and
- a CloudVault runner that covers health identity, migration and ACL posture, reset redemption,
  audit creation, warmed-cache revocation, password replacement, neutral denials, and prior resolve
  family regressions.

## 7. Completed premerge validation

- Focused route, repository, and transaction-context contract suite: 28 passed.
- Full unit suite under the normal CI execution model: 1,385 passed across 148 test files; 7 tests
  in 1 file skipped under the existing integration guard.
- RLS integration matrix: 94 passed across 9 test files.
- Unit 11 real-role password-reset matrix: 9 passed, including concurrency, hostile search path,
  and authoritative audit rollback.
- TypeScript type-check: Passed.
- ESLint: Passed with one pre-existing unrelated hook dependency warning and no errors.
- Production Next.js build: Passed.
- Unit 11 scoped Prettier and whitespace checks: Passed. The repository-wide check remains blocked
  only by two unrelated, unstaged user documents that were not modified.
- Fresh PostgreSQL 15 chain: All 51 migrations applied cleanly in each of two disposable
  containers.
- Guarded fresh-role RLS setup: Passed with the exact eleven-function runtime matrix.
- Production-like migration path: Started from exactly nine app-executable functions and 152 reset
  ACL keys, then committed the Unit 11 migration with exactly eleven functions and the residual
  unchanged.
- CloudVault runner syntax and static contract checks: Passed. The runner has not been executed and
  is reserved for the separately authorized post-deploy acceptance phase.
- Disposable containers `vaultspace-w1-2-unit11-route-v1` and
  `vaultspace-w1-2-unit11-route-v2` remain retained pending explicit cleanup authorization.

## 8. Explicit exclusions

- No password-reset issuance conversion.
- No administrator lifecycle cancellation conversion.
- No provider delivery or reconciliation conversion.
- No contraction of direct runtime reset-token or recovery privileges.
- No grant on generic organization or global session revocation.
- No registration, two-factor completion, public-link, viewer-session, or access-request conversion.
- No workflow path-filter change.
- No migrator or web-entrypoint restructuring.
- No `DATABASE_URL_ADMIN` removal.
- No W1-3 or P0-4 change.
- No merge or deployment under implementation-only authorization.

## References

- `docs/W1_2_PASSWORD_RESET_ROUTE_CONVERSION_PROPOSAL_2026-08-13_v1.md`
- `prisma/migrations/20260813150000_w1_2_password_reset_redemption_foundation/migration.sql`
- `prisma/migrations/20260813220000_w1_2_password_reset_redemption_route_conversion/migration.sql`
- `src/app/api/auth/reset-password/route.ts`
- `src/lib/auth/passwordResetCapabilityRepository.ts`
- `src/lib/audit/securityAudit.ts`
- `src/lib/auth/session.ts`
- `src/lib/db.ts`
- `tests/integration/bootstrap-password-reset-capability.test.ts`
- `scripts/setup-rls-test-db.ts`
- `scripts/cloudvault-w1-2-password-reset-route-acceptance-v1.cjs`
