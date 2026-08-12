# W1-2 Login Route Conversion Deployment Evidence

- **Date:** 2026-08-12
- **Control family:** W1-2 database privilege split
- **Implementation unit:** Login-candidate route conversion
- **Source PR:** #133
- **Reviewed source head:** `ad12ec820c8fb18bfc69385897c91241544fa9ad`
- **Merge commit and deployed release:** `831f4a72be960dbcb2e3841df83ee008ffda95e2`
- **Exact-head PR CI:** `31610879594`, success
- **Exact-main CI:** `31611813939`, success
- **Deployment:** `31612690866`, success
- **Live web revision:** `ca-vaultspace-web--0000289`
- **Result:** Deployment, catalog posture, CloudVault login-family matrix, and bounded Brightside smoke green
- **W1-2 Unit 4 status:** Technical acceptance criteria met, pending written Advisor close-out
- **W1-2 overall status:** OPEN
- **Security freeze:** ACTIVE
- **P0-4:** ACCEPTED AND UNCHANGED

## 1. Scope and boundary

This unit converted only the password-login candidate lookup to the constrained bootstrap function.
It:

- granted `vaultspace_app` EXECUTE on exactly
  `public.bootstrap_login_candidate_v1(text)`;
- kept `PUBLIC` denied;
- routed the login candidate lookup through `BootstrapRepository` and the runtime connection;
- removed the login route's `bootstrapDb` lookup and did not add an administrative fallback;
- retained password verification, rate limiting, two-factor branching, session creation, audit
  behavior, and neutral authentication denials in the application; and
- changed operational error reporting to categorical output without exception text.

This unit did not:

- grant runtime EXECUTE on the session or organization bootstrap functions;
- convert session resolution, middleware, organization resolution, logout, registration, password
  reset, public branding, or any other route;
- remove `DATABASE_URL_ADMIN` from the public web workload;
- change the web entrypoint or migration execution model;
- apply W1-3 FORCE RLS or remove bootstrap policies;
- change P0-4, malware scanning, networking, firewall, private networking, HA, or geo posture;
- run production `deep=true` health; or
- enumerate Brightside rooms or access Brightside document metadata, preview, download, export, or
  content.

## 2. Human review and source correction

Human review covered the complete PR #133 diff and the established login behavior. It confirmed:

- the migration fails closed on owner posture, function contract, source checksum, and ACL drift;
- the only runtime grant is the exact login-candidate function signature;
- the session and organization functions remain inaccessible to `vaultspace_app`;
- the login route has no `bootstrapDb` import, query, or fallback;
- the bootstrap projection contains only the fields required for password login;
- bcrypt verification remains in the application;
- the valid, invalid, inactive, and two-factor branches retain their existing response contracts;
- rate limits remain before credential verification; and
- no route outside the login family changed.

The review found that the initial source head logged the raw caught error object for an operational
bootstrap lookup failure. That could expose database detail in application logs. The finding was
corrected before merge by commit `ad12ec820c8fb18bfc69385897c91241544fa9ad`:

- operational failure logging became categorical JSON only;
- exception text, stack, database code, and query detail are not logged; and
- a regression test proves the error path remains neutral to the client and categorical in logs.

Exact-head PR CI run `31610879594` completed successfully after this correction. The reviewed and
tested source head was the exact head merged into main.

## 3. Controlled merge and exact-main CI

Before merge:

- workflow `251547585` was active;
- no real deployment was queued or in progress;
- the workflow was disabled and verified as `disabled_manually`; and
- the two authorized disposable local PostgreSQL containers were removed.

PR #133 was marked ready and merged with an exact-head guard. The resulting main tip was
`831f4a72be960dbcb2e3841df83ee008ffda95e2`.

Exact-main CI run `31611813939` completed successfully on that merge commit. It included the normal
test, lint, formatting, type-check, integration, E2E, build, Docker, and immutable image publication
paths. No deployment started while workflow `251547585` was disabled.

After exact-main CI was green:

- main still equaled the approved merge commit;
- no real deployment was active or queued;
- the deploy workflow was re-enabled and verified as `active`;
- enablement did not start a deployment; and
- exactly one workflow dispatch was issued for the exact main SHA.

## 4. Single deployment and live identity

Deploy run `31612690866` succeeded on attempt 1 for
`831f4a72be960dbcb2e3841df83ee008ffda95e2`. No second dispatch was issued. Recovery did not run.

The pipeline applied the migration, deployed coherent web and worker images, aligned all three
scheduled jobs, passed the password-reset delivery contract and rollback-source preflight, passed
quick health, and passed strict post-cutover convergence.

