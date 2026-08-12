# W1-2 Session Resolve Route Conversion Deployment Evidence

- **Date:** 2026-08-12
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Session-resolve read-path conversion
- **Source PR:** #135
- **Reviewed source head:** `591d187f94d14761819306a3189331fa9271fca9`
- **Merge commit and deployed release:** `0d97aca143c1bb46a251856e1b34989694884a8a`
- **Exact-head PR CI:** `31618820720`, success
- **Exact-main CI:** `31620380130`, success
- **Deployment:** `31621191580`, success
- **Live web revision:** `ca-vaultspace-web--0000291`
- **Result:** Deployment, catalog posture, CloudVault session-family matrix, and bounded Brightside
  smoke green
- **W1-2 Unit 5 status:** Technical acceptance criteria met, pending written Advisor close-out
- **W1-2 overall status:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Scope and boundary

This unit converted only the established session read paths to the constrained session-resolve
bootstrap function. It:

- granted `vaultspace_app` EXECUTE on exactly
  `public.bootstrap_session_resolve_v1(text)` in addition to the already accepted login grant;
- retained `PUBLIC` denial;
- converted `validateSession` and `getServerComponentSession` to use the runtime-backed
  `BootstrapRepository` session projection;
- required a current live database projection before Redis could authorize a session;
- compared cached and live security fields before accepting cached session data; and
- preserved idle expiry, absolute expiry, active-user, active-membership, and active-organization
  checks.

This unit did not:

- grant runtime EXECUTE on `public.bootstrap_organization_resolve_v1(text, text)`;
- convert session creation, activity refresh, logout, revocation, or bulk invalidation;
- convert organization resolution, domain middleware, branding, two-factor completion, password
  reset, registration, links, or any other route family;
- remove `DATABASE_URL_ADMIN` from the public web workload;
- rewrite the already applied Unit 4 migration;
- apply W1-3 FORCE RLS or remove bootstrap policies;
- change P0-4, malware scanning, networking, firewall, private networking, HA, or geo posture;
- run production `deep=true` health; or
- enumerate Brightside rooms or access Brightside document metadata, preview, download, export, or
  content.

## 2. Human review and exact-head validation

Human review covered the complete PR #135 diff and confirmed:

- the migration fails closed on owner posture, session function contract, source checksum, and ACL
  drift before applying the runtime grant;
- the only new runtime grant is the exact session-resolve function signature;
- the organization function remains inaccessible to `vaultspace_app`;
- the two converted read paths have no `bootstrapDb` query or administrative fallback;
- session creation, refresh, logout, revocation, and bulk invalidation implementations are
  unchanged;
- Redis is only an optimization and cannot authorize without a current live database projection;
- cache mismatch or a failed live lookup denies the session;
- the bootstrap projection contains the fields needed for session identity and validity without
  returning the raw session token, password, two-factor secret, IP address, or user agent; and
- no route or middleware outside session reads changed.

The reviewed PR head was `591d187f94d14761819306a3189331fa9271fca9`. Exact-head PR CI run
`31618820720` completed successfully, including lint, format, type, unit, RLS integration, provider
integration, E2E, standalone-build, and container build checks. The reviewed and tested source head
was the exact head merged into main.

## 3. Authorized local cleanup

Before merge, the following two disposable local PostgreSQL containers were removed exactly as
authorized:

- `vaultspace-w1-2-session-route-v1`; and
- `vaultspace-w1-2-session-route-azure-v1`.

The following two authorized temporary files were also deleted:

- `/tmp/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v2.seed`; and
- `/tmp/vaultspace-unit5-docs-health-headers.out`.

Only those container records, writable layers, and files were removed. Images, volumes, other
containers, Azure resources, production data, and other files were untouched.

## 4. Controlled merge and exact-main CI

Before merge:

- workflow `251547585` was active;
- no real deployment was queued or in progress;
- the risk-accepted historical ghost run remained non-actionable;
- the workflow was disabled and verified as `disabled_manually`; and
- live production remained healthy on
  `918307ca24454fd5bc0586bbbe2355a512cafe16 / ca-vaultspace-web--0000290`.

PR #135 was marked ready and merged with an exact-head guard. The resulting main tip was
`0d97aca143c1bb46a251856e1b34989694884a8a`.

Exact-main CI run `31620380130` completed successfully on that merge commit. It included the normal
lint, RLS integration, security, deployment-mode, provider-integration, type, unit, E2E, build,
Docker, and immutable image-publication paths. No deployment started while workflow `251547585`
was disabled.

After exact-main CI was green:

- main still equaled the approved merge commit;
- no real deployment was active or queued;
- the deploy workflow was re-enabled and verified as `active`;
- enablement did not start a deployment; and
- exactly one workflow dispatch was issued for the exact main SHA.

