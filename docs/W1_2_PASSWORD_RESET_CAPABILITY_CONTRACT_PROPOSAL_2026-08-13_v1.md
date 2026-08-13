# W1-2 Password Reset Capability Contract Proposal

- **Date:** 2026-08-13
- **Advisor authorization:** ADV-2026-08-13-05
- **Proposal version:** 1
- **Control family:** W1-2 database privilege split
- **Proposed implementation unit:** Unit 10 password-reset redemption foundation
- **Starting main:** `dbd5e4e7d6b96c7048e7e67358d1a091d997bd43`
- **Unit 9 status:** Acceptance-closed
- **Security freeze:** Active
- **P0-4:** Accepted and unchanged
- **Implementation authority:** Proposal only

## 1. Decision summary

The password-reset redemption route needs a database capability contract that does not accept a
user ID, organization ID, reset-flow ID, session ID, or caller-selected audit scope. The only
authorization input should be a server-derived lookup value for the presented reset credential.
PostgreSQL must resolve that value to a locked reset row, derive the subject identity from the row,
recheck current account and membership state, consume the credential, update the password,
supersede other reset flows, and revoke the derived subject's sessions atomically.

The recommended implementation has two functions:

1. `bootstrap_password_reset_candidate_v1(text)` performs a read-only eligibility check before the
   application spends bcrypt work. It returns only a positive marker or no row.
2. `bootstrap_password_reset_redeem_v1(text, text)` performs the authoritative one-time redemption.
   Its inputs are the stored-token lookup value and a bcrypt password hash. It never accepts the
   subject identity.

Because this is the first unauthenticated write-capability family, the recommended Unit 10 deploy
is an inert foundation. Both functions are created, source-checked, owner-only, and unrouted. The
runtime execution matrix remains the nine Unit 9 functions. A separately authorized follow-up may
grant these two functions and convert the redemption route after the foundation is catalog-green.

Anonymous reset issuance, administrator-triggered reset issuance, provider delivery transitions,
and password-reset workers remain outside the first redemption unit. They have different
authorization and external-delivery state machines. `DATABASE_URL_ADMIN` must remain on the web
until those paths and the other W1-2 bootstrap families are converted and the complete CloudVault
matrix is green.

## 2. Current production posture

Unit 9 is acceptance-closed at release
`404c9f949bc4d24973ecf1290f99ff640c422dd3`, web revision
`ca-vaultspace-web--0000299`, and worker revision
`ca-vaultspace-worker--0000282`.

`vaultspace_app` can execute exactly nine approved `bootstrap_*` functions:

1. login candidate;
2. session resolve;
3. organization resolve;
4. session create;
5. session refresh;
6. exact-token session invalidate;
7. self-bound other-session revoke;
8. administrator organization-scoped target revoke; and
9. administrator global single-organization target revoke.

The generic organization and global session revocation functions remain owner-only. Session cache
keys use `session:v2:<sessionId>`, and live PostgreSQL session resolution remains authoritative.

The unauthenticated reset redemption route still uses the administrative client to locate the reset
row, resolve the subject, consume the credential, update the password, supersede other reset flows,
and revoke sessions. Anonymous and administrator reset issuance routes also use the administrative
client for account-global token and recovery state.

The ordinary application role currently receives broad table grants during RLS setup. Password
reset token and recovery tables are not tenant-scoped RLS tables. A narrow function contract is
therefore not the final privilege boundary while direct runtime access remains. The administrator
user-update and account-deletion route still uses the ordinary application transaction to cancel
outstanding reset flows during email, membership, and account lifecycle changes. Revoking direct
access before that caller has a bounded replacement would break live security behavior.

## 3. Proposed Unit 10 boundary

### 3.1 Included in the inert foundation

1. Add the two owner-only redemption functions.
2. Add exact column privileges and any owner-specific visibility required by those functions.
3. Record the exact existing `vaultspace_app` privileges on reset tokens and recoveries as a
   residual. Do not broaden or revoke them in the inert unit.
4. Add a server-only password-reset capability repository, but do not import or call it from a live
   route.
5. Add repository mapping tests, source inventory guards, full migration-chain tests, real-role
   PostgreSQL behavior tests, hostile-catalog tests, and production-like prestate tests.
6. Deploy under the controlled ceremony and prove the live runtime execution matrix remains nine.
7. Run only login, session, organization, logout, and post-logout regression smoke because the new
   functions remain unrouted.

