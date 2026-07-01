# VaultSpace Deployment Audit

Date: 2026-06-30

This public copy intentionally omits private Azure deployment evidence. Exact subscription IDs, tenant IDs, resource group names, registry names, image tags, image digests, Container App revisions, Key Vault references, job execution names, QA credentials, and operator-only rollback details must remain in private runbooks outside this repository.

## Public Summary

- Worker and email fixes were deployed and verified in Azure staging.
- Password reset, digest, upload, preview, export, and cleanup flows were smoke-tested.
- The worker was updated to support BullMQ-aware scale-from-zero behavior.
- A scheduled delayed-job wake-up path was added so delayed BullMQ retries are not stranded while workers are scaled to zero.
- Redis was upgraded to a BullMQ-supported managed Redis version.
- Smoke scripts now avoid repeated live password reset, digest, and export notification email unless those tests are explicitly enabled.
- Runtime dependency maintenance reduced the production dependency audit to zero known production vulnerabilities at the time of verification.

## Public Verification Evidence

The following checks passed during the stabilization work:

| Area              | Result |
| ----------------- | ------ |
| Password reset    | PASS   |
| Digest email      | PASS   |
| Upload            | PASS   |
| Worker scan       | PASS   |
| Preview           | PASS   |
| Export            | PASS   |
| Cleanup           | PASS   |
| Deep health       | PASS   |
| Queue drain       | PASS   |
| Delayed wake path | PASS   |
| TypeScript        | PASS   |
| ESLint            | PASS   |
| Prettier          | PASS   |
| Build             | PASS   |
| Unit tests        | PASS   |

## Public Operational Notes

- The web app remains warm in staging to avoid public cold starts during active development.
- The background worker can scale to zero when idle.
- KEDA watches BullMQ waiting lists for fresh jobs.
- A scheduled wake-up process covers delayed BullMQ jobs that KEDA list scalers do not observe directly.
- Exact rollback instructions and image references are private operator records.

## Follow-Up Boundaries

- Do not remove rollback infrastructure without fresh explicit approval naming the target resources.
- Continue monitoring the delayed wake path after image deployments and Redis secret rotations.
- Keep QA credentials in an operator-managed secret store, not in source control.
- Keep private Azure credit, tenant, and budget strategy out of the public repository.

For the current public release status, see:

- `docs/RELEASE_NOTES_2026-07-01.md`
- `docs/VAULTSPACE_ACTIVE_ITEMS_CLOSEOUT_2026-07-01.md`
- `CHANGELOG.md`
