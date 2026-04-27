# Accessibility (WCAG 2.1 AA) Audit

> **Last scanned:** 2026-04-27
> **Scanner:** `@axe-core/playwright` 4.11.x against staging (`ca-vaultspace-web` revision 0167)
> **Tags applied:** `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
> **Test path:** `tests/e2e/a11y.test.ts` (auth setup at `tests/e2e/auth.setup.ts`)
> **Run command:** `PLAYWRIGHT_BASE_URL=<staging-url> npx playwright test tests/e2e/a11y.test.ts`

This document is the rolling audit trail for VaultSpace's WCAG 2.1 AA compliance. Update on every accessibility-relevant change. The companion test fails when any new violation appears, so regressions surface immediately.

## Scope

Public surfaces (landing, login, register, forgot-password) and the primary authenticated surfaces (dashboard, rooms list, users, groups, activity, settings hub + organization + notifications) are scanned automatically. Per-resource pages (specific room detail, document viewer, link viewer) and admin destructive flows are out of the automated scope; they remain on the manual-pass checklist.

## Latest Scan Results (2026-04-27, revision 0167, image `d74b03e`)

| Group         | Page                     | Path                      | Violations | Result |
| ------------- | ------------------------ | ------------------------- | ---------- | ------ |
| Public        | Landing                  | `/`                       | 0          | `PASS` |
| Public        | Login                    | `/auth/login`             | 0          | `PASS` |
| Public        | Register                 | `/auth/register`          | 0          | `PASS` |
| Public        | Forgot Password          | `/auth/forgot-password`   | 0          | `PASS` |
| Authenticated | Dashboard                | `/dashboard`              | 0          | `PASS` |
| Authenticated | Rooms List               | `/rooms`                  | 0          | `PASS` |
| Authenticated | Users                    | `/users`                  | 0          | `PASS` |
| Authenticated | Groups                   | `/groups`                 | 0          | `PASS` |
| Authenticated | Activity                 | `/activity`               | 0          | `PASS` |
| Authenticated | Settings (hub)           | `/settings`               | 0          | `PASS` |
| Authenticated | Settings → Organization  | `/settings/organization`  | 0          | `PASS` |
| Authenticated | Settings → Notifications | `/settings/notifications` | 0          | `PASS` |

## Coverage Summary

| Status                | Count                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Pages scanned         | 12 (4 public + 8 authenticated)                                                          |
| Pages passing         | 12                                                                                       |
| Pages with violations | 0                                                                                        |
| Out of scope          | per-resource pages, document viewer, viewer link landing (manual pass before MVP launch) |

## Findings Closed Across the 2026-04-26 / 2026-04-27 Audit

| Rule                                              | Impact   | Page(s)             | Element                                                     | Fix                                                                                        |
| ------------------------------------------------- | -------- | ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `color-contrast` (WCAG 1.4.3)                     | serious  | Landing footer      | `text-neutral-400` (`#a1a1aa`) on `bg-neutral-50` (~2.45:1) | `src/app/page.tsx:122` → `text-neutral-600` (commit `7701808`)                             |
| `scrollable-region-focusable` (WCAG 2.1.1, 2.1.3) | serious  | Settings, Activity  | `<main class="overflow-y-auto">` not keyboard-focusable     | `tabIndex={0}` + `aria-label` on `<main>` in `DockShell` and `AppShell` (commit `4664208`) |
| `button-name`                                     | critical | Activity filter     | Radix Select trigger had no accessible name                 | `aria-label="Filter activity by event type"` + `aria-hidden` on icon (commit `d74b03e`)    |
| `color-contrast` (WCAG 1.4.3)                     | serious  | Activity event meta | `text-neutral-400` on white (date / IP / type spans)        | Light mode → `text-neutral-600`; dark mode preserved (commit `d74b03e`)                    |

## Open Action Items

- **Per-resource pages:** scan `/rooms/[roomId]`, `/rooms/[roomId]/settings`, `/rooms/[roomId]/audit`, `/rooms/[roomId]/trash`, `/rooms/[roomId]/analytics`, room detail tabs, the document viewer iframe, and the public viewer link landing flow. Each requires a real room/document/link to exist; add Playwright fixture utilities to seed data per test before scanning.
- **Manual review:** automated scans miss issues like keyboard-only navigation, focus order, screen reader experience, and zoom behavior. Schedule a manual pass with VoiceOver / NVDA before MVP launch.
- **Wire `tests/e2e/a11y.test.ts` into CI.** Auth setup now uses demo credentials against the staging URL — port that into the CI workflow with `PLAYWRIGHT_BASE_URL` so a regression on any of the 12 pages fails the build.
- **Adopt a contrast-aware color helper.** Two `text-neutral-400` defects in two days suggest the class is too easy to reach for body text. Consider an ESLint or stylelint rule banning specific low-contrast Tailwind classes outside dark-mode contexts, or wrap in linted utilities like `<MutedText>` that pick the right contrast per surface.

## Audit Trail

| Date       | Change                                                                                                                                                                                                                                                          | Triggering commit |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 2026-04-26 | Initial scan via `@axe-core/playwright`. 3/4 public pages pass clean. One violation found (`text-neutral-400` on `bg-neutral-50` in landing footer) and fixed in the same commit. Test added so future regressions fail.                                        | `7701808`         |
| 2026-04-26 | Landing-footer fix shipped in revision 0159. Re-scan: 4/4 public pages clean.                                                                                                                                                                                   | `b0f3375`         |
| 2026-04-27 | Added `tests/e2e/auth.setup.ts` storage-state fixture and extended a11y suite to 8 authenticated pages. First authenticated scan flagged Activity and Settings for `scrollable-region-focusable` on the shell `<main>` element.                                 | `b10b50a`         |
| 2026-04-27 | `tabIndex={0}` + `aria-label="Main content"` + `focus:outline-none` on `<main>` in `DockShell` and `AppShell`. Re-scan: 12/13 (Activity still flagged for an unrelated Select trigger and color-contrast issue).                                                | `4664208`         |
| 2026-04-27 | Activity Select trigger gets `aria-label="Filter activity by event type"`; event-meta row light mode bumped from `text-neutral-400` to `text-neutral-600`. Re-scan against revision 0167: **13/13 pass clean** (4 public + 8 authenticated + auth-setup green). | `d74b03e`         |
