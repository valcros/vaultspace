# VaultSpace Private Beta Candidate Release Notes

Release candidate: `v0.1.0-beta.1`

Date: 2026-07-01

Environment: Azure staging, `https://www.vaultspace.org`

## Release Decision

This package is suitable as a private beta candidate. The release commit and local tag have been created, but no public GitHub release, remote tag push, or production promotion should occur until the full manual MVP QA checklist and Docker Compose start smoke are complete.

Recommended release label:

```text
v0.1.0-beta.1
```

Recommended production/tag workflow decision:

- Keep tag-triggered production deployment deferred.
- Use Azure staging for private beta review.
- Push a remote tag or GitHub release only after the manual QA and Docker Compose blockers in `docs/VAULTSPACE_ACTIVE_ITEMS_CLOSEOUT_2026-07-01.md` are closed.

## Deployment Summary

| Item                 | Value                                      |
| -------------------- | ------------------------------------------ |
| Public URL           | `https://www.vaultspace.org`               |
| Release candidate    | `v0.1.0-beta.1`                            |
| Source commit        | Local `v0.1.0-beta.1` tag target           |
| Staging deployment   | Final July 1 web and worker image set      |
| Background execution | Queue worker and delayed-job waker enabled |

Exact Azure subscription IDs, resource group names, container image tags, image digests, revision names, Key Vault identifiers, and job execution IDs are intentionally omitted from this public-safe release note. They remain available through Azure, local operator logs, and the private closeout records.

## Highlights

- Password reset and digest paths now queue supported BullMQ `email.send` jobs.
- Worker scale-from-zero is active with KEDA Redis wait-list scalers for high, normal, and low BullMQ queues.
- A scheduled delayed-job waker promotes due delayed BullMQ jobs every 2 minutes so retries are not stranded while the worker is scaled to zero.
- Redis was migrated to Azure Managed Redis Enterprise 7.4.
- ClamAV scanning is enabled in the worker path with Gotenberg and ClamAV sidecars.
- QA smoke defaults now avoid repeated email by skipping password reset and digest email unless explicitly enabled.
- Export smoke can exercise ZIP generation and completion with `sendEmail=false`.
- A durable staging QA account is available through operator-managed secret references, not repo files.
- Dashboard onboarding text contrast was fixed and verified with an axe WCAG 2.1 A/AA smoke scan.
- Public share-link and viewer-session bootstrap lookups now work correctly under production RLS.
- Security E2E now passes public expired-link, password-link, cross-tenant room, header/query spoofing, and viewer-session isolation checks against staging.

## Verification

Local verification after the final RLS and UI contrast fixes:

- `npm run lint`
- `npm run type-check`
- Focused Vitest run covering viewer session guard, permission security, export processor, export route, forgot-password route, and digest route: 6 files, 50 tests passed
- `npm audit --omit=dev`: 0 vulnerabilities

Azure verification:

- Deep health returned `status=healthy`, `mode=azure`, and `degraded=[]`.
- The web app is ready and receiving 100 percent staging traffic.
- The worker is ready with scale-from-zero enabled and KEDA rules for `high`, `normal`, and `low`.
- The delayed waker job was updated to the final worker image and a manual execution succeeded.
- No-email worker-flow smoke passed 9 runnable checks with 0 failures and 2 intentional email skips.
- Scale-from-zero no-email smoke started with zero worker replicas, queued upload/export work, passed 9 runnable checks, and observed the final worker replica stop after processing.
- Security E2E passed 14 of 14 Playwright request tests against staging.
- System Chrome and Microsoft Edge browser smoke passed landing, login, dashboard, rooms, settings, and mobile login.
- System Chrome axe scan passed Landing, Login, Register, Forgot Password, Dashboard, Rooms, and Settings with 0 WCAG 2.1 A/AA violations.

## Known Limitations

- Full 63-feature manual QA in `QA_TEST_PLAN.md` is not complete.
- Docker Compose start smoke is blocked in this shell because Docker Compose is not installed.
- The Playwright managed browser cache is missing; browser verification used installed system Chrome and Microsoft Edge instead.
- Intentional email smoke was not rerun after the repeated digest-email issue. Final smokes intentionally skipped password reset and digest email and used `sendEmail=false` for export. Email paths are covered by local tests and prior confirmed deliveries.
- Next.js `16.2.9` still warns that `middleware.ts` is deprecated in favor of `proxy.ts`. This remains passive maintenance because moving/removing the file requires a separate file operation.
- Old Redis 6 rollback cache remains online for the approved observation window. Do not delete it without fresh explicit approval.

## Rollback

Previous known-good staging image tags are intentionally omitted from this public-safe release note. Use the private deployment records or Azure Container Registry history for exact rollback image references.

Rollback must re-verify:

1. Web and worker latest ready revisions.
2. Worker KEDA Redis scaler metadata.
3. Delayed waker job image and successful execution.
4. Deep health.
5. No-email worker-flow smoke.

## Release Checklist

Before pushing a public tag or GitHub release:

- [x] Commit the final RLS fixes, contrast fix, security test update, and release docs locally.
- [x] Create local tag `v0.1.0-beta.1`.
- [ ] Push the branch and tag only after public-safe doc review is complete.
- [ ] Run the full manual checklist in `QA_TEST_PLAN.md`.
- [ ] Run Docker Compose start smoke with Compose tooling installed.
- [ ] Decide whether tag-triggered production deployment remains disabled or is intentionally activated.
- [ ] Confirm whether an intentional one-time email smoke should be run.

## References

- `docs/VAULTSPACE_ACTIVE_ITEMS_CLOSEOUT_2026-07-01.md`
- `CHANGELOG.md`
- `QA_TEST_PLAN.md`
