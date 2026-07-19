# AI Automated Testing: Test Credentials Plan

**Status:** Proposed
**Created:** 2026-07-18
**Context:** During the 2026-07-19 login/invite investigation, validating a real login end to end was blocked because there was no safe, durable test credential for AI-driven browser checks against staging. This plan closes that gap.

## Goal

Give automated and AI-driven test runs a durable, safe way to authenticate against staging (and, later, a locked-down production synthetic path) without hardcoding secrets and without an AI agent ever handling a real password.

## Constraints that shape the design

1. **Tenant isolation / RLS.** A test identity must live in a dedicated QA organization and never be a member of a real tenant (Brightside, and so on). RLS then structurally prevents the test account from reading real data even if a test misbehaves.
2. **AI guardrails.** The interactive AI agent is prohibited from typing passwords or creating accounts. The primary mechanism must therefore be session injection (mint a session, set the cookie), not form based password login. Password login stays available for non-AI CI (Playwright), where typing a seeded password is fine.
3. **No secrets in git.** Credentials and any minting key come from Key Vault and GitHub Actions secrets, mirroring the existing `secretRef` pattern. The `.private/` area stays gitignored.
4. **Staging only for known-password accounts.** Never provision a known-password test account in production. Production validation uses a separate, tightly scoped synthetic account whose credentials live only in Key Vault, ideally read only.

## Current state (what already exists)

- Session cookie is `vaultspace-session` (`src/lib/constants.ts`), DB backed sessions.
- `prisma/seed.ts` creates the `series-a-funding` org with `admin@demo.vaultspace.app`, `investor1@demo.vaultspace.app`, `investor2@demo.vaultspace.app` (bcrypt, 12 rounds).
- `tests/e2e/auth.setup.ts` logs in via `PLAYWRIGHT_ADMIN_EMAIL` / `PLAYWRIGHT_ADMIN_PASSWORD` and saves `storageState`.
- QA smoke scripts exist: `scripts/qa-smoke-test.js`, `scripts/qa-worker-flow-smoke-test.js`.
- **Password drift to resolve:** `auth.setup.ts` defaults to `Demo123!`, `seed.ts` uses `DEMO_PASSWORD`, and `SEED_DATA.md` documents `password123`. The plan unifies these behind one Key Vault secret.

## The three building blocks

### 1. A dedicated QA tenant and personas (seed script)

Create and refresh an isolated org `qa-automation` (display name prefixed "QA -" and marked with an isolation flag so reports, analytics, and billing exclude it). Populate the personas that exercise every auth path:

- `qa-admin@vaultspace.test`: ADMIN. Dashboard, admin pages, invite and link management.
- `qa-viewer@vaultspace.test`: VIEWER. Viewer dashboard, read only.
- `qa-invitee@vaultspace.test`: seeded as a PENDING invitation, to exercise invite accept plus register.
- A viewer share link into a QA room, to exercise the public `/view/[token]` path including the email gate and NDA gate.

Passwords come from a single Key Vault secret (`QA_TEST_PASSWORD`), not the source tree.

Implementation: add `scripts/seed-qa.ts` (or extend `prisma/seed.ts`), idempotent via upsert, reading `QA_TEST_PASSWORD` from env. Runnable against staging with the admin DB URL. Gate it to refuse to run when the target database or `APP_URL` looks like production.

### 2. A session-minting helper (the AI-safe path)

Add `scripts/qa-mint-session.ts` (operator tool, non-production only) that, given a QA email, creates a valid `Session` row and prints the `vaultspace-session` cookie value plus a ready to use Playwright `storageState` JSON. The AI browser harness sets that cookie on the staging domain and is authenticated instantly, with no password typed. This:

- respects the "no password entry" guardrail,
- is deterministic and fast (no email or 2FA round trips),
- can target any persona.

