# VaultSpace Deployment Guide

This public guide describes the supported deployment contract without exposing a particular environment’s infrastructure details.

## Deployment modes

- `standalone` supports self-hosted development and deployment.
- `azure` supports managed cloud deployment through the repository’s parameterized workflow.

Choose the deployment mode explicitly. Production-like deployments must use a protected CI environment and workload identity authentication.

## Configuration

Start from [`.env.example`](.env.example). Variable names are public configuration contracts. Their values, including credentials, resource names, domains, connection strings, keys, tenant identifiers, and protected organization lists, belong only in an approved secret or environment configuration system.

Do not commit a populated environment file. Do not place operational command output, deployment revisions, container image identifiers, or tenant data in pull requests, issues, release notes, or generated artifacts.

### Durable self-service verification email

Self-service signup verification uses the legacy direct-send path by default for backward-compatible deployment. Do not switch to durable delivery until migration `20260901200000_add_email_verification_delivery_contract` is deployed to web and worker environments, and a scheduled reconciler is available.

To activate the reviewed durable flow, configure these secret-backed settings in both the web and worker revisions:

```text
EMAIL_VERIFICATION_DELIVERY_MODE=durable
EMAIL_VERIFICATION_RECOVERY_KEYS={"verify-YYYY-MM":"<32-byte base64 key>"}
EMAIL_VERIFICATION_RECOVERY_ACTIVE_KEY_ID=verify-YYYY-MM
```

The key ring is dedicated to verification delivery and must not reuse the password-reset recovery key ring. Schedule `npm run worker:email-verification-reconcile` at least once per minute. The worker must have Redis, a deliverable email provider, `APP_URL`, and the same verification key ring. Queue payloads are flow-only and do not contain a recipient or verification URL.

Before enabling, run a controlled-mailbox canary and prove token/recovery row creation, job enqueue, worker provider acceptance, absence of bearer tokens from logs and Redis, explicit-click verification, and creation of exactly one draft initial room.

Keep ACS final-delivery projection disabled. Its existing Event Grid inbox is shadow ingestion only and requires a separately approved protected-projector release before it may affect verification lifecycle state.

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
