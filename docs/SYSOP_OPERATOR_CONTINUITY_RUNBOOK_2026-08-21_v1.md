# SysOp Operator Continuity Runbook

## Purpose

VaultSpace SysOp access is a global, explicit platform entitlement. It is not
derived from an organization role or an e-mail pattern. This runbook prevents
the platform from reaching a state with no active SysOp operator.

This document contains no tenant records, operator identities, connection
strings, Azure resource names, or other environment-specific values.

## Controls

- `npm run ops:verify-platform-operator` is a read-only check. It exits non-zero
  unless at least one user is both active and a platform operator. It reports
  only the active count.
- The staging deployment workflow runs that check before migrations, revision
  changes, or traffic cutover.
- The `Platform Operator Continuity` GitHub Actions workflow runs the same
  read-only check hourly and can be manually dispatched for an immediate
  verification.
- `npm run ops:grant-operator -- <verified-email>` is the audited out-of-band
  grant path. It records a platform-operator audit event.
- Ordinary revocation refuses to revoke the last active platform operator.
  Grant a verified successor first.

## Routine verification

From an approved operator environment with an administrative or migration
database connection available:

```bash
npm run ops:verify-platform-operator
```

Expected result:

```text
Platform operator continuity verified: <positive-count> active operator(s).
```

The command is read-only. Do not use Brightside as a write-test tenant.

## Grant a replacement operator

1. Verify the identity and need through the approved access process.
2. Grant the successor with the audited operator command.
3. Have the successor sign in and confirm the profile menu exposes SysOp and
   `/sysop` loads.
4. Run the routine verification command.
5. Only then revoke the departing operator, if appropriate.

## Break-glass revoke

The `--allow-last-active-revoke` option is intentionally explicit. It may only
be used during a documented incident when retaining the current final operator
would be more dangerous than losing SysOp access. Record the incident reason,
immediately grant a verified replacement, and run the verification command.

## Failure response

If the verification command or scheduled workflow reports zero active platform
operators:

1. Stop release promotion. The deployment gate will also fail closed.
2. Use the approved administrative recovery path to grant a verified active
   operator. Do not restore e-mail-based authorization or relax the SysOp
   guard.
3. Confirm the audit event, the positive verification result, the profile-menu
   visibility, and direct `/sysop` access for the restored operator.
4. Confirm a viewer remains redirected away from `/sysop`.

## Security analysis

**Strawman:** Infer SysOp access from an e-mail address or organization-admin
role. Rejected because it is neither explicit nor safely auditable.

**Steelman:** Use the persisted platform-operator entitlement, enforce active
account status and IP controls, prevent ordinary last-operator revocation, and
check continuity before every release and hourly thereafter. Adopted.

**Pre-Mortem:** A restore, manual database operation, or last-operator revoke
could leave the platform with no recovery operator. The release gate, hourly
monitor, transactional revoke lock, audit trail, and documented successor-first
procedure detect or prevent that state without exposing tenant data.