Quick uncached health returned HTTP 200 with `Cache-Control: no-store, max-age=0`:

| Field                 | Result                                     |
| --------------------- | ------------------------------------------ |
| Status                | healthy                                    |
| Mode                  | azure                                      |
| Release               | `831f4a72be960dbcb2e3841df83ee008ffda95e2` |
| Revision              | `ca-vaultspace-web--0000289`               |
| Degraded capabilities | none                                       |

The same exact live identity remained healthy after CloudVault and Brightside acceptance.

## 5. Workload coherence and rollback posture

The web workload converged to one active revision with 100 percent traffic:

- web revision: `ca-vaultspace-web--0000289`;
- health: Healthy;
- provisioning: Provisioned;
- replicas: 1;
- traffic: 100 percent; and
- web runnable digest:
  `sha256:4447353a59b28254ef23c08a9369b197cbe232640f742aafb6d2ab7be68439a2`.

The worker and all three scheduled jobs use one coherent worker digest:

`sha256:a749a1f62ffffc8ea19159a511fd82a808b4a55876634c379c44fccfce51ec67`

| Workload                         | Result                           |
| -------------------------------- | -------------------------------- |
| `ca-vaultspace-worker--0000272`  | Healthy, deployed worker digest  |
| `ca-vaultspace-delayed-waker`    | Schedule, deployed worker digest |
| `ca-vaultspace-invite-lifecycle` | Schedule, deployed worker digest |
| `ca-vaultspace-pwreset-recon`    | Schedule, deployed worker digest |

The immediate prior web rollback source remains retained:

- revision: `ca-vaultspace-web--0000288`;
- status: inactive, Healthy, and Provisioned; and
- runnable digest:
  `sha256:6d9e4a9891550a077828eae74453ec546873ef4d48cef7cf7c89f91a45e0affe`.

No revision or image was deleted. The deploy workflow remains active.

## 6. Production catalog acceptance

Catalog verification used the existing Munger Key Vault reference through a process-local
connection. The secret value was not printed, persisted, written to a file, or placed in a command
argument. Queries were limited to PostgreSQL catalog, role, function, and migration metadata except
for the separately authorized synthetic CloudVault fixture operations.

Migration `20260812143000_w1_2_login_route_conversion` is finished and has not been rolled back.

### 6.1 Owner posture

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

### 6.2 Exact function contract and ACL

The login function remained exact:

- signature: `public.bootstrap_login_candidate_v1(text)`;
- owner: `vaultspace_bootstrap_owner`;
- language: SQL;
- SECURITY DEFINER: true;
- volatility: stable;
- parallel mode: restricted;
- configuration: `search_path=pg_catalog`;
- contract marker: `vaultspace-contract:w1-2-login-candidate-v1`;
- stored source SHA-256:
  `72b12f72ab12ca301cce0b168463dd294df01fa2c0ca1e07b8668643b267db38`;
- `vaultspace_app` EXECUTE: true; and
- `PUBLIC` EXECUTE: false.

The live runtime EXECUTE matrix was:

| Function                                       | `vaultspace_app` EXECUTE |
| ---------------------------------------------- | ------------------------ |
| `bootstrap_login_candidate_v1(text)`           | yes                      |
| `bootstrap_session_resolve_v1(text)`           | no                       |
| `bootstrap_organization_resolve_v1(text,text)` | no                       |

This proves that only the routed login-candidate capability became reachable from the public web
runtime. The owner itself did not become reachable.

## 7. CloudVault login-family acceptance

The versioned runner
`scripts/cloudvault-w1-2-login-route-acceptance-v1.cjs` performed the bounded production
acceptance against the retained active synthetic organization named exactly `CloudVault`. It used
dedicated synthetic identities with generated process-memory passwords. No password or database
secret was printed or persisted.

| Authorized check                                    | Result |
| --------------------------------------------------- | ------ |
| Conversion migration and exact catalog posture      | PASS   |
| Invalid password returns neutral 401                | PASS   |
| Unknown user returns neutral 401                    | PASS   |
| Inactive user returns neutral 401                   | PASS   |
| Inactive membership returns neutral 401             | PASS   |
| Inactive organization returns neutral 401           | PASS   |
| Valid password returns exact CloudVault identity    | PASS   |
| Authenticated `/api/auth/me` returns 200            | PASS   |
| Logout returns 200 and old session returns 401      | PASS   |
| Two-factor branch returns no password-login session | PASS   |

