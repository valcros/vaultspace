# Public Repository Remediation Plan

## Objective

Ensure the public repository contains only public product information while preserving the deployed application’s functional behavior.

## Review

The plan was independently reviewed through Strawman, Steelman, and Pre-Mortem lenses. The resulting controls are incorporated below.

## Gate 1: Forward-safe remediation

1. Classify repository content as public, restricted operational, or secret-bearing.
2. Move restricted operational originals to an approved private location and create separately reviewed public-safe documentation where needed.
3. Replace client-bundled operational fallbacks with generic authorized telemetry.
4. Inject deployment-specific protected-organization configuration through a secret-backed runtime boundary. Destructive operations must fail closed when this configuration is unavailable or invalid.
5. Prevent recurrence with ignored private paths, source scanning, credential scanning, branch rules, and protected deployment environments.
6. Validate current source, generated artifacts, CI, deployment modes, and the deployed application using only isolated test data.

## Gate 2: Historic public-surface remediation

1. Freeze merges, releases, deployment automation, and normal write activity.
2. Preserve an access-controlled backup and an exact private ref inventory.
3. Rewrite all intended reachable branches and tags from a clean clone, then scan the rewritten repository before publication.
4. Force-push only through the authorized, time-bounded exception while deployment automation remains frozen.
5. Independently inspect releases, Actions logs and artifacts, packages, pages, pull-request and issue text, and other first-party publication surfaces.
6. Record residual third-party forks, clones, caches, and indexes as follow-up closure items. A history rewrite reduces future discoverability; it does not revoke already copied information.

## Non-negotiable release gates

- No known secret finding remains active or unrotated.
- Current public source and generated artifacts have no restricted operational data.
- Runtime configuration is present and destructive SysOp operations fail closed if it is not.
- Unit, integration, deployment-mode, build, and release workflow checks pass.
- Azure configuration is unchanged except for the approved application image and secret-backed configuration needed by this remediation.
- Browser validation uses isolated test tenants only. Restricted tenants and unrelated subscriptions are not accessed.
- No historic rewrite begins until deployment automation is frozen outside the rewritten history and no deployment runs are active.
