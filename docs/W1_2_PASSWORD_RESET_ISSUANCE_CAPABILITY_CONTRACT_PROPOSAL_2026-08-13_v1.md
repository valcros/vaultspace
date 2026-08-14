# W1-2 Unit 12 Password Reset Issuance Capability Contract Proposal

- Date: 2026-08-13
- Advisor authorization: ADV-2026-08-13-15
- Unit: W1-2 Unit 12
- Status: Analysis only, implementation GO requested
- Starting main: `0eb613b557f8547a829947163589bc1da49db3c2`
- Unit 11 live release: `5d63d4b73126de088aa42ce2fa6a382683f63de9`
- Unit 11 live web revision: `ca-vaultspace-web--0000301`
- Unit 11 live worker revision: `ca-vaultspace-worker--0000284`
- Security freeze: Active
- Admin database URL: Retained
- W1-3: Not started

## 1. Recommendation

Implement Unit 12 as an inert password-reset issuance foundation containing three bounded
`SECURITY DEFINER` functions and one recovery-envelope compatibility expansion:

1. an anonymous issuance function that derives the subject only from a normalized email;
2. an administrator recipient-preparation function bound to an active ADMIN bearer credential;
3. an administrator issuance function that revalidates the same credential, target, organization,
   and authoritative recipient under locks; and
4. a version 2 encrypted recovery envelope that can be created before anonymous subject discovery
   without returning a user ID or email from PostgreSQL.

All three functions should be owner-only and unrouted in Unit 12. `vaultspace_app` should retain
execution on exactly the eleven Unit 11 functions. No application route, queue lifecycle edge,
worker, table privilege, environment variable, or live response should change in this foundation
unit.

After Unit 12 is deployed and catalog-proven, one separately authorized route-conversion unit can
grant the three exact functions and convert both issuance routes. That later unit should require
HMAC token writes and asynchronous delivery. It should queue only a flow ID and leave delivery
state transitions to the existing recovery worker or separately bounded transition functions.

This phasing preserves the proven inert-then-route pattern and isolates the largest unresolved
policy question: a tenant administrator must not create or supersede an account-global reset flow
for a user who has any second organization membership. A multi-organization user remains able to
use the neutral self-service route. A future system-operator contract may authorize broader
administrative action.

## 2. Current accepted posture

Unit 11 is acceptance-closed at release
`5d63d4b73126de088aa42ce2fa6a382683f63de9`, web revision
`ca-vaultspace-web--0000301`, and worker revision `ca-vaultspace-worker--0000284`.

The current production catalog and application posture are:

- `vaultspace_app` can execute exactly eleven approved `bootstrap_*` functions;
- password-reset candidate and redemption functions are routed through the ordinary runtime
  database client;
- generic organization and global session revocation functions remain owner-only;
- `vaultspace_bootstrap_owner` remains NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS,
  NOCREATEDB, NOCREATEROLE, and NOREPLICATION;
- the owner has no direct or transitive memberships and no table-level write privileges;
- all 152 reviewed runtime reset ACL keys remain preserved;
- `POST /api/auth/forgot-password` still uses `bootstrapDb` for account discovery, issuance, and
  delivery lifecycle writes;
- `POST /api/users/:userId/reset-password` still uses `bootstrapDb` for credential revalidation,
  target authorization, issuance, and delivery lifecycle writes;
- password-reset delivery workers use their constrained worker database identity, without
  `DATABASE_URL_ADMIN`;
- `DATABASE_URL_ADMIN` remains configured on the public web workload; and
- rollback web revision `ca-vaultspace-web--0000300` and worker revision
  `ca-vaultspace-worker--0000283` remain retained.

Unit 12 must not reopen Unit 11 or alter its two redemption function bodies.

## 3. Current issuance inventory

### 3.1 Anonymous issuance

The anonymous route currently performs these operations through the administrative client:

1. normalize and validate the submitted email;
2. enforce email-fingerprint and IP rate limits;
3. look up the user and active organization memberships;
4. acquire the account-global advisory lock and lock user, membership, and organization rows;
5. revalidate the authoritative email, active account, and active audit scope;
6. select an optional sender organization from the custom-host slug or a single membership;
7. generate a public token, stored HMAC lookup, flow ID, expiry, and encrypted recovery envelope;
8. supersede older unused reset flows and wipe their encrypted recovery material;
9. insert the new token and recovery rows;
10. insert request and supersession security audits;
11. queue an asynchronous delivery job using only the flow ID; and
12. update queue lifecycle fields after the external queue operation.

