# Admin User Management — Implementation Plan

**Status:** Ready to implement (deliberately deferred to a fresh session because
it mutates auth identity + role and is security-sensitive).
**Created:** 2026-07-19

Two features for the Users screen: (1) admins edit a user's attributes, (2)
admins trigger a password reset. Scope decided with the lead: existing
attributes only — `name`, `title` (job title), `email`, org `role`, `isActive`,
plus a 2FA reset. `company`/`phone`/`type` are NOT in scope (they need the
deferred "Full User Profiles & NDA-on-File" schema work first).

## Where things live (important)

- `email`, `firstName`, `lastName`, `title`, `isActive`, `twoFactorEnabled`,
  `twoFactorSecret`, `twoFactorBackupCodes` are on the **global `User`** — shared
  across every org the user belongs to. Editing them is cross-tenant; allow
  name/title freely, treat **email** cautiously (see below).
- `role` (ADMIN/VIEWER) and membership `isActive` are on the per-org
  **`UserOrganization`**.
- Existing route: `src/app/api/users/[userId]/route.ts` has GET + DELETE (soft
  delete) and org-scopes via the `userOrganization` join. **No PATCH yet.**
- Session-invalidation contract (from `src/lib/auth/session.ts`): "any endpoint
  that mutates membership, role, or user active state MUST deactivate sessions
  and call clearSessionCache." Helpers: `deactivateAllUserSessionsInTx(tx, userId)`
  - `clearSessionCache(tokens)` (see `reset-password/route.ts` for the pattern).

## Feature 1 — Admin edit user (`PATCH /api/users/[userId]`)

**Guards (server-side, in order):** `requireAuth()` → `role === 'ADMIN'` else 403
→ target must be a member of the caller's org (reuse the existing
`userOrganization` join) else **404** (existence-hiding).

**Editable + rules:**

- `firstName` / `lastName` / `title`: update on `User`. Trim; non-empty for
  first/last.
- `email`: lowercase + trim; validate format; **uniqueness** — catch Prisma
  `P2002` and return 409 "email already in use". Cross-tenant caution: this
  changes the login identity everywhere the user exists. **Invalidate sessions**
  after an email change.
- `role` (on `UserOrganization`): ADMIN↔VIEWER.
- `isActive` (membership): enable/disable in this org.
- `resetTwoFactor` (boolean action): set `twoFactorEnabled=false`,
  `twoFactorSecret=null`, `twoFactorBackupCodes=[]`.

**Must-not-miss security:**

- **Session invalidation:** if `role` demoted (ADMIN→VIEWER), `isActive`→false,
  email changed, or 2FA reset → `deactivateAllUserSessionsInTx` + `clearSessionCache`
  in the same transaction. Otherwise stale sessions keep elevated/valid access
  for up to the 60s cache TTL.
- **Last-admin lockout:** refuse to demote/deactivate the org's only remaining
  active ADMIN (count active admins in the org; block if this is the last one) —
  including the caller editing themselves.
- **Audit:** emit `USER_UPDATED` event with the changed field list (mirror the
  branding route's event pattern), inside the `withOrgContext` transaction.

**Frontend (`src/app/(admin)/users/page.tsx`):** add "Edit" to the per-user
`DropdownMenu` → a `Dialog` with the fields (name, title, email, role select,
active toggle, "Reset 2FA" + "Reset password" actions). Save → `PATCH`; toast +
refetch. The screen is already admin-gated (`useRequireAdmin`).

## Feature 2 — Admin-triggered password reset (`POST /api/users/[userId]/reset-password`)

Secure model: the admin triggers the reset **email**; never sets or sees the
password. Reuses the existing token flow.

- Guards: same as above (admin + org-member-or-404).
- Create a `passwordResetToken` for the target user (as `forgot-password` does),
  then enqueue `EMAIL_SEND` (`password-reset` template) to the user — **using the
  per-org sender** (`from`/`fromName`), which is now supported end-to-end
  (PR #75/#76). Return `{ success: true }`.
- Frontend: "Reset password" in the per-user dropdown → confirm dialog → POST →
  toast "Password reset email sent".

## Tests (SEC pattern, per route)

- non-admin caller → 403; cross-org target → 404.
- edit: last-admin demote/deactivate blocked; email uniqueness → 409; session
  deactivation invoked on role/active/email change.
- reset: token created + `EMAIL_SEND` queued to the target.

## References

- `src/app/api/users/[userId]/route.ts` (GET/DELETE; add PATCH here)
- `src/app/api/auth/forgot-password/route.ts` + `reset-password/route.ts` (token + session-deactivation patterns; per-org sender resolution)
- `src/lib/auth/session.ts` (`deactivateAllUserSessionsInTx`, `clearSessionCache`)
- `src/app/(admin)/users/page.tsx` (Users screen UI)
- `src/app/api/organization/branding/route.ts` (audit-event + admin-gate pattern)
- `docs/EMAIL_SENDER_SETUP.md` (per-org sender, already wired)

## Deferred follow-ups (from Codex review of PR #78, not blocking merge)

Surfaced by a third adversarial review pass. Both are low severity and were
deliberately deferred so the edit-user PR does not expand its blast radius into
unrelated endpoints. Track and address separately.

1. **Reset-password token consumption is not atomic (own ticket, in
   `reset-password/route.ts`).** That route validates the token outside its
   transaction, then rewrites the token by `id` unconditionally after hashing,
   so a token invalidated elsewhere mid-flight can still be consumed. PR #78's
   email-change already invalidates outstanding reset tokens, which closes the
   common case; the residual race is near-theoretical (email change is
   single-org only, and the token was delivered to the OLD address). Proper fix
   lives in reset-password: conditional `updateMany where id = T AND usedAt =
null`, assert `count === 1`, and abort before hashing if it lost the race.
2. **Membership-only edits invalidate the user's sessions in other orgs.** For a
   multi-org user, changing `role`/`isActive` here calls
   `deactivateAllUserSessionsInTx(userId)`, which is org-agnostic. This is
   fail-safe over-invalidation (a UX cost, not a security gap) and near-zero
   impact given the current single-org user base. If addressed: add a NEW
   org-scoped helper (`{ userId, organizationId }`) for membership-only changes
   and reserve full invalidation for global email/2FA mutations. Do NOT change
   `deactivateAllUserSessionsInTx` itself — reset-password relies on it
   invalidating everything.
