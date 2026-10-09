# VaultSpace Deployment Guide

This public guide describes the supported deployment contract without exposing a particular environment’s infrastructure details.

## Deployment modes

- `standalone` supports self-hosted development and deployment.
- `azure` supports managed cloud deployment through the repository’s parameterized workflow.

Choose the deployment mode explicitly. Production-like deployments use a protected CI environment. Azure deployment authenticates with OIDC. Registry push/pull migration prerequisites and live authentication posture are tracked in private operator notes; review CI, runtime, and event-source identities separately before changing them.

## Configuration

Start from [`.env.example`](.env.example), the public variable catalog. Runtime guards, `scripts/validate-container-env.sh`, and the reconciler gates in `.github/workflows/deploy-staging.yml` enforce the deployment requirements. This guide explains the contract; it is not an exhaustive variable-name reference. Variable names are public configuration contracts. Their values, including credentials, resource names, domains, connection strings, keys, tenant identifiers, and protected organization lists, belong only in an approved secret or environment configuration system.

Do not commit a populated environment file. Do not place operational command output, deployment revisions, container image identifiers, or tenant data in pull requests, issues, release notes, or generated artifacts.

### Durable self-service verification email

Self-service signup verification uses the legacy direct-send path by default for backward-compatible deployment. Do not switch to durable delivery until migration `20260901200000_add_email_verification_delivery_contract` is deployed to web and worker environments, and a scheduled reconciler is available.

To activate the reviewed durable flow, configure these secret-backed settings in both the web and worker revisions:

```text
EMAIL_VERIFICATION_DELIVERY_MODE=durable
EMAIL_VERIFICATION_RECOVERY_KEYS={"verify-YYYY-MM":"<32-byte base64 key>"}
EMAIL_VERIFICATION_RECOVERY_ACTIVE_KEY_ID=verify-YYYY-MM
```

The key ring is dedicated to verification delivery and must not reuse the password-reset recovery key ring. Schedule `npm run worker:email-verification-reconcile` every five minutes (`*/5 * * * *`, UTC), as enforced by the staging deploy. The worker must have Redis, a deliverable email provider, `APP_URL`, and the same verification key ring. Queue payloads are flow-only and do not contain a recipient or verification URL.

Before enabling, run a controlled-mailbox canary and prove token/recovery row creation, job enqueue, worker provider acceptance, absence of bearer tokens from logs and Redis, explicit-click verification, and creation of exactly one draft initial room.

Keep ACS final-delivery projection disabled. Its existing Event Grid inbox is shadow ingestion only and requires a separately approved protected-projector release before it may affect verification lifecycle state.

## Verified staging job inventory

Verified read-only on 2026-10-08. These commands run as Azure Container Apps Jobs,
using the same pinned worker digest, one completion, parallelism 1, and retry limit 1.

| Command                               | UTC cron       | Timeout |
| ------------------------------------- | -------------- | ------- |
| `worker:wake-delayed`                 | `*/5 * * * *`  | 90 s    |
| `worker:invitation-lifecycle`         | `0 6 * * *`    | 300 s   |
| `worker:password-reset-reconcile`     | `*/15 * * * *` | 600 s   |
| `worker:email-verification-reconcile` | `*/5 * * * *`  | 300 s   |

The reset job sets `PASSWORD_RESET_RECONCILER_ENABLED=true`; web and ordinary worker
processes omit it. Web health therefore reports false without disabling the scheduled
job. Use the job configuration, preflight, and execution evidence to evaluate it.
Do not enable another reconciler merely to change the web health flag.

No jobs for `worker:stale-token-cleanup` or `worker:send-pending-invites` were found.
Waker and lifecycle cadences are recorded here but are not enforced by the deploy
validator. The email-verification cadence is enforced exactly; the reset job must
meet the workflow's cadence and preflight gates. Additional maintenance schedules
in `JOB_SPECS.md` remain design work, not a deployed scheduler.

### Configuration scope

The web app requires `DATABASE_URL_ADMIN` and `PLATFORM_PROTECTED_ORG_SLUGS` as
secret references. `DATABASE_URL_ADMIN` is forbidden on runtime workers, which
require `WORKER_TYPE` and `ENABLE_RLS=false`. `MIGRATION_DATABASE_URL` belongs only
to protected CI verification and migration steps. Commented role-specific entries in `.env.example`
must be supplied to the appropriate process, not copied into every container.
Dedicated password-reset and email-verification recovery key rings must remain
separate and be configured before HMAC/durable modes are activated.

`infrastructure/ca-web-complete.yaml` is a sanitized snapshot with placeholders and
existing-secret prerequisites. `ca-web-probes.yaml` is a reference excerpt, not an
independent deployable template. Live readiness is deep and web scanning is
passthrough; the worker performs ClamAV scanning. Apply changes only through the
reviewed deployment process.

### Certificate renewal configuration

The monthly wildcard renewal workflow receives `ACME_EMAIL` from the protected
`staging` Environment secret. `scripts/renew-wildcard-cert.sh` requires that value
and exits before any renewal operation if it is missing. The secret was configured
with owner approval during this review; no certificate was issued or rebound.
The workflow change takes effect after merge into the default branch.

## Managed-cloud release flow

1. Open a reviewed pull request against the protected default branch.
2. Require all CI, public-repository safety, and security checks to pass.
3. Build the exact reviewed commit once.
4. Deploy through the protected GitHub Environment using OIDC.
5. Verify health, traffic convergence, and the deployed release identity.
6. Run only approved isolated-tenant browser verification.

The deployment workflow captures a prior serving state before mutation and performs an automated rollback when a release gate fails. Environment-specific recovery instructions are restricted operational documentation.

## Self-hosted release flow

1. Configure secrets through the target platform’s protected secret mechanism.
2. Run database migrations with the designated migration identity.
3. Start the web and worker components with their least-privilege runtime identities.
4. Confirm the health endpoint and required capabilities before admitting user traffic.

For configuration troubleshooting, compare variable _names_ with [`.env.example`](.env.example). Never paste effective secret values or production-like infrastructure details into a public support request.