The route returns the same success body for an unknown account, an ineligible account, rate-limit
denial, and successful issuance. It enforces a minimum response duration. That neutrality must be
preserved.

### 3.2 Administrator issuance

The administrator route currently performs these operations through the administrative client:

1. resolve the current session and check the projected ADMIN role;
2. lock the target account and the actor and target rows;
3. revalidate the actor account, session organization, membership, role, and organization;
4. revalidate the target account and target membership in the actor organization;
5. build an account-global audit scope from active memberships;
6. enforce a one-minute target cooldown;
7. generate the token and encrypted recovery envelope;
8. supersede older flows and create the new flow;
9. write request and supersession audits across the captured organization scope;
10. queue asynchronous delivery; and
11. perform direct reset-table delivery lifecycle writes.

The current route allows an administrator to issue a global reset for a multi-organization target.
Although the link is delivered only to the target's authoritative email, issuance immediately
supersedes every existing reset flow for that identity. One tenant can therefore disrupt a reset
already initiated through another tenant. The proposed contract closes that cross-tenant lifecycle
effect by applying the established all-memberships single-organization invariant.

### 3.3 Delivery and lifecycle callers

Issuance is not the only reset-table writer. Queue acceptance, queue failure, provider submission,
provider acceptance, retry, cancellation, reconciliation, email change, membership change, and
account lifecycle paths still read or mutate reset token or recovery state.

Unit 12 cannot revoke the direct runtime reset-table privilege residual or remove
`DATABASE_URL_ADMIN`. Those contractions require every public-web lifecycle caller to use a
bounded function or to delegate the transition to the constrained worker.

## 4. Unit boundary

### 4.1 In scope

- Create three inert password-reset issuance functions with exact signatures and contract markers.
- Add only the column-scoped owner privileges required to insert issuance rows.
- Preserve zero table-level INSERT, UPDATE, or DELETE privileges for the function owner.
- Preserve zero DELETE privileges on reset tokens and recoveries.
- Add recovery-envelope cipher version 2 writer and dual-version reader support.
- Add a typed, unrouted `PasswordResetIssuanceCapabilityRepository`.
- Add real-role PostgreSQL tests for anonymous and administrator contracts.
- Add source and catalog tests proving zero runtime grants and no live repository imports.
- Preserve the exact eleven-function runtime matrix.
- Perform one controlled foundation deployment after a separate Advisor premerge GO.

### 4.2 Explicitly out of scope

- granting any Unit 12 function to `vaultspace_app`;
- converting either issuance route;
- changing public HTTP response bodies or status behavior;
- changing rate-limit policy;
- changing queue, provider, reconciler, or delivery-worker routing;
- converting direct delivery lifecycle transitions;
- converting administrator email, membership, two-factor, or account-lifecycle cancellation;
- revoking any existing direct runtime reset-table privilege;
- removing `DATABASE_URL_ADMIN`;
- adding a system-operator reset contract;
- changing the two Unit 10 redemption function bodies;
- registration, two-factor completion, public-link, viewer-session, or access-request conversion;
- web entrypoint or migrator-job cutover;
- workflow path-filter changes;
- W1-3, FORCE RLS changes, or bootstrap-policy removal; and
- P0-4 changes.

## 5. Threat model and binding rules

### 5.1 Anonymous boundary

An anonymous caller may choose only an email string. The caller must not choose a user ID,
organization ID, audit scope, sender identity, reset subject, or supersession scope.

The anonymous binding rule is:

> PostgreSQL derives the reset subject, authoritative email match, active membership scope, sender
> organization eligibility, and supersession scope from locked database rows selected only by the
> normalized email. A no-row result is externally indistinguishable from successful issuance.

The application may generate random credential material and encrypt its public token, but that
material cannot assert an identity. A submitted organization slug is a sender-branding hint only.
PostgreSQL may use it only when it matches an active organization membership derived for the
subject.

### 5.2 Administrator boundary

An administrator may select a target user ID because the target is already an organization member
visible in the authenticated administration interface. The target ID is not authorization.

The administrator binding rule is:

> PostgreSQL derives the actor, actor organization, active ADMIN authority, and current target
> membership from the exact live bearer credential. It permits global reset issuance only when the
> target has exactly one membership row across all organizations and that membership is the active
> actor organization.

The membership count includes active and inactive rows. This matches the Unit 9 global-action
invariant and prevents a dormant second membership from being ignored.

### 5.3 Shared threats

The functions must defend against:

- account enumeration through response bodies, result metadata, logs, or timing;
- application-supplied user or organization scope in anonymous issuance;
- stale actor projections after role revocation or session invalidation;
- cross-tenant administrative issuance or supersession;
- token creation for inactive users or users without an active organization;
- a stale email read followed by encryption or issuance after an email change;
- concurrent anonymous and administrator requests creating multiple current flows;
- caller-selected expiry, provider state, or delivery attempt counters;
- legacy plaintext token writes after the HMAC rollout;
- raw public tokens entering PostgreSQL, logs, audits, queue payloads, or result envelopes;
- owner access to unrelated user, membership, session, or provider evidence fields;
- audit failure committing issuance without the required audit facts; and
- a route using `bootstrapDb` as a silent fallback when a function denies a request.

## 6. Recovery envelope version 2

### 6.1 Why version 1 is insufficient for anonymous capability issuance

The current encrypted recovery AAD includes `userId`. An anonymous route cannot construct that
envelope until it performs a privileged identity lookup. Returning `userId` from a public
email-candidate function would turn the runtime SQL API into an account-enumeration primitive.

Unit 12 should add cipher version 2 with AAD that excludes identity fields:

- contract purpose and cipher version;
- recovery key ID;
- flow ID;
- stored HMAC lookup;
- provider operation ID, which must equal the flow ID; and
- recipient fingerprint.

The application already knows the normalized email submitted to the anonymous route. It can create
the recipient fingerprint and encrypted token before calling PostgreSQL without knowing whether
the account exists. For administrator issuance, the bounded recipient-preparation function returns
the authoritative email only after proving current ADMIN authority and same-organization target
membership.

### 6.2 Database and worker binding

The issuance function must require:

- cipher version 2;
- a current `prh1:` stored token lookup;
- a valid flow ID and provider operation ID that are identical;
- exact key ID, nonce, ciphertext, authentication tag, and fingerprint shapes;
- an authoritative normalized email equal to the locked user email; and
- asynchronous delivery contract marker version 1.

The constrained worker remains the only component that decrypts the public token. Before provider
submission it must:

1. lock the current flow and subject;
2. require the flow to be current, unused, and unexpired;
3. derive the current recipient email from the locked user row;
4. recompute and compare the recipient fingerprint;
5. verify the version 2 AAD and stored-token binding;
6. verify that the decrypted public token maps to the stored HMAC lookup; and
7. cancel and wipe the flow on any mismatch.

The reader must continue accepting version 1 envelopes until every live version 1 flow expires or
reaches a terminal state. Unit 12 must not rewrite existing rows.

### 6.3 Prohibited alternatives

The design must not:

- pass the raw public token or encryption key to PostgreSQL;
- return a user ID or email from anonymous candidate lookup;
- weaken encryption to avoid subject discovery;
- create token and recovery rows in separate transactions;
- store the raw token in Redis or a queue payload; or
- repurpose a legacy plaintext token writer.

## 7. Proposed SQL contracts

Exact byte and identifier limits should be copied from the current schema and crypto helpers into
the implementation migration. The signatures below are the proposed reviewed API surface.

### 7.1 Anonymous issue

Proposed signature:

`public.bootstrap_password_reset_issue_anonymous_v1(text, text, text, text, text, integer, text, bytea, bytea, bytea, text)`

Parameter order:

1. `input_normalized_email text`;
2. `input_requested_sender_org_slug text`, nullable;
3. `input_flow_id text`;
4. `input_stored_token text`;
5. `input_request_id text`;
6. `input_cipher_version integer`;
7. `input_key_id text`;
8. `input_nonce bytea`;
9. `input_ciphertext bytea`;
10. `input_auth_tag bytea`; and
11. `input_recipient_fingerprint text`.

The function should be `VOLATILE`, `PARALLEL UNSAFE`, `SECURITY DEFINER`, and configured with
`search_path=pg_catalog`. It must use fully qualified static SQL and no dynamic SQL.

The function must:

1. validate normalized lowercase email, flow, request, stored-token, and envelope shapes;
2. derive the active subject only by exact normalized email;
3. acquire the account-global advisory lock for the derived subject;
4. lock and revalidate the user, every membership, and every referenced organization in
   deterministic `pg_catalog."C"` order;
5. require one through 64 active memberships in active organizations;
6. derive the immutable audit scope from those active memberships;
7. accept the sender slug only if it matches one derived active membership;
8. otherwise select the only active organization when exactly one exists, or store no sender
   organization for a multi-organization account;
9. enforce a database-side one-minute issuance cooldown;
10. supersede every unused flow for the derived subject and wipe its recovery material;
11. insert exactly one HMAC reset row with a database-derived one-hour expiry;
12. insert exactly one version 2 recovery row with provider operation ID equal to the flow ID; and
13. return one minimal success envelope, or no row for every neutral denial.