### 3.2 Explicitly excluded from the inert foundation

- No `vaultspace_app` execution on either new password-reset function.
- No import of the new repository from the live reset route.
- No anonymous issuance or administrator issuance conversion.
- No provider queue, acceptance, retry, recovery, or reconciler conversion.
- No conversion of reset-flow cancellation in administrator user update or account deletion.
- No revocation of existing direct `vaultspace_app` reset-token or recovery privileges until every
  live direct caller has a bounded replacement.
- No change to token HMAC keys, encryption keys, bcrypt cost, token TTL, email content, or provider
  evidence contracts.
- No direct application execution on either generic bulk session revoke function.
- No registration, invitation, public-link, viewer-session, or access-request conversion.
- No `DATABASE_URL_ADMIN` removal.
- No migrator or entrypoint cutover.
- No W1-3 or P0-4 change.

### 3.3 Follow-up route-conversion boundary

After written foundation close-out, one bounded conversion unit may:

1. grant `vaultspace_app` execution on the candidate and redeem functions only;
2. convert the unauthenticated reset redemption route with no `bootstrapDb` fallback;
3. preserve strict public-token parsing and application-side HMAC lookup derivation;
4. preserve application-side bcrypt at cost 12;
5. preserve atomic security audits inside the same runtime transaction;
6. evict returned `session:v2:<sessionId>` keys only after commit; and
7. run the full CloudVault redemption matrix and minimal Brightside regression smoke.

This follow-up must not convert reset issuance or provider delivery transitions unless the Advisor
approves a larger, separately analyzed contract.

The redemption conversion also does not authorize direct reset-table privilege revocation. That
contraction requires a separate bounded contract for the administrator user-update and account
lifecycle cancellation paths.

## 4. Threat model and binding rule

The public reset endpoint is unauthenticated. A caller can choose a presented reset token and a new
password, but must not choose the database subject or revocation scope. The ordinary application
database role is not an authorization principal.

The threats are:

- application code supplying a valid reset flow but a different user ID;
- a compromised route invoking global session revocation for an arbitrary subject;
- a stale pre-read followed by password mutation after the flow was consumed, expired, or
  superseded;
- a concurrent email or membership change racing the password reset;
- a reset completing for a deactivated user or an identity with no active organization;
- an invalid-token flood causing a bcrypt CPU denial of service;
- direct application reads of stored reset credentials or encrypted recovery material;
- a function returning bearer tokens, password hashes, encrypted recovery material, or unrelated
  identity fields; and
- audit failure committing the password mutation without an authoritative audit fact.

The binding rule is:

> A runtime-callable password-reset redemption function may accept only the server-derived stored
> credential lookup and a validated bcrypt hash. PostgreSQL must derive the reset flow, subject
> user, audit scope, and session-revocation scope from locked database rows. An application-provided
> user ID, flow ID, organization ID, or preserved session ID is forbidden.

Unit 10 reduces the administrative-connection surface for redemption but does not by itself close
the ordinary runtime role's existing direct reset-table privilege. That residual remains explicit
until reset issuance, administrator cancellation, and account lifecycle callers are converted.

## 5. Reset credential validation contract

### 5.1 Public token processing remains in the application

The application retains the existing strict public parser:

- current public tokens match `prt1_` followed by a 43-character base64url body;
- current stored lookups match `prh1:` followed by a 64-character lowercase hexadecimal HMAC;
- legacy public and stored tokens match exactly 43 base64url characters; and
- a stored `prh1:` value presented directly to the HTTP endpoint is rejected by the public parser.

For a current token, the server derives the non-reversible stored lookup with the existing
`SESSION_SECRET`-derived HMAC key. The HMAC key stays out of PostgreSQL. The function receives only
the resulting lookup string. For a legacy token, the strict public value is also the stored lookup,
preserving the existing dual-reader contract until every live legacy token naturally expires.

This split does not let the application assert the reset subject. The application performs format
and cryptographic lookup derivation. PostgreSQL performs the authoritative exact-row match,
one-time and expiry checks, current-state checks, subject derivation, credential claim, and all
security mutations.

### 5.2 Why the database need not receive the public token

Giving PostgreSQL the public token and the HMAC key would move a long-lived application secret into
function configuration or database storage. That would enlarge the database secret boundary and
make rotation harder. Passing the non-reversible lookup preserves the current storage design while
keeping identity derivation and one-time authorization inside PostgreSQL.