Result: **10/10 PASS**.

The live rate-limit lockout was not forced. Existing automated coverage proves the rate limiter
remains engaged and that operational logging is categorical.

After the smoke:

- synthetic sessions were soft-disabled;
- synthetic memberships were soft-disabled;
- synthetic users were soft-disabled;
- active synthetic users, memberships, and sessions from the operation each counted zero;
- the inactive synthetic organization remained inactive; and
- the retained `CloudVault` verification organization remained active for later W1-2 phases.

No CloudVault room, folder, document, link, preview, download, export, or content endpoint was used.

## 8. Brightside bounded read-only smoke

The user made the existing signed-in Brightside Chrome session available after CloudVault was
green. Browser control was limited to the exact `brightside.vaultspace.org` tab.

The previously approved single-room route was recovered through one focused lookup of the prior
Brightside room visit. Exactly one matching prior route existed. Its room identifier, title, and
customer data were not printed, recorded, or added to evidence.

| Authorized check               | Result |
| ------------------------------ | ------ |
| Authenticated Brightside shell | PASS   |
| Previously known room path     | PASS   |
| Logout                         | PASS   |
| Protected room re-entry denied | PASS   |

The shell and known room path each presented the main application region with no login form,
visible error, access-denied state, not-found state, or fatal page state. No room list was opened.
No room name, room identifier, document name, metadata, preview, download, export, or content was
read or recorded.

Logout returned the tab to the Brightside login route. A direct re-entry attempt to the same known
room path remained on the login route and did not expose the protected room. The Brightside account
was left logged out.

## 9. Authorized cleanup

Before merge, the following exited disposable local PostgreSQL containers were removed exactly as
authorized:

- `vaultspace-w1-2-login-route-v1`; and
- `vaultspace-w1-2-login-route-v2`.

Only those container records and writable layers were removed. Images, volumes, other containers,
Azure resources, and production data were untouched.

The separately authorized temporary file
`/tmp/vaultspace-unit4-premerge-health_v1.out` was also deleted. No other file was deleted.

## 10. Strawman, Steelman, and Pre-Mortem update

### Strawman

- Moving login candidate lookup to one SECURITY DEFINER function could lock out all users if the
  function, grant, projection, or error mapping were wrong.
- Granting EXECUTE could accidentally make the session or organization function reachable.
- A successful CloudVault synthetic matrix could miss a customer-specific Brightside login break.

### Steelman

- One route and one exact function signature form the smallest production conversion slice.
- Password verification, rate limiting, two-factor branching, session creation, and audit behavior
  remain in the established application layer.
- Exact-main CI, immutable images, strict workload convergence, catalog verification, a 10-case
  CloudVault login matrix, and the bounded Brightside smoke collectively test both privilege posture
  and user-visible continuity.

### Pre-Mortem

If the grant widened, catalog acceptance would show unexpected session or organization execution.
If the function projection or route mapping were wrong, valid, invalid, inactive, two-factor, or
session lifecycle cases would fail. If the customer shell or known room path broke, the Brightside
smoke would produce a login redirect, error state, or failed logout. None of these conditions
occurred.

The retained revision `ca-vaultspace-web--0000288` and its immutable digest remain the immediate
application rollback source. No rollback was required.

## 11. Status and next gate

**W1-2 UNIT 4 LOGIN ROUTE CONVERSION: DEPLOYED, CATALOG GREEN, CLOUDVAULT 10/10 GREEN,
BRIGHTSIDE MINIMAL SMOKE GREEN, PENDING WRITTEN ADVISOR CLOSE-OUT.**

W1-2 overall remains OPEN. `DATABASE_URL_ADMIN` remains present on the public web workload. Runtime
EXECUTE remains denied for the session and organization bootstrap functions. No additional route
conversion, admin URL removal, W1-3 enforcement, or P0-4 change is authorized by this evidence.

## References

- PR #133 and reviewed source head `ad12ec820c8fb18bfc69385897c91241544fa9ad`
- Exact-head PR CI run `31610879594`
- Exact-main CI run `31611813939`
- Deployment run `31612690866`
- Live release `831f4a72be960dbcb2e3841df83ee008ffda95e2`
- Live web revision `ca-vaultspace-web--0000289`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `docs/W1_2_LOGIN_ROUTE_CONVERSION_2026-08-12_v1.md`
- `docs/W1_2_LOGIN_ROUTE_CONVERSION_VALIDATION_2026-08-12_v1.md`
- `scripts/cloudvault-w1-2-login-route-acceptance-v1.cjs`