It must not return the subject user ID, email, first name, organization name, organization slug,
sender address, sender name, token lookup, recovery material, membership role, or denial reason.

### 7.2 Administrator recipient preparation

Proposed signature:

`public.bootstrap_password_reset_admin_recipient_v1(text, text)`

Parameters:

1. `input_actor_token text`; and
2. `input_target_user_id text`.

This function should be `STABLE`, `PARALLEL UNSAFE`, `SECURITY DEFINER`, and configured with
`search_path=pg_catalog`.

It must:

1. validate the exact current bearer-token shape;
2. resolve an active, unexpired actor session;
3. derive the actor user and organization from that session;
4. require an active actor account, active organization, active membership, and ADMIN role;
5. require the target to have exactly one membership row across all organizations;
6. require that membership, target account, and organization to be active;
7. require the target organization to equal the actor organization; and
8. return only `authorization_proven=true` and the authoritative normalized recipient email, or no
   row.

The email is returned only to an already authenticated administrator authorized for that exact
single-organization target. It exists solely to build the version 2 recovery envelope. It must not
be logged, included in audit metadata, or returned by the HTTP route.

The preparation result is not authorization to issue. The mutation function repeats every check
under locks and requires the exact expected email.

### 7.3 Administrator issue

Proposed signature:

`public.bootstrap_password_reset_issue_admin_single_org_v1(text, text, text, text, text, text, integer, text, bytea, bytea, bytea, text)`

Parameter order:

1. `input_actor_token text`;
2. `input_target_user_id text`;
3. `input_expected_normalized_email text`;
4. `input_flow_id text`;
5. `input_stored_token text`;
6. `input_request_id text`;
7. `input_cipher_version integer`;
8. `input_key_id text`;
9. `input_nonce bytea`;
10. `input_ciphertext bytea`;
11. `input_auth_tag bytea`; and
12. `input_recipient_fingerprint text`.

The function should be `VOLATILE`, `PARALLEL UNSAFE`, `SECURITY DEFINER`, and configured with
`search_path=pg_catalog`.

It must:

1. perform candidate discovery only to derive the target advisory-lock key;
2. acquire the target account-global advisory lock;
3. lock actor and target users in deterministic ID order;
4. lock the actor session, all target memberships, and relevant organizations in deterministic
   order;
5. repeat active session, active actor, active ADMIN membership, active organization, target
   membership, and exact single-organization checks;
6. require the locked target email to equal `input_expected_normalized_email`;
7. enforce the database-side one-minute target cooldown;
8. derive the actor organization as the only sender and audit organization;
9. supersede and wipe existing unused flows for the target;
10. insert the new HMAC reset and version 2 recovery rows; and
11. return one minimal success envelope, or no row for stale, unauthorized, ineligible, or
    concurrent denial.

The actor token is an input proof, not a result. The function must never return it, log it, store it
on a reset row, or copy it into audit metadata.

### 7.4 Minimal result envelopes

The anonymous issue function may return only:

- `authorization_proven boolean`, which must be true;
- `flow_id text`;
- `audit_organization_ids text[]`, canonical and unique;
- `superseded_flow_ids text[]`; and
- `superseded_request_ids text[]`, positionally paired with superseded flow IDs.

The administrator issue function may return the same fields. For a successful administrator call,
the audit organization array contains exactly the actor organization.

No result may include a public token, stored lookup, recovery material, target identity, actor
token, password field, session token, or unrelated branding field.

## 8. Transaction and audit composition

### 8.1 Foundation posture

Unit 12 deploys the functions owner-only and does not route them. Repository calls exist only in
focused tests. No live transaction composition changes in this unit.

### 8.2 Route-conversion preview

In a later route unit, each issuance should execute inside one ordinary-role Prisma transaction:

1. establish the no-organization bootstrap context;
2. call the bounded issuance function;
3. receive only the minimal database-proven result;
4. set transaction-local organization context from the returned canonical audit scope;
5. insert request and supersession audit events; and
6. commit issuance and audits together.

An audit failure must roll back token creation, recovery creation, and supersession. No nested
`withOrgContext` transaction is allowed.

For anonymous issuance, audit metadata should identify the flow and `initiation=SELF_SERVICE` but
omit a target user ID. The flow row retains the protected subject relationship for authorized
investigation without exposing identity through the capability result.