Guard it hard: refuse unless the target is staging and an explicit `QA_MINT_ENABLED` flag or secret is present. It uses the admin DB connection (the same secret the deploy uses), so it is an operator tool, not a public endpoint.

Optional variant: a non-production-only, secret-gated endpoint `POST /api/testing/session` that mints a QA session for an allowlisted QA email, compiled or enabled only when `NODE_ENV !== production` and `TEST_AUTH_SECRET` is set. Prefer the endpoint form if the harness cannot reach the database; prefer the script form for least exposure.

### 3. Token and email retrieval for link-based flows

Invite accept, password reset, and 2FA need a token that normally arrives by email. For automated tests:

- **Preferred (staging):** the harness reads the token directly from the database (`invitations.invitationToken`, `password_reset_tokens.token`) using the operator DB connection, exactly as done during the 2026-07-19 incident. No real email needed.
- **Alternative:** point QA account email at a mailbox the harness can read (the Gmail or Microsoft 365 integrations already available), or an ACS catch-all inbox, then parse the link. Use this only when validating real email delivery is the point of the test.
- **2FA:** keep QA accounts 2FA off by default. Add one `qa-2fa@vaultspace.test` persona with a known TOTP secret so the harness can compute codes when 2FA coverage is needed.

## Secret storage and retrieval

- Store `QA_TEST_PASSWORD`, `TEST_AUTH_SECRET` (if the endpoint form is used), and the QA TOTP secret in Key Vault. Surface them to CI as GitHub Actions secrets and to operators via `az keyvault secret show`.
- Never commit them. Keep naming and rotation notes in `.private/` alongside the existing staging notes.
- Rotate on a schedule and on personnel change. The seed script re-applies the current password, so rotation is a secret update plus a re-seed.

## Guardrails (non-negotiable)

- The QA org is isolated (its own tenant), flagged, and excluded from analytics, billing, and report queries.
- Known-password and session-minting tooling is staging only and refuses to run against production (host or URL check plus an explicit enable flag).
- The minting script or endpoint is gated by a secret, and the endpoint form is compiled out of production builds.
- Test data is disposable: `scripts/reset-qa.ts` wipes and re-seeds the QA org scoped strictly by `organizationId`, never touching real tenants.
- Production validation uses a separate, minimal, ideally read-only synthetic account with Key Vault-only credentials and no known-password seeding.

## Suggested rollout

1. Land `scripts/seed-qa.ts` plus the `qa-automation` org and personas; wire `QA_TEST_PASSWORD` from Key Vault. This also unifies the seed and e2e password drift.
2. Point Playwright `PLAYWRIGHT_ADMIN_EMAIL` / `PLAYWRIGHT_ADMIN_PASSWORD` at the QA persona sourced from the secret.
3. Add `scripts/qa-mint-session.ts` for AI-driven browser runs and document the cookie-injection recipe for the Chrome harness.
4. Add DB token-read helpers (or the mailbox integration) for invite and reset flows.
5. Add `scripts/reset-qa.ts` and a CI check that the QA org stays isolated.
6. Decide script versus endpoint for minting based on whether the AI harness has database reach.

## Open questions

- Script versus endpoint for session minting: does the AI harness have database reach in the environments where it runs?
- Real-email coverage: do we want at least one test that exercises ACS delivery end to end via a real inbox, or is DB token reading sufficient?
- Production synthetic monitoring: in scope now, or staging only first?
- Where the QA isolation flag lives: a boolean or enum on `organizations`, or a naming convention.

## References

- `src/lib/constants.ts` (session cookie name and config)
- `prisma/seed.ts`, `SEED_DATA.md` (existing demo accounts)
- `tests/e2e/auth.setup.ts` (Playwright login fixture and storageState pattern)
- `scripts/qa-smoke-test.js`, `scripts/qa-worker-flow-smoke-test.js` (existing smoke tooling)
- `BACKLOG.md` (Medium Priority: "Durable QA account and smoke-secret handling for staging")
