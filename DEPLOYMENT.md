# VaultSpace Deployment Guide

This public guide describes the supported deployment contract without exposing a particular environment’s infrastructure details.

## Deployment modes

- `standalone` supports self-hosted development and deployment.
- `azure` supports managed cloud deployment through the repository’s parameterized workflow.

Choose the deployment mode explicitly. Production-like deployments must use a protected CI environment and workload identity authentication.

## Configuration

Start from [`.env.example`](.env.example). Variable names are public configuration contracts. Their values, including credentials, resource names, domains, connection strings, keys, tenant identifiers, and protected organization lists, belong only in an approved secret or environment configuration system.

Do not commit a populated environment file. Do not place operational command output, deployment revisions, container image identifiers, or tenant data in pull requests, issues, release notes, or generated artifacts.

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