For administrator issuance, the target ID is an authenticated route parameter and becomes trusted
only after `authorization_proven=true`. The event records the actor from the validated server
session projection and the same organization returned by the function.

Request IP and user agent remain application telemetry. They are not authorization inputs.

## 9. Queue and delivery boundary

Unit 12 does not alter queue behavior. The route-conversion follow-up should use only HMAC mode and
asynchronous delivery:

- the app creates a version 2 envelope and calls the issuance function;
- after database commit, the app queues `password-reset.deliver` with schema version, flow ID, and
  delivery attempt only;
- the queue payload contains no public token, email, user ID, organization ID, or recovery field;
- a stable job ID provides idempotency;
- a queue failure leaves the protected PENDING recovery row available to the existing reconciler;
- a fast worker may advance directly from PENDING without a web status write; and
- all provider and recovery transitions remain worker-owned until separately converted.

If implementation analysis proves that a web queue-correlation update is required, it must use a
separately reviewed flow-bound transition function. Direct reset-table writes are not an acceptable
fallback.

The administrator synchronous-delivery branch should not be carried into the route conversion.
Current HMAC issuance already requires asynchronous delivery, and the worker owns recipient and
sender resolution under locks.

## 10. Database privilege design

### 10.1 Owner privileges

The Unit 12 migration may add only the exact column-scoped privileges required by the three
functions. Expected additions include:

- column INSERT on the reviewed reset-token creation columns;
- column INSERT on the reviewed recovery creation columns; and
- any missing narrow SELECT columns required for authoritative email and sender eligibility.

Existing column-scoped UPDATE privileges for supersession and recovery wipe may be reused only
after an exact prestate assertion.

The owner must retain:

- zero table-level INSERT, UPDATE, or DELETE on reset tables;
- zero DELETE privilege at table or column scope;
- zero provider-correlation or provider-inbox write access;
- zero event-table append privilege;
- zero password or session mutation beyond already accepted functions;
- zero role memberships after the temporary migration grant is revoked; and
- NOLOGIN and NOBYPASSRLS posture.

### 10.2 Runtime posture

Unit 12 must grant no new runtime execution. Production acceptance requires:

- `vaultspace_app` EXECUTE on exactly the eleven Unit 11 functions;
- `vaultspace_app` EXECUTE denied on all three Unit 12 functions;
- PUBLIC EXECUTE denied on every `bootstrap_*` function;
- generic session revocation primitives owner-only;
- exact preservation of the 152-key runtime reset ACL residual; and
- no owner role reachability from runtime or migrator identities after migration.

### 10.3 Future route grant

A later Advisor-authorized route unit may grant only the three exact Unit 12 signatures. The
runtime function matrix would then increase from eleven to fourteen. That route unit must fail
closed if any additional `bootstrap_*` grant exists.

## 11. Locking and concurrency

The implementation must preserve the established lock hierarchy:

1. candidate discovery only as needed to derive the account lock key;
2. account-global advisory lock for the target user;
3. user rows in deterministic `pg_catalog."C"` order;
4. actor session when applicable;
5. all target memberships in organization-ID order;
6. relevant organizations in ID order;
7. existing reset flows in flow-ID order; and
8. matching recovery rows in flow-ID order.

Every authorization and eligibility fact must be repeated after the advisory and row locks.

Concurrent anonymous and administrator issuance must produce at most one current flow. The winner
supersedes older flows atomically. A loser must return no row or a reviewed categorical admin
cooldown result without leaving partial writes.

The database derives the one-hour expiry from `statement_timestamp()`. The application cannot
choose expiry or created-at values.

## 12. Response and observability contract

### 12.1 Anonymous response neutrality

The later anonymous route conversion must preserve:

- the same HTTP success status and body for known and unknown emails;
- the same response for inactive, no-membership, over-scope, cooldown, and race denial;
- the existing minimum response duration;
- fail-closed rate-limit behavior with a neutral response; and
- no organization, flow, user, delivery, or denial details in the response.

Internal logs may contain only categorical outcome, request ID, route type, and cardinality bucket.
They must not contain email, email fingerprint, target ID, actor token, flow ID for neutral denial,
stored token, public token, recovery material, or raw database errors.

### 12.2 Administrator response

The later administrator route may preserve explicit authenticated status categories, but it must
map target-not-found, target-out-of-organization, multi-organization target, and stale candidate to
a reviewed non-enumerating contract. It must not echo the authoritative recipient email returned by
the preparation function.

### 12.3 Credential handling

No public token, stored lookup, bearer token, recovery key, recovery ciphertext, recipient email,
or database connection string may appear in logs, CI output, evidence, PR text, audit metadata, or
exceptions.