## 5. Single deployment and live identity

Deploy run `31621191580` succeeded on attempt 1 for
`0d97aca143c1bb46a251856e1b34989694884a8a`. No second dispatch was issued. Recovery did not run.

The pipeline passed rollback-source capture, immutable-image checks, the password-reset delivery
contract, migration application, worker readiness, reconciler verification, web cutover, all three
job updates, quick health, strict web convergence, traffic validation, and final worker readiness.

Quick uncached health returned HTTP 200 with `Cache-Control: no-store, max-age=0`:

| Field                 | Result                                     |
| --------------------- | ------------------------------------------ |
| Status                | healthy                                    |
| Mode                  | azure                                      |
| Release               | `0d97aca143c1bb46a251856e1b34989694884a8a` |
| Revision              | `ca-vaultspace-web--0000291`               |
| Degraded capabilities | none                                       |

The same exact live identity remained healthy after CloudVault and Brightside acceptance.

## 6. Workload coherence and rollback posture

The web workload converged to exactly one active revision with 100 percent traffic:

- web revision: `ca-vaultspace-web--0000291`;
- health: Healthy;
- provisioning: Provisioned;
- replicas: 1;
- traffic: 100 percent; and
- web runnable digest:
  `sha256:cf77b7da29a675f922521ecc7d7add35b3c7602c765d5a8f6a11b06849e2b639`.

The worker and all three scheduled jobs use one coherent worker digest:

`sha256:d2c420cdf2d34e897e64b394ba3f76f04985fe1825e8007137dd4f2f4b2fb48d`

| Workload                         | Result                           |
| -------------------------------- | -------------------------------- |
| `ca-vaultspace-worker--0000274`  | Healthy, Provisioned, deployed   |
| `ca-vaultspace-delayed-waker`    | Schedule, deployed worker digest |
| `ca-vaultspace-invite-lifecycle` | Schedule, deployed worker digest |
| `ca-vaultspace-pwreset-recon`    | Schedule, deployed worker digest |

The immediate prior web rollback source remains retained:

- revision: `ca-vaultspace-web--0000290`;
- status: inactive, Healthy, and Provisioned; and
- runnable digest:
  `sha256:2c58cc85ef2ab041775127a54a62e36843bc18b49756a41511b6fac804d42f16`.

No revision or image was deleted. The deploy workflow remains active.

## 7. Production catalog acceptance

Catalog verification used the existing Munger Key Vault reference through a process-local
connection. The secret value was not printed, persisted, written to a file, or placed in a command
argument. Queries were limited to PostgreSQL catalog, role, function, and migration metadata except
for the separately authorized synthetic CloudVault fixture operations.

Migration `20260812163000_w1_2_session_route_conversion` is finished and has not been rolled back.

### 7.1 Owner posture

`vaultspace_bootstrap_owner` remains:

- NOLOGIN;
- NOINHERIT;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEDB;
- NOCREATEROLE;
- NOREPLICATION;
- without members; and
- unreachable directly or transitively by `vaultspace_app`.

### 7.2 Session function contract

The session-resolve function remained exact:

- signature: `public.bootstrap_session_resolve_v1(text)`;
- identity arguments: `input_token text`;
- owner: `vaultspace_bootstrap_owner`;
- language: SQL;
- SECURITY DEFINER: true;
- volatility: stable;
- parallel mode: restricted;
- configuration: `search_path=pg_catalog`;
- contract marker: `vaultspace-contract:w1-2-session-resolve-v1`;
- stored source SHA-256:
  `7b83946afec28fcb354c53792a714f7c7aef9ca8d2e3953e4aaee3f199a55916`;
- `vaultspace_app` EXECUTE: true; and
- `PUBLIC` EXECUTE: false.

The live runtime EXECUTE matrix was:

| Function                                       | `vaultspace_app` EXECUTE |
| ---------------------------------------------- | ------------------------ |
| `bootstrap_login_candidate_v1(text)`           | yes                      |
| `bootstrap_session_resolve_v1(text)`           | yes                      |
| `bootstrap_organization_resolve_v1(text,text)` | no                       |

The exact ACL inspection showed only the owner and `vaultspace_app` on the login and session
functions, and only the owner on the organization function. `PUBLIC` has no EXECUTE on any of the
three functions. The owner itself did not become reachable.

## 8. CloudVault session-family acceptance

The versioned runner
`scripts/cloudvault-w1-2-session-resolve-acceptance-v1.cjs` performed the bounded production
acceptance against the retained active synthetic organization named exactly `CloudVault`. It used
one dedicated synthetic identity with a generated process-memory password. No password or database
secret was printed or persisted.