The route must never log the public token or stored lookup. The repository must not include either
value in errors, metrics, audit metadata, or query diagnostics.

## 6. Proposed SQL contracts

### 6.1 Candidate eligibility function

Proposed signature:

`public.bootstrap_password_reset_candidate_v1(input_stored_token text)`

The function should be `STABLE`, `PARALLEL UNSAFE`, `SECURITY DEFINER`, and configured with
`search_path=pg_catalog`. It must use only fully qualified, static SQL.

It must:

1. validate that the lookup is either a current stored HMAC digest or a strict legacy token;
2. resolve exactly one unique reset row;
3. require `usedAt IS NULL` and `expiresAt > statement_timestamp()`;
4. require the derived user to be active;
5. require at least one active membership in an active organization;
6. require the active audit scope to contain at most 64 unique organization IDs; and
7. return one row containing `candidate_proven = true`, or no row.

It must not return the flow ID, user ID, email, membership, role, expiry, request ID, stored token,
or any recovery field. It is an optimization against invalid-token bcrypt amplification, not the
authorization for mutation. The redeem function must repeat every check under locks.

### 6.2 Authoritative redemption function

Proposed signature:

`public.bootstrap_password_reset_redeem_v1(input_stored_token text, input_password_hash text)`

The function should be `VOLATILE`, `PARALLEL UNSAFE`, `SECURITY DEFINER`, and configured with
`search_path=pg_catalog`. It must use fully qualified static SQL and no dynamic SQL.

The password hash must match the exact reviewed bcrypt shape and cost 12. Plaintext password input
is forbidden.

The function must:

1. perform a non-locking exact lookup solely to derive a candidate user ID;
2. acquire the existing account-global advisory lock derived from that user ID;
3. lock the user, memberships, and organizations in deterministic order;
4. re-resolve and lock the exact reset row after the account lock;
5. repeat token-shape, unused, unexpired, active-user, active-membership, active-organization, and
   audit-scope checks;
6. claim the exact reset row by setting `usedAt` only if it is still unused and unexpired;
7. wipe matching recovery ciphertext fields and mark the flow `REDEEMED`;
8. update only the derived user's password hash and update timestamp;
9. find and supersede every other unused reset flow for that derived user;
10. wipe remaining recovery ciphertext for those superseded flows and mark them `SUPERSEDED`;
11. call the owner-only global session revoke primitive with the derived user ID and no preserved
    session; and
12. return one authorization-proven result, or no row for any neutral denial.

The function must not accept or return a reset token, stored-token lookup, password hash, recovery
ciphertext, TOTP material, backup-code material, session token, or organization branding field.

### 6.3 Minimal result envelope

One successful result may return only:

- `authorization_proven boolean`, which must be true;
- `flow_id text`;
- `subject_user_id text`;
- `subject_email text`, solely for the existing server-side audit actor projection;
- `initiation_request_id text`;
- `audit_organization_ids text[]`, sorted and unique;
- `audit_actor_types text[]`, positionally paired with organization IDs;
- `superseded_flow_ids text[]`;
- `superseded_request_ids text[]`, positionally paired with superseded flow IDs; and
- `revoked_session_ids text[]`, sorted and unique.

The result is server-only. None of these fields is sent to the unauthenticated client. The route
returns only its existing neutral error or success response.

An authorized redemption with no active sessions or no superseded flow returns empty arrays. A
neutral denial returns no row. Duplicate result rows, a false authorization marker, mismatched
array lengths, malformed IDs, duplicate IDs, an invalid actor type, or more than 64 audit
organizations must cause the repository to throw and the transaction to roll back.

## 7. Transaction and lock order

The function must preserve the account-global lock order used by issuance. It must not lock the
reset row before taking the account advisory lock, because issuance takes the account lock before
touching reset rows.

Required order:

1. non-locking exact selector lookup to derive candidate `userId`;
2. `pg_advisory_xact_lock(hashtextextended('vaultspace/password-reset/user/' || userId, 0))`;
3. user row;
4. membership and organization rows ordered by organization ID under `COLLATE "C"`;
5. presented reset row, then other unused reset rows ordered by reset-flow ID;
6. matching recovery rows ordered by flow ID;
7. sessions ordered by session ID through the existing owner-only global primitive;
8. password, token, recovery, and session mutations; and
9. tenant audit inserts by the application before the surrounding transaction commits.