## 13. Application repository design

Add an unrouted `PasswordResetIssuanceCapabilityRepository` using the ordinary `db` client. It
should expose three methods:

- `issueAnonymous(input)`;
- `prepareAdminRecipient(actorToken, targetUserId)`; and
- `issueAdminSingleOrg(input)`.

The repository must:

- call only the exact, schema-qualified function signatures;
- strictly validate result cardinality and every field shape;
- reject duplicate, unsorted, mismatched, or oversized arrays;
- require `authorization_proven=true`;
- reject an anonymous result containing any unexpected identity field;
- reject a successful admin result whose audit scope cardinality is not exactly one;
- return `null` for no row;
- avoid logging input or row data; and
- have no `bootstrapDb`, Prisma model call, dynamic SQL, or fallback path.

Unit 12 source tests must prove that no production route or worker imports this repository.

## 14. Foundation migration design

The migration should:

1. run the migration-credential preflight outside the DDL transaction;
2. assert the exact eleven-function runtime prestate;
3. assert owner attributes, memberships, privileges, policies, and function checksums;
4. snapshot the 152-key runtime reset ACL residual with explicit
   `COLLATE pg_catalog."C"` ordering;
5. add only reviewed column privileges and owner-specific RLS policies;
6. create the three functions with exact signatures and contract markers;
7. revoke all three functions from PUBLIC and `vaultspace_app`;
8. use a temporary role membership only to transfer function ownership;
9. revoke that membership and schema CREATE immediately;
10. prove exact source checksums, signatures, volatility, language, security mode, and search path;
11. prove the exact eleven-function runtime poststate;
12. prove the three new functions are owner-only;
13. prove the runtime reset ACL residual is byte-for-byte unchanged; and
14. fail closed on any catalog drift.

The migration must not alter an applied historical migration.

## 15. Test strategy

### 15.1 Static and unit tests

Add tests that prove:

- version 2 encryption can be created without a user ID;
- version 1 and version 2 recovery readers remain compatible;
- a version 2 envelope is bound to flow ID, stored lookup, operation ID, and recipient fingerprint;
- wrong email, key, token, flow, lookup, or fingerprint fails closed;
- repository result validation rejects malformed or identity-bearing anonymous results;
- all three functions are owner-only in the foundation migration;
- the exact eleven-function runtime matrix is unchanged;
- no live source imports the new repository; and
- no Unit 12 file contains `DATABASE_URL_ADMIN` or a raw credential value.

### 15.2 Real-role PostgreSQL matrix

Use disposable PostgreSQL 15 containers with the real migration owner, runtime role, and no-login
function owner. At minimum, prove:

1. anonymous known active email creates one current HMAC flow and version 2 recovery row;
2. unknown email returns no row and writes nothing;
3. inactive account, no active membership, inactive organization, and audit scope above 64 deny;
4. the anonymous result contains no identity or delivery PII;
5. sender slug acts only as a validated membership hint;
6. a multi-organization anonymous account receives a canonical audit scope and no arbitrary sender;
7. cooldown and concurrent issuance leave at most one current flow;
8. superseded flows are marked used and their recovery material is wiped;
9. invalid envelope and token shapes fail before writes;
10. administrator preparation denies invalid, expired, revoked, or wrong-role credentials;
11. administrator preparation denies a target outside the actor organization;
12. administrator preparation and issuance deny every multi-organization target, counting inactive
    memberships;
13. a valid single-organization administrator can prepare and issue for an active member;
14. an email change between preparation and issuance causes no-row denial and no writes;
15. role, session, membership, target, or organization changes between pre-read and lock deny;
16. an administrator cannot choose another organization or audit scope;
17. audit insertion failure in a simulated route transaction rolls issuance back;
18. `vaultspace_app` cannot execute any new function;
19. PUBLIC cannot execute any new function;
20. owner table-level writes and DELETE remain denied; and
21. the complete migration chain and Azure-like migrator execution pass.

### 15.3 CloudVault foundation regression

The inert foundation deployment requires only regression verification:

1. health and exact release identity;
2. migration applied and exact eleven-function runtime matrix;
3. all three Unit 12 functions owner-only and unrouted;
4. CloudVault login, session resolve, and organization resolve;
5. current password-reset redemption regression; and
6. logout followed by protected-route denial.

No live issuance call through a Unit 12 function is authorized during the foundation deployment.

### 15.4 Route-conversion acceptance preview

The separately authorized route unit should cover:

