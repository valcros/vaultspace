'use context';

# UI Handoff - 2026-04-12

## Current Repo State

- Branch: `main`
- Local status: clean
- Latest pushed commit: `c88fad6`
- Latest deployed app tested at: `https://vaultspace.org`
- CI/deploy status at handoff: green for `c88fad6`

## What Was Completed

### Dashboard

- Reworked the dashboard from an unstable widget-board default into a curated default composition.
- Preserved edit mode for layout customization.
- Improved dashboard card readability, spacing, and density controls.
- Added layout-version migration so older persisted dashboard layouts are replaced with the newer curated default.

### Shared Admin UI System

- Added shared admin page primitives in `src/components/layout/admin-page.tsx`:
  - `AdminPageContent`
  - `AdminSurface`
  - `AdminToolbar`
  - `AdminEmptyState`
- Migrated major admin pages onto that system for cleaner, more consistent content surfaces.

### Admin Pages Aligned

- `users`
- `groups`
- `activity`
- `search`
- `messages`
- `settings` index
- `settings/activity`
- `settings/api`
- `settings/notification-templates`
- `settings/notifications`
- `settings/organization`
- `settings/security`
- `settings/shortcuts`
- `settings/webhooks`

### Room Experience

- Improved room detail shell in `src/app/(admin)/rooms/[roomId]/page.tsx`
- Improved room settings in `src/app/(admin)/rooms/[roomId]/settings/page.tsx`

### External / Viewer Flows

- Added shared viewer shell in `src/components/layout/viewer-shell.tsx`
- Aligned:
  - `src/app/view/[shareToken]/page.tsx`
  - `src/app/view/[shareToken]/documents/page.tsx`
  - `src/app/view/[shareToken]/documents/[documentId]/page.tsx`
  - `src/app/view/[shareToken]/questions/page.tsx`

### Auth Flows

- Improved auth shell in `src/app/auth/layout.tsx`
- Improved page content/copy/hierarchy for:
  - login
  - register
  - forgot-password
  - reset-password

### Navigation Trust Fixes

- Removed broken `/settings/profile` entry from the dock header.
- Replaced raw dock anchors with `next/link` in the dock shell.

## Contrast Research And Direction

### Standards Used

- WCAG 2.2 AA:
  - normal text: `4.5:1`
  - large text: `3:1`
  - non-text UI indicators: `3:1`
- Practical product target:
  - primary reading text: aim for `7:1+`
  - secondary text: aim for `5.5:1+`
  - small utility text should not sit near the minimum if it is operationally important
- APCA-informed guidance:
  - body text should be closer to `Lc 75` minimum / `Lc 90` preferred
  - utility/support text should remain clearly above low-contrast decorative ranges

### Design Lessons Captured

- Avoid gradients and transparency behind content-heavy reading surfaces.
- Use gradients mainly for hero/brand surfaces.
- Use flatter, more opaque panels for forms, lists, controls, and viewer chrome.
- Small uppercase labels need more contrast than many UI systems give them.
- Dark mode needs stronger text than soft `slate-400` style choices if the text matters.

## Remaining High-Value UI Work

### Highest Priority

1. Room secondary pages:
   - `src/app/(admin)/rooms/[roomId]/analytics/page.tsx`
   - `src/app/(admin)/rooms/[roomId]/audit/page.tsx`
   - `src/app/(admin)/rooms/[roomId]/trash/page.tsx`
2. Final consistency sweep across:
   - button hierarchy
   - empty states
   - spacing rhythm
   - small metadata contrast
3. Visual QA pass across live pages with screenshots and page-by-page notes

### Things To Watch

- Some dark surfaces may still need contrast tuning after real usage, especially metadata or tertiary text.
- The dock/header/search shell was improved, but should still be checked in both light and dark themes.
- The dashboard is acceptable but should be treated as stable infrastructure now, not a place for more speculative redesign churn.

## Operational Notes

- If `npm run type-check` is run concurrently with `next build`, stale `.next/types` failures can appear.
- The fix is simply to rerun `npm run type-check` sequentially after build output refreshes.
- Deployment path:
  - push to `main`
  - CI workflow: `CI`
  - deploy workflow: `Deploy to Staging`
  - deployed domain currently verified: `vaultspace.org`

## Branch Cleanup

- Local branches checked at handoff:
  - only `main`
- No extra local branches existed to delete.

## Suggested Next Working Style For UI Dev

- Work from shared surfaces first, page specifics second.
- Treat contrast defects as functional readability bugs, not aesthetic preference issues.
- Favor opaque reading surfaces over translucent polished effects.
- Prefer calm hierarchy over adding more components or more chrome.