The initial selector lookup is only a way to discover the lock key. It grants no authority. If the
row changes before the post-lock lookup, the function returns no row and performs no mutation.

The implementation must include concurrency tests for redemption versus anonymous issuance,
administrator issuance, email change, membership deactivation, user deactivation, token expiry,
and a second redemption of the same token.

## 8. Application repository and route contract

Add a server-only `PasswordResetCapabilityRepository` backed by the ordinary `db` client. It must
accept a transaction query client and must never open the administrative pool.

The route-conversion sequence should be:

1. parse the public token and password;
2. derive the stored lookup with the existing application HMAC helper;
3. call the candidate function;
4. return the existing neutral invalid-or-expired response if no candidate is proven;
5. hash the new password with bcrypt cost 12;
6. start one runtime transaction and call the redeem function;
7. return the neutral response if redemption loses a race;
8. validate the result envelope;
9. set each returned organization context and create the existing completion and supersession audit
   events in that same transaction;
10. commit only if every audit insert succeeds;
11. evict the returned session-ID cache keys after commit; and
12. return success.

If the SQL mutation succeeds but audit creation fails, the surrounding transaction must roll back
the password update, token claim, recovery wipe, and session revocation. If cache eviction fails
after commit, the live session resolver still denies the revoked sessions, and the route logs only
a categorical cache-cleanup outcome.

The converted route must contain no `bootstrapDb`, direct reset-table model call, direct user
password update, direct session update, or silent fallback. The old administrative path remains
available only in the retained rollback revision.

## 9. Privilege and RLS posture

### 9.1 Runtime role

The inert foundation must not change the ordinary role's existing reset-token or recovery-table
privileges. The migration must inventory and assert the reviewed prestate so Unit 10 cannot
silently broaden it. The existing complete revocation on `password_reset_provider_correlations`
remains unchanged.

This retained access is a named W1-2 residual, not the target posture. It is still required by the
administrator user-update and account-deletion route when that route cancels reset flows inside its
existing transaction. The eventual contraction must:

1. convert every direct web caller to a bounded capability;
2. revoke direct runtime privileges on `password_reset_tokens` and
   `password_reset_recoveries` in the migration;
3. reassert the revocation after broad RLS grant repair and in real-role test setup; and
4. prove that worker-specific reset delivery identities retain only their separate required
   privileges.

In the inert foundation, the runtime role receives no execution on the new functions. In the later
redemption conversion, it receives execution only on the two exact signatures.

### 9.2 Function owner

`vaultspace_bootstrap_owner` remains NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB,
NOCREATEROLE, and NOREPLICATION with zero direct or transitive role memberships.

The owner should receive only the exact column-level privileges needed for:

- reset-token selector and lifecycle columns;
- recovery flow, wipe, and terminal-state columns;
- the user password-hash and update-timestamp columns; and
- the session columns already approved for global revocation.

It must have no table-level `INSERT`, `UPDATE`, or `DELETE` on users, reset tokens, recoveries, or
sessions. Redemption creates no token or recovery row and deletes no row. Existing owner-specific
user, membership, organization, and session visibility remains explicit. Any new policy must name
only the no-login owner and must not broaden ordinary runtime visibility.

### 9.3 Function posture

Both new functions must:

- be owned by `vaultspace_bootstrap_owner`;
- be revoked from `PUBLIC` and every unapproved role;
- use exact signatures with no overload ambiguity;
- have immutable contract comments;
- have expected language, volatility, parallel posture, security-definer flag, safe configuration,
  and source checksum asserted before commit; and
- fail migration on any prestate or final-state drift.

Temporary role membership used to transfer ownership must be removed in the same transaction.
Temporary schema `CREATE` must be revoked. The migration must prove zero owner membership and zero
runtime reachability after those steps.

## 10. Catalog acceptance

### 10.1 Inert foundation

After Unit 10 foundation deployment:

- `vaultspace_app` can execute exactly the existing nine Unit 9 functions;
- `vaultspace_app` cannot execute either password-reset function;
- `PUBLIC` cannot execute either password-reset function;
- the two new functions are owner-only and unrouted;
- both generic session revoke primitives remain owner-only;
- existing direct runtime reset-token and recovery privileges are unchanged and recorded as a
  residual;
