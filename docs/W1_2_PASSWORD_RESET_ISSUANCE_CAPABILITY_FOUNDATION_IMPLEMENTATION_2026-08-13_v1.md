# W1-2 Password Reset Issuance Capability Foundation Implementation

- Date: 2026-08-13
- Authorization: ADV-2026-08-13-16
- Unit: W1-2 Unit 12
- PR: #151
- Status: Implemented and locally verified, pending Advisor premerge checkpoint

## 1. Outcome

Unit 12 implements the approved inert password-reset issuance foundation and the separately authorized Activity and Analytics UI/UX integration.

The security foundation adds three owner-only PostgreSQL capabilities:

1. `bootstrap_password_reset_issue_anonymous_v1`
2. `bootstrap_password_reset_admin_recipient_v1`
3. `bootstrap_password_reset_issue_admin_single_org_v1`

No production route or worker imports the new issuance repository. No new `vaultspace_app` or PUBLIC EXECUTE privilege is granted. The runtime matrix remains exactly the eleven Unit 11 functions.

## 2. Security contracts implemented

### 2.1 Anonymous issuance

The anonymous capability:

- accepts only a canonical lowercase email and a current `prh1:` HMAC lookup;
- derives the subject from the active database user row;
- acquires the established account-global advisory lock;
- locks and revalidates the subject, memberships, and organizations;
- derives a canonical one-to-sixty-four organization audit scope;
- treats the requested sender slug only as a validated active-membership hint;
- derives the one-hour expiry in PostgreSQL;
- enforces a database-side one-minute issuance cooldown;
- supersedes every prior unused flow and wipes its recovery envelope;
- inserts the reset and recovery rows atomically; and
- returns only proof, flow ID, audit organization IDs, and positionally paired supersession identifiers.

Unknown email, inactive account, empty active scope, inactive organization, oversized scope, invalid input, cooldown, and stale-state outcomes return no row.

### 2.2 Administrator recipient preparation

The preparation capability validates an active bearer session, active actor account, active organization, active membership, and ADMIN role. It counts every target membership, including inactive rows, and returns an email only when the target has exactly one membership in the actor organization and every active-state condition passes.

The only result fields are `authorization_proven` and `recipient_email`. The preparation result is not mutation authorization.

### 2.3 Administrator issuance

The administrator mutation capability repeats authorization and target eligibility under locks. It:

- derives actor identity and organization from the bearer session;
- acquires the target account-global advisory lock;
- locks actor and target users deterministically;
- locks the actor session, target membership inventory, actor membership, and organization;
- requires exactly one target membership across all organizations;
- requires the expected normalized email to match the locked target row;
- derives the sender and audit scope exclusively from the actor organization; and
- applies the same cooldown, supersession, atomic insertion, and minimal result contract as anonymous issuance.

The caller cannot select a user through the anonymous function, select an organization through the administrator function, or provide an audit scope or expiry to either mutation.

## 3. Recovery envelope version 2

Version 2 uses AES-256-GCM and binds authenticated data to:

1. purpose `vaultspace/password-reset-recovery/v2`;
2. cipher version;
3. recovery key ID;
4. flow ID;
5. stored HMAC lookup;
6. provider operation ID; and
7. recipient fingerprint.

The provider operation ID must equal the flow ID. Version 2 creation requires no user ID. The delivery reader dispatches by stored cipher version and retains version 1 compatibility for existing flows.

The database recovery-envelope completeness constraint now accepts versions 1 and 2 while preserving the exact nonce, authentication-tag, ciphertext, and nullable-terminal-state rules.

## 4. Privilege posture

The migration adds only column-scoped privileges needed for creation:

- INSERT on the reviewed reset-token columns;
- INSERT on the reviewed recovery-envelope columns, including `updatedAt`; and
- SELECT on reset-token `createdAt` for the database cooldown.

