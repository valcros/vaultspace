# W1-2 Session Resolve Route Conversion, Clarified Analysis

- **Date:** 2026-08-12
- **Supersedes:** `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v1.md`
- **Analysis commit:** `df008e2`
- **Starting main:** `918307ca24454fd5bc0586bbbe2355a512cafe16`
- **Status:** Implementation in progress, not merged, not deployed

## 1. Purpose of this version

The v1 record established the correct read-only session conversion boundary before implementation.
Focused tests clarified one error-handling sentence while preserving that boundary. This v2 record
documents the exact behavior rather than modifying the committed v1 analysis.

All v1 scope, migration, ACL, testing, production-gate, rollback, exclusion, Strawman, Steelman, and
Pre-Mortem requirements remain binding except where this file explicitly clarifies them.

## 2. Error-handling clarification

The v1 server-component test requirement said an operationally failed resolution should return
null. That would convert a database or repository outage into an ordinary login redirect and could
hide an operational incident.

The corrected contract is:

- a null result from `BootstrapRepository.resolveSession` is a neutral unresolved session and
  returns null from the server-component helper;
- a malformed token produces the same neutral no-row behavior through the repository;
- an operational repository failure propagates to the existing server error boundary;
- no exception message, database code, SQL text, token, session ID, user ID, organization ID, or
  email is logged by the helper; and
- middleware `getSession` and `getSessionFromRequest` retain their existing catch-to-null behavior
  in this unit. Changing that public API behavior is not added to scope.

The new server-component regression tests prove both the neutral no-row case and operational-error
propagation.

## 3. Cache and authoritative-read clarification

The constrained function remains the source of truth on every session acceptance, including when a
complete Redis snapshot exists. The cache is accepted only if the live projection matches all
security-relevant identity and membership fields:

- session, user, and organization IDs;
- idle and absolute timestamps;
- user identity and active state;
- organization identity;
- role; and
- management flags.

A null live projection rejects the session. A mismatched live projection replaces the cache with
the authoritative mapped projection. Cache deletion failure remains non-fatal and categorical
through the established cache-cleanup contract.

The live projection also supplies `lastActiveAt`, allowing the existing five-minute throttled
sliding refresh to remain scheduled after successful resolution. Refresh itself remains on the
established mutation path and is not converted by this unit.

## 4. Exact implementation boundary

This unit changes only:

- one fail-closed migration granting `vaultspace_app` EXECUTE on exactly
  `public.bootstrap_session_resolve_v1(text)`;
- disposable RLS setup to reproduce the exact routed login-plus-session grant matrix;
- `validateSession` authoritative reads;
- `getServerComponentSession` authoritative reads;
- focused unit and integration tests; and
- versioned validation evidence.

This unit still does not change session creation, activity mutation, logout, invalidation,
password-reset revocation, membership-change revocation, organization resolution, custom-domain
middleware, public branding, two-factor completion, registration, viewer sessions, public links,
the web entrypoint, `DATABASE_URL_ADMIN`, W1-3, or P0-4.

## 5. Status

**W1-2 UNIT 5 SESSION RESOLVE CONVERSION: ANALYSIS CLARIFIED, IMPLEMENTATION IN PROGRESS, NOT
MERGED, NOT DEPLOYED.**

W1-2 Units 1 through 4 remain acceptance-closed. W1-2 overall remains OPEN. The production runtime
grant still covers login only until a later controlled merge and deploy. The security freeze is
active. P0-4 remains accepted and unchanged.

## References

- `docs/W1_2_SESSION_RESOLVE_ROUTE_CONVERSION_2026-08-12_v1.md`
- `docs/W1_2_DATABASE_PRIVILEGE_SPLIT_DESIGN_2026-08-10_v1.md`
- `src/lib/auth/session.ts`
- `src/lib/auth/serverComponentSession.ts`
- `src/lib/auth/serverComponentSession.test.ts`
- `prisma/migrations/20260812163000_w1_2_session_route_conversion/migration.sql`