- direct runtime access to provider correlations remains absent;
- owner posture and membership closure are unchanged; and
- all owner table and column privileges match one exact reviewed array.

### 10.2 Later route conversion

After the separately authorized conversion, `vaultspace_app` may execute exactly eleven functions:
the nine Unit 9 functions plus:

1. `bootstrap_password_reset_candidate_v1(text)`; and
2. `bootstrap_password_reset_redeem_v1(text, text)`.

Every other unapproved `bootstrap_*` function remains denied. No generic session revoke function
becomes runtime-callable.

## 11. Backward compatibility and rollback

The foundation migration is additive for the retained web revision. It does not revoke existing
runtime reset-table access because the administrator user lifecycle route still needs that access.
Password-reset workers use their existing constrained worker identity and are not granted the web
administrative URL by this unit.

The later route-conversion migration is also additive. `DATABASE_URL_ADMIN` remains present, so the
prior web revision can be restored without reverting schema. A rollback may leave the two reviewed
runtime grants present until a migrator-only revocation is separately authorized, but the prior
route does not call them.

No applied migration is edited or reversed during an application rollback. No production DDL is
hand-applied. The prior web and worker revisions remain retained through the next successful W1-2
unit deploy.

## 12. Verification plan

### 12.1 Static and unit checks

- Public input rejects stored HMAC digests and malformed public tokens.
- Repository methods accept only stored lookup shapes and exact bcrypt cost-12 hashes.
- Candidate mapping accepts exactly one true marker and no other fields.
- Redemption mapping validates every scalar, paired array, uniqueness rule, and organization cap.
- Neither function accepts a user, organization, flow, session, or audit-scope argument.
- Neither function returns a token, lookup, password hash, recovery field, or session token.
- Converted route source contains no `bootstrapDb` or direct reset, user-password, or session
  mutation.
- No token or lookup appears in logs, errors, audit metadata, snapshots, or test diagnostics.
- Audit failure rolls back every authoritative mutation.
- Cache cleanup occurs only after commit and only by session ID.
- Existing direct reset-table privileges are inventoried and do not broaden.
- The source inventory guard identifies every direct web reset-table caller that must be converted
  before privilege contraction.

### 12.2 Disposable PostgreSQL matrix

Use a fresh PostgreSQL 15 migration chain, fresh real roles, a production-like Unit 9 prestate, and
an Azure-like migrator execution. Prove:

1. current HMAC selector candidate succeeds for one valid flow;
2. strict legacy selector candidate remains compatible;
3. malformed, unknown, used, expired, inactive-user, no-active-membership, and inactive-org cases
   return no row;
4. candidate returns no identity or flow data;
5. redeem changes only the subject derived from the locked reset row;
6. a supplied subject is impossible because no subject parameter exists;
7. wrong bcrypt shape or cost fails without mutation;
8. exact flow is consumed once and recovery ciphertext is wiped;
9. other unused flows are superseded and their recovery ciphertext is wiped;
10. every derived subject session is deactivated and only session IDs are returned;
11. another user's password, reset flows, recoveries, and sessions remain unchanged;
12. current active audit memberships and roles are returned in canonical order;
13. concurrent double redemption produces one success and one neutral denial;
14. concurrent issuance and redemption serialize under the existing account advisory lock;
15. concurrent account or membership deactivation wins cleanly or loses cleanly with no partial
    mutation;
16. hostile `search_path`, transaction GUC, overload, role membership, and schema shadowing cannot
    change behavior;
17. `vaultspace_app` reset-token and recovery privileges remain exactly at the reviewed prestate;
18. the administrator lifecycle caller remains functional and explicitly unconverted;
19. owner privileges are column-scoped with no table-level writes; and
20. the exact runtime execution matrix remains nine in the foundation deployment.

### 12.3 CloudVault foundation smoke

Because Unit 10 foundation is inert, production acceptance is limited to:

1. release and revision identity;
2. migration completion;
3. exact nine-function runtime matrix;
4. both password-reset functions owner-only;
5. direct reset-table runtime privileges unchanged and recorded as a residual;
6. login 200;
7. session resolve 200;
8. organization resolve regression;
9. logout 200; and
10. post-logout 401.

No live password-reset token is created or redeemed during the inert foundation smoke.

### 12.4 CloudVault route-conversion matrix

Use dedicated synthetic users and retain the CloudVault organization:

1. health and exact release identity;
2. exact eleven-function runtime matrix and owner-only generic revokes;
3. valid current HMAC reset token changes only the exact CloudVault identity;
4. token cannot be replayed;
5. expired, unknown, malformed, and already-used tokens receive the same neutral response;
6. inactive user, inactive membership, and inactive organization receive the neutral response;
7. other outstanding reset flows become unusable after successful redemption;
8. encrypted recovery material is wiped for redeemed and superseded flows;
9. all prior subject sessions receive 401, including a warmed cache entry;
10. another user's sessions remain valid;
11. completion and supersession audits exist only in the derived current organization scope;
12. login with the old password fails and login with the new password succeeds;
13. login, session, organization, refresh, logout, and unknown-token regressions remain green; and
14. synthetic identities, memberships, sessions, and reset flows are soft-cleaned while the
    CloudVault organization is retained.

Minimal Brightside remains limited to shell, known room, logout, and protected re-entry after the
CloudVault matrix is green. No customer reset flow, email address, document, or room inventory may
be inspected.

## 13. Strawman

- Two functions for one endpoint add catalog and repository surface.
- A candidate function creates a valid-token oracle before redemption.
- The stored selector is derived in the application rather than by PostgreSQL.
- The inert-first sequence requires two controlled deploys for one route.
- Reset issuance continues to use the administrative client after redemption is converted.
- Returning audit projection fields to server code is broader than writing audits inside the
  definer function.

## 14. Steelman

- The candidate function prevents invalid anonymous traffic from forcing bcrypt work while
  returning no identity or flow data. The endpoint already distinguishes valid redemption from an
  invalid token, so it does not introduce a new externally observable authorization fact.
- Keeping the HMAC key in the application preserves the existing cryptographic boundary. The
  database still owns the authoritative row match, one-time claim, subject derivation, and all
  security mutations.
- The redeem function has no caller-selected identity or scope arguments, so a compromised route
  cannot redirect a valid capability to another user.
- Audit inserts remain inside the same transaction without granting the no-login owner a new
  append capability on the audit table.
- Existing owner-only global revocation is reused as a composition primitive and never exposed to
  runtime.
- Inert-first follows the proven Unit 7 and Unit 8 pattern for a new write-capability family. It
  separates migration and privilege risk from the first live anonymous route cutover.
- The proposal does not hide the direct-table privilege gap. It preserves the live administrator
  cancellation path and makes full caller conversion a hard gate before privilege contraction.

## 15. Pre-mortem

| If                                                                    | Then                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| An invalid-token flood performs bcrypt work                           | Stop before deploy; candidate ordering or source guard is wrong                                            |
| A valid token resets a caller-selected user                           | Treat as a critical authorization incident; revoke the exact grant through the migrator path and roll back |
| Redemption deadlocks with issuance                                    | Roll back; reconcile account advisory and row-lock order before another deploy                             |
| Password changes but sessions or audits do not                        | Roll back; transaction-client composition or audit atomicity is broken                                     |
| Sessions are revoked but the password or token claim rolls back       | Roll back; the global primitive escaped the caller transaction                                             |
| A warmed Redis entry authorizes a revoked session                     | Roll back; live session resolution is no longer authoritative                                              |
| Unit 10 broadens direct runtime reset-table privileges                | Fail catalog acceptance and stop                                                                           |
| The function returns or logs a token, lookup, hash, or recovery field | Stop and treat as credential exposure                                                                      |
| Legacy valid tokens fail immediately after cutover                    | Roll back unless a separately approved drain gate proved no live legacy rows                               |
| Reset issuance is folded into the redemption deploy                   | Reject as out of scope unless a separate Advisor decision approves the larger delivery contract            |
| `DATABASE_URL_ADMIN` is removed during Unit 10                        | Unauthorized; restore configuration and stop                                                               |
| W1-3 enforcement is combined with Unit 10                             | Unauthorized; reject the deploy train                                                                      |

## 16. Rollout and rollback plan

### 16.1 Foundation deploy

1. human review of signatures, token grammar, lock order, column privileges, result envelope, and
   the unchanged direct-table privilege residual;
2. disable deploy workflow `251547585` and prove no active real deploy;
3. exact-head merge;
4. wait for exact-main CI and image publication while deployment remains disabled;
5. re-enable and prove no side-effect deploy;
6. dispatch exactly once for the accepted main SHA;
7. verify catalog and CloudVault regression smoke;
8. draft evidence; and
9. stop for written foundation close-out.

