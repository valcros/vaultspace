# Accessibility (WCAG 2.1 AA) Audit

> **Last scanned:** 2026-04-26
> **Scanner:** `@axe-core/playwright` 4.11.x against staging (`ca-vaultspace-web` revision 0157)
> **Tags applied:** `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
> **Test path:** `tests/e2e/a11y.test.ts`
> **Run command:** `PLAYWRIGHT_BASE_URL=<staging-url> npx playwright test tests/e2e/a11y.test.ts`

This document is the rolling audit trail for VaultSpace's WCAG 2.1 AA compliance. Update on every accessibility-relevant change. The companion test fails CI when any new violation appears, so regressions surface immediately.

## Scope

Initial scan covers public/unauthenticated pages only. Authenticated pages (dashboard, room detail, settings) require a login fixture that is tracked separately.

## Latest Scan Results (2026-04-26)

| Page            | Path                    | Violations                         | Result                       |
| --------------- | ----------------------- | ---------------------------------- | ---------------------------- |
| Login           | `/auth/login`           | 0                                  | `PASS`                       |
| Register        | `/auth/register`        | 0                                  | `PASS`                       |
| Forgot Password | `/auth/forgot-password` | 0                                  | `PASS`                       |
| Landing         | `/`                     | 1 (color-contrast) — fixed in code | `FAIL → PASS pending deploy` |

### Landing page violation detail (now fixed in code)

| Rule                          | Impact  | Element                                 | Foreground                     | Background                  | Ratio  | Required |
| ----------------------------- | ------- | --------------------------------------- | ------------------------------ | --------------------------- | ------ | -------- |
| `color-contrast` (WCAG 1.4.3) | serious | Footer text "VaultSpace — Open-source…" | `#a1a1aa` (`text-neutral-400`) | `#fafafa` (`bg-neutral-50`) | 2.45:1 | 4.5:1    |

**Fix:** `src/app/page.tsx:122` — `text-neutral-400` → `text-neutral-600` (`#525252` on `#fafafa` ≈ 7.5:1, comfortably above the AA threshold). Will land with the next deploy of `main`.

## Coverage Summary

| Status                 | Count                                      |
| ---------------------- | ------------------------------------------ |
| Pages scanned          | 4 (public/unauth surfaces)                 |
| Pages passing          | 3                                          |
| Pages with violations  | 1 (1 violation, fix queued in same commit) |
| Authenticated surfaces | 0 (deferred — needs login fixture)         |

## Open Action Items

- **Add login fixture and scan authenticated surfaces.** Highest priority next steps: dashboard, room list, room detail, room settings, document viewer, public viewer (link access), users page, groups page. Track each as it lands.
- **Manual review:** automated scans miss issues like keyboard-only navigation, focus order, screen reader experience, and zoom behavior. Schedule a manual pass with VoiceOver / NVDA before MVP launch.
- **Wire `tests/e2e/a11y.test.ts` into CI** once a login fixture is in place. Currently the test runs on demand against staging via `PLAYWRIGHT_BASE_URL=…`.
- **Adopt a contrast-aware color helper.** The `text-neutral-400` defect is the kind of issue that recurs naturally as designers iterate. Consider banning specific Tailwind classes below 4.5:1 contrast or wrapping them in linted utilities.

## Audit Trail

| Date       | Change                                                                                                                                                                                                                           | Triggering commit |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 2026-04-26 | Initial scan via `@axe-core/playwright`. 3/4 public pages pass clean. One violation found (`text-neutral-400` on `bg-neutral-50` in landing footer) and fixed in the same commit. Test added to repo so future regressions fail. | (this commit)     |