| Authorized check                                            | Result |
| ----------------------------------------------------------- | ------ |
| Quick health matches the exact Unit 5 release               | PASS   |
| Conversion migration and exact catalog posture              | PASS   |
| Login returns 200 with exact CloudVault identity            | PASS   |
| Authenticated session resolves the exact synthetic identity | PASS   |
| Server-component protected page returns authenticated shell | PASS   |
| Malformed and unknown sessions are denied                   | PASS   |
| Idle-expired and absolute-expired sessions are denied       | PASS   |
| Live revocation defeats the previously cached session       | PASS   |
| Replacement login and session remain healthy                | PASS   |
| Logout succeeds and the old session returns 401             | PASS   |

Result: **10/10 PASS**.

The live-revocation case first warmed the session path, soft-disabled the authoritative database
session, and proved that the old cached session was denied. This confirms that Redis cannot
authorize alone and that the current database projection wins.

After the smoke:

- synthetic sessions were soft-disabled;
- the synthetic membership was soft-disabled;
- the synthetic user was soft-disabled;
- active synthetic users, memberships, and sessions from the operation each counted zero; and
- the retained `CloudVault` verification organization remained active for later W1-2 phases.

No CloudVault room, folder, document, link, preview, download, export, or content endpoint was used.

## 9. Brightside bounded read-only smoke

CloudVault acceptance was green before any Brightside access. The user made an existing signed-in
Brightside Chrome session available. The session was on the canonical application host and the
authenticated shell showed the Brightside organization identity.

One focused browser-history lookup found exactly one previously visited Brightside room route. The
room identifier, title, customer data, and document data were not recorded in this evidence. The
custom Brightside hostname did not share the canonical-host session cookie and correctly presented
its login route. The same previously known room path was therefore checked on the authenticated
canonical application host.

| Authorized check                                      | Result |
| ----------------------------------------------------- | ------ |
| Existing Brightside session and authenticated shell   | PASS   |
| Previously known room route on the authenticated host | PASS   |
| Logout through the application UI                     | PASS   |
| Protected known-room re-entry after logout is denied  | PASS   |

The known room route presented the authenticated main application under the Brightside identity
with no login form or visible fatal error. No room list was opened. No room name, room identifier,
document name, metadata, preview, download, export, or content was read or recorded.

Logout returned the tab to the login route. A direct re-entry attempt to the same known room path
remained on the login route and did not expose an authenticated application region. The Brightside
account was left logged out.

## 10. Strawman, Steelman, and Pre-Mortem update

### Strawman

- Splitting session reads from still-unconverted mutations could create inconsistent lifecycle
  behavior.
- A stale Redis entry could keep an invalid session authorized if live comparison were incomplete.
- An incomplete session projection could make login succeed while protected pages redirect every
  user back to login.

### Steelman

- Converting the two high-frequency read paths without changing mutations forms a bounded first
  session-family slice.
- The runtime has one exact session capability and no organization capability.
- Exact-main CI, immutable images, strict workload convergence, exact catalog verification, a
  10-case CloudVault matrix, and the bounded Brightside smoke cover privilege posture, cache/live
  behavior, server-component behavior, and user-visible continuity.

### Pre-Mortem

If the grant widened, catalog acceptance would show unexpected organization execution. If the
projection or cache comparison were wrong, exact identity, expiry, live revocation, or protected
page checks would fail. If the customer session path broke, the Brightside shell or known-room
smoke would fail before logout. None of these conditions occurred.

The retained revision `ca-vaultspace-web--0000290` and its immutable digest remain the immediate
application rollback source. No rollback was required.

## 11. Status and next gate

**W1-2 UNIT 5 SESSION RESOLVE READ CONVERSION: DEPLOYED, CATALOG GREEN, CLOUDVAULT 10/10 GREEN,
BRIGHTSIDE MINIMAL SMOKE GREEN, PENDING WRITTEN ADVISOR CLOSE-OUT.**

W1-2 overall remains OPEN. `DATABASE_URL_ADMIN` remains present on the public web workload. Runtime
EXECUTE is limited to the login-candidate and session-resolve functions. The organization function
remains runtime-inaccessible. Session mutations and organization routes remain unconverted. No
admin URL removal, W1-3 enforcement, or P0-4 change is authorized by this evidence.

## References

- PR #135 and reviewed source head `591d187f94d14761819306a3189331fa9271fca9`
- Exact-head PR CI run `31618820720`
- Exact-main CI run `31620380130`
- Deployment run `31621191580`
- Live release `0d97aca143c1bb46a251856e1b34989694884a8a`
- Live web revision `ca-vaultspace-web--0000291`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v2.md`
- `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_VALIDATION_2026-08-12_v1.md`
- `prisma/migrations/20260812163000_w1_2_session_route_conversion/migration.sql`
- `scripts/cloudvault-w1-2-session-resolve-acceptance-v1.cjs`