### 16.2 Route conversion

The later conversion repeats the same ceremony. It adds the two exact runtime grants, converts the
route, runs the full redemption matrix, performs minimal Brightside regression smoke, drafts
evidence, and stops for written close-out.

On route failure, restore the prior retained web revision. Keep the additive functions in place. Do
not grant the generic global revoke function or expand direct table privileges to make the route
work. Do not issue a second deployment without a new GO.

## 17. Remaining password-reset and W1-2 work

The redemption contract does not complete the password-reset family. Remaining web and worker
boundaries include:

- anonymous issuance by normalized email;
- administrator issuance bound to an active administrator credential and same-organization target;
- queue-accepted, queue-retry, provider-accepted, acceptance-unknown, and permanent-failure
  transitions;
- encrypted recovery and reconciler ownership under the worker role;
- cancellation of outstanding reset flows during email and account lifecycle changes; and
- conversion of every direct web reset-table caller before revoking the ordinary role's reset-table
  privileges; and
- final removal of administrative web access only after all remaining bootstrap families pass the
  complete CloudVault matrix.

The next issuance proposal should avoid accepting a caller-selected user ID for anonymous flows.
It should derive the subject from normalized email, return only minimum delivery projection, and
keep neutral HTTP behavior. Administrator issuance must bind the actor token in PostgreSQL and
derive the organization from that credential.

The planning estimate remains compatible with W1-2 close-out in the previously reported
2026-08-21 through 2026-08-27 window if the foundation and route conversion each pass one deploy
and the issuance, registration, and public viewer families do not expose new contract blockers.
This is a planning estimate, not a release commitment.

## 18. Decisions requested before implementation

1. Approve Unit 10 as an inert two-function redemption foundation with no runtime execution and no
   route conversion.
2. Approve the split token-validation boundary: application HMAC lookup derivation, followed by
   authoritative PostgreSQL row, state, identity, and one-time checks.
3. Approve a read-only candidate function to avoid anonymous invalid-token bcrypt amplification.
4. Approve strict legacy-token dual-read compatibility until all live legacy tokens expire.
5. Approve returning the minimum audit and cache-eviction envelope so the application can keep
   audit insertion atomic inside the surrounding transaction.
6. Confirm that direct `vaultspace_app` reset-table privileges remain an explicit residual in Unit
   10 and may be revoked only after administrator cancellation and account lifecycle callers are
   converted.
7. Keep anonymous issuance, administrator issuance, delivery transitions, admin URL removal, and
   W1-3 outside the Unit 10 foundation.

Until these decisions and a separate implementation GO are received, this document is analysis
only. It does not authorize a migration, runtime grant, route change, merge, deployment, Azure
change, credential change, admin-URL removal, or W1-3 work.

## References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_BULK_SESSION_REVOCATION_CONVERSION_PROPOSAL_2026-08-13_v1.md`
- `docs/W1_2_BOUNDED_BULK_SESSION_REVOCATION_IMPLEMENTATION_2026-08-13_v1.md`
- `docs/W1_2_BOUNDED_BULK_SESSION_REVOCATION_DEPLOYMENT_EVIDENCE_2026-08-13_v1.md`
- `prisma/schema.prisma`
- `prisma/rls-policies.sql`
- `prisma/migrations/20260812210000_w1_2_session_mutation_foundation/migration.sql`
- `prisma/migrations/20260813050000_w1_2_bounded_bulk_session_revocation/migration.sql`
- `scripts/rls-fix.ts`
- `scripts/setup-rls-test-db.ts`
- `src/lib/db.ts`
- `src/lib/audit/securityAudit.ts`
- `src/lib/auth/passwordResetToken.ts`
- `src/lib/auth/passwordResetDeliveryContract.ts`
- `src/lib/auth/passwordResetRecovery.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/sessionMutationRepository.ts`
- `src/app/api/auth/forgot-password/route.ts`
- `src/app/api/auth/reset-password/route.ts`
- `src/app/api/users/[userId]/reset-password/route.ts`
- `src/app/api/users/[userId]/route.ts`
- `src/workers/passwordResetReconciler.ts`
- `src/workers/processors/emailProcessor.ts`
- `src/workers/processors/passwordResetDeliveryProcessor.ts`