- neutral anonymous known and unknown email behavior;
- one synthetic anonymous email delivery and redemption;
- invalid and stale flow denial;
- single-organization admin issuance;
- non-admin, wrong-org, inactive, and multi-organization admin denial;
- issuance concurrency and cooldown;
- supersession and audit atomicity;
- queue failure recovery without web direct-table writes;
- prior eleven-function regression;
- exact fourteen-function catalog posture; and
- minimal Brightside shell, known room, logout, and protected re-entry smoke.

## 16. Rollout and rollback

### 16.1 Unit 12 foundation

Use the established controlled sequence:

1. human review of function signatures, envelope v2, privileges, and source checksums;
2. disable deploy workflow 251547585 and confirm zero active deploys;
3. exact-head guarded squash merge;
4. wait for exact-main CI and both image publications while deployment is disabled;
5. re-enable the workflow and verify no side-effect deployment;
6. issue one manual staging dispatch;
7. verify catalog posture and CloudVault regression;
8. open a draft evidence PR; and
9. stop for written Advisor close-out.

Because the functions are owner-only and unrouted, application rollback leaves no live caller.
Database rollback should not drop the functions or rewrite the applied migration. A subsequent
tracked migration may remove an unused foundation only after a separate review.

### 16.2 Later route conversion

The route unit should use the same controlled sequence with one dispatch. On authentication,
issuance, cross-tenant, or delivery regression, roll back web and worker traffic to the retained
pre-route revisions. Do not grant broader table access or reintroduce `bootstrapDb` as a silent
fallback.

Retain web revision `ca-vaultspace-web--0000300` and worker revision
`ca-vaultspace-worker--0000283` through at least the Unit 12 foundation and the subsequent issuance
route deployment.

## 17. Residual risk after Unit 12

Even after an accepted inert foundation:

- both issuance routes remain on established administrative paths;
- `vaultspace_app` has no execution grant on the three new functions;
- public-web delivery lifecycle transitions remain unconverted;
- administrator email, membership, two-factor, and account lifecycle routes still cancel reset
  flows directly;
- password-reset workers retain their established constrained data access;
- the 152-key runtime reset-table privilege residual remains;
- registration, two-factor completion, public links, viewer sessions, and access requests remain
  open as applicable;
- migrator-job and web-entrypoint cutover remain open if not already completed;
- `DATABASE_URL_ADMIN` remains on the web workload;
- the full replacement auth matrix is incomplete; and
- W1-3 remains not started.

## 18. Strawman

- Three functions plus recovery-envelope v2 make this foundation larger than the redemption
  foundation.
- An authenticated administrator preparation call returns an email to application memory.
- The single-organization restriction changes current multi-organization administrator behavior.
- PostgreSQL cannot validate the AES-GCM ciphertext contents before the worker decrypts them.
- Queue and provider transitions remain a direct-privilege residual after issuance contracts exist.
- Anonymous issuance still has an internal row/no-row branch even though the HTTP response is
  neutral.

## 19. Steelman

- Anonymous SQL results contain no subject identity, while the encrypted bearer remains outside
  PostgreSQL.
- The version 2 envelope removes the need for a privileged anonymous identity pre-read.
- The administrator email projection is exact-target, credential-bound, and revalidated before
  mutation.
- Counting all memberships applies the same cross-tenant invariant already accepted for global
  session action.
- Token, recovery, supersession, and future atomic audits retain one account-global transaction.
- Owner-only foundation deployment isolates DDL, RLS, crypto-compatibility, and privilege risk from
  live route behavior.
- The existing worker already consumes a flow-ID-only job and is the natural authority for
  recipient and provider lifecycle state.
- Explicitly retaining the reset-table residual prevents an incomplete privilege contraction from
  being mistaken for W1-2 completion.

## 20. Pre-mortem

| If                                                            | Then                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Anonymous result exposes user ID or email                     | Treat as a critical enumeration defect; do not merge                  |
| Version 2 cannot decrypt under the retained worker key ring   | Stop at local tests; do not deploy the foundation                     |
| A multi-organization admin target can be issued a flow        | Fail contract tests and catalog acceptance                            |
| Wrong recipient data produces a deliverable token             | Treat as a critical identity-binding defect                           |
| Concurrent issuance leaves two current flows                  | Fix locking and repeat the real-role race matrix                      |
| The owner gains table-level write or DELETE                   | Fail migration acceptance and stop                                    |
| `vaultspace_app` gains any Unit 12 EXECUTE                    | Fail catalog acceptance and stop                                      |
| Existing eleven-function matrix drifts                        | Fail migration preflight; no DDL or manual repair                     |
| Foundation code becomes reachable from a live route           | Stop; the unit is no longer inert                                     |
| Route conversion later requires direct queue lifecycle writes | Add a separate bounded transition design; no fallback                 |
| Anonymous timing distinguishes account state                  | Preserve minimum duration and compare live distribution before GO     |
| A migration fails in staging                                  | Stop after transactional rollback; diagnose through tracked code only |