The owner remains `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, and `NOBYPASSRLS`, with zero direct or transitive memberships. It retains no table-level INSERT, UPDATE, or DELETE on users, sessions, password-reset tokens, or password-reset recoveries.

The final migration assertion verifies:

- three exact signatures;
- owner identity;
- language, volatility, parallel mode, security-definer mode, and search path;
- exact result types;
- exact contract markers;
- exact source MD5 checksums;
- owner-only function ACLs;
- no PUBLIC bootstrap execution;
- the unchanged eleven-function runtime matrix; and
- byte-for-byte preservation of the 152-key runtime reset-table ACL residual using `pg_catalog."C"` collation.

Reviewed source checksums:

| Function                                             | MD5                                |
| ---------------------------------------------------- | ---------------------------------- |
| `bootstrap_password_reset_issue_anonymous_v1`        | `5f6f28595a24f218dfe2afda96a67eef` |
| `bootstrap_password_reset_admin_recipient_v1`        | `66d39e5da1e0d1ec3d5183a3abdce0fe` |
| `bootstrap_password_reset_issue_admin_single_org_v1` | `bbfbfca5c550275c6636c7c65cb1e589` |

## 5. Application boundary

`PasswordResetIssuanceCapabilityRepository` is an unrouted ordinary-client repository. It provides:

- `issueAnonymous`;
- `prepareAdminRecipient`; and
- `issueAdminSingleOrg`.

The repository parameterizes every value, calls only the three schema-qualified functions, strictly validates input and result shapes, rejects identity-bearing anonymous responses, rejects malformed or noncanonical arrays, and requires a single audit organization for administrator issuance.

Static tests scan production TypeScript and TSX sources to prove that no route or worker imports the repository. Existing issuance routes remain on their established paths for this inert unit. `DATABASE_URL_ADMIN` remains configured and is not changed by Unit 12.

## 6. Activity and Analytics integration

ADV-2026-08-13-16 separately authorized the local Activity and Analytics changes for inclusion in this build.

Implemented behavior:

- login and logout audit capture use a one-minute dedupe window;
- the organization activity response collapses adjacent duplicate event-type and actor-email records within one minute;
- pagination totals subtract duplicates detected in the fetched candidate window;
- room analytics reads a broader recent-session candidate set before selecting the final ten viewers;
- anonymous share-link events and sessions group under one anonymous viewer identity;
- identified viewers are ordered before anonymous aggregation in the recent-viewer list; and
- Native, Shadow, Legacy, and Authoritative developer badges are removed from stakeholder-facing pages while the Inferred label remains where provenance is not authoritative.

Focused API and UI tests cover duplicate activity, anonymous grouping, identified-viewer ordering, dedupe constants, and rendered badge behavior.

## 7. Strawman, Steelman, and Pre-Mortem

### Strawman

- Three write capabilities in one migration increase catalog and lock-order complexity.
- Recovery version 2 could make current version 1 flows unreadable if reader dispatch is incomplete.
- Administrator preparation could be mistaken for final authorization if issuance does not repeat every check.
- Mixing UI polish with a security foundation broadens review scope.

### Steelman

- The unit is inert. Functions are owner-only and no live source imports the repository.
- Version 1 and version 2 reader paths are both exercised, and current version 1 writers remain unchanged.
- Administrator issuance repeats actor, session, membership, organization, target, and email checks under locks.
- UI files are isolated in a separately identified, Advisor-authorized section with focused tests.
- The complete historical migration chain and the existing RLS suite are re-run rather than relying on source inspection alone.

### Pre-Mortem

| Failure                                              | Preventive gate                                                           | Response                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| Runtime receives one of the three new EXECUTE grants | Exact eleven-function prestate/poststate and explicit per-function denial | Migration fails and transaction rolls back |
| PUBLIC can execute a bootstrap function              | Catalog-wide PUBLIC EXECUTE assertion                                     | Migration fails and transaction rolls back |
| Multi-organization target is reset by a tenant admin | Count every membership, including inactive rows, before and under locks   | Return no row and write nothing            |
| Anonymous response exposes identity                  | Minimal SQL projection plus exact-key repository validation               | Reject the response envelope               |
| Concurrent issuance creates two current flows        | Shared account advisory lock plus database cooldown                       | At most one call succeeds                  |
| Audit insertion later fails in route composition     | Capability participates in caller transaction                             | Issuance and supersession roll back        |
| Version 2 recovery material is moved to another flow | Flow, lookup, operation, and fingerprint are authenticated data           | Decryption fails closed                    |
| Migration changes reset-table runtime privileges     | 152-key collation-stable ACL snapshot comparison                          | Migration fails and transaction rolls back |

## 8. Verification record

Completed locally:

- complete PostgreSQL 15 migration chain: 52 of 52 migrations applied;
- Unit 12 real-role matrix: 9 of 9 tests passed;
- complete RLS integration suite: 103 of 103 tests passed across 10 files;
- unit suite: 1,400 passed, 7 skipped across 150 test files;
- production Next.js build: passed;
- TypeScript type check: passed;
- ESLint: zero errors, one unrelated pre-existing hook warning; and
- formatting: all Unit 12 and authorized UI/UX files passed.

The repository-wide formatting command also reports three unrelated user worktree files. They remain untouched, unstaged, and excluded from PR #151.

## 9. Scope exclusions preserved

Unit 12 does not:

- grant runtime EXECUTE on the three issuance functions;
- convert anonymous or administrator issuance routes;
- change reset issuance response contracts;
- change reset delivery queue payloads;
- revoke the temporary direct runtime reset-table residual;
- remove `DATABASE_URL_ADMIN`;
- alter generic session revocation grants;
- begin W1-3 enforcement; or
- merge or deploy without a separate Advisor premerge checkpoint.

## 10. Premerge checkpoint

After the implementation commit is pushed and exact-head CI is green, Lead Dev will stop and request ADV-2026-08-13-17. No merge or deployment is authorized by this implementation record.

## References

- `docs/W1_2_PASSWORD_RESET_ISSUANCE_CAPABILITY_CONTRACT_PROPOSAL_2026-08-13_v1.md`
- `prisma/migrations/20260814010000_w1_2_password_reset_issuance_foundation/migration.sql`
- `src/lib/auth/passwordResetRecovery.ts`
- `src/lib/auth/passwordResetIssuanceCapabilityRepository.ts`
- `tests/integration/bootstrap-password-reset-issuance.test.ts`
- Authorization `ADV-2026-08-13-16`