## 21. Acceptance criteria for Unit 12

Unit 12 is acceptance-ready only when:

- exact-head CI is green;
- the full PostgreSQL 15 migration chain passes;
- recovery-envelope versions 1 and 2 pass crypto compatibility tests;
- all three function bodies and exact signatures match the reviewed migration;
- all three functions are owner-only and unrouted;
- `vaultspace_app` EXECUTE remains exactly the eleven Unit 11 functions;
- PUBLIC EXECUTE remains denied on every `bootstrap_*` function;
- owner attributes, memberships, and table-level privilege posture are unchanged;
- the 152-key runtime reset ACL residual is unchanged;
- no production source imports the issuance repository;
- CloudVault foundation regression is green;
- `DATABASE_URL_ADMIN` remains present;
- retained rollback revisions remain available;
- one evidence PR is open; and
- written Advisor close-out is received.

Unit 12 closes only the inert anonymous and administrator issuance capability foundation. It does
not close issuance routing, delivery transitions, reset-table privilege contraction, overall W1-2,
admin URL removal, or W1-3.

## 22. Decisions requested

1. Approve Unit 12 as an inert three-function issuance foundation with zero runtime grants and zero
   route changes.
2. Approve recovery-envelope cipher version 2 with no user ID in AAD and dual-version worker read
   compatibility.
3. Approve `bootstrap_password_reset_issue_anonymous_v1` deriving identity only from locked
   normalized email and returning no identity field.
4. Approve `bootstrap_password_reset_admin_recipient_v1` as a credential-bound minimal email
   preparation projection for an exact single-organization target.
5. Approve `bootstrap_password_reset_issue_admin_single_org_v1` with complete revalidation under
   locks and no caller-selected organization or audit scope.
6. Approve counting all active and inactive target memberships and denying tenant-admin issuance
   for every multi-organization target.
7. Confirm that multi-organization users use self-service reset unless a future system-operator
   contract is separately approved.
8. Approve HMAC-only, asynchronous-only issuance for the later route conversion, with a flow-ID-only
   queue payload.
9. Approve future ordinary-role transaction composition so function mutation and security audits
   commit atomically.
10. Confirm direct reset-table runtime privileges remain an explicit residual until delivery and
    account-lifecycle callers are converted.
11. Keep `DATABASE_URL_ADMIN`, other auth families, entrypoint changes, and W1-3 outside Unit 12.
12. Require a new Advisor premerge checkpoint before foundation merge or deployment.

Until these decisions and a separate implementation GO are received, this proposal authorizes no
schema, grant, route, worker, environment, deployment, or cleanup change.

## 23. References

- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_PASSWORD_RESET_CAPABILITY_CONTRACT_PROPOSAL_2026-08-13_v1.md`
- `docs/W1_2_PASSWORD_RESET_ROUTE_CONVERSION_PROPOSAL_2026-08-13_v1.md`
- `docs/W1_2_PASSWORD_RESET_ROUTE_CONVERSION_IMPLEMENTATION_2026-08-13_v1.md`
- `docs/password-reset-delivery-contract-rollout.md`
- `src/app/api/auth/forgot-password/route.ts`
- `src/app/api/auth/forgot-password/route.test.ts`
- `src/app/api/users/[userId]/reset-password/route.ts`
- `src/app/api/users/[userId]/reset-password/route.test.ts`
- `src/app/api/users/[userId]/route.ts`
- `src/lib/auth/passwordResetCapabilityRepository.ts`
- `src/lib/auth/passwordResetDeliveryContract.ts`
- `src/lib/auth/passwordResetRecovery.ts`
- `src/lib/auth/passwordResetToken.ts`
- `src/lib/auth/sessionMutationRepository.ts`
- `src/lib/db.ts`
- `src/lib/middleware/auth.ts`
- `src/workers/processors/passwordResetDeliveryProcessor.ts`
- `src/workers/passwordResetReconciler.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260813050000_w1_2_bounded_bulk_session_revocation/migration.sql`
- `prisma/migrations/20260813150000_w1_2_password_reset_redemption_foundation/migration.sql`
- `prisma/migrations/20260813220000_w1_2_password_reset_redemption_route_conversion/migration.sql`
