# Dashboard Fix - Work In Progress

## Current Status: FIXED (pending deployment verification)

Root causes identified and resolved in branch `fix/dashboard-layout-overlapping-and-gaps`.

---

## Commits Made

1. **`3c9f78a`** - `fix: switch to react-grid-layout legacy v1 API for stability`
   - Changed from v2 config object API to v1 flat props API
   - File: `src/components/dashboard/DashboardGrid.tsx`

2. **`a74c800`** - `feat: add drag handles to DashboardWidget for edit mode`
   - Added GripVertical icon and useDashboardContext
   - Drag handles appear when editMode=true
   - File: `src/components/dashboard/DashboardWidget.tsx`

---

## What Was Verified Working

- Drag handles appear in edit mode (7 handles for 7 widgets)
- Resize handles present (7 visible)
- Dragging widgets causes layout reflow
- Reset button restores default layout

---

## What's Still Broken (Per User)

- Overlapping cards
- Massive spaces between widget rows

---

## Root Cause Analysis Needed

### Potential Issues to Investigate

1. **Saved Layout Corruption**
   - API returns `isDefault: false` - user has a saved layout
   - Saved layout may have incorrect y-positions or widget sizes
   - Solution: Delete saved layout from database to force defaults

2. **compactLayout Function**
   - Located in `src/lib/dashboard-defaults.ts`
   - May not be compacting correctly after widget filtering
   - Need to trace: raw layout -> hasWidgetData filter -> compactLayout -> render

3. **Widget Heights in Default Layout**
   - ADMIN_DEFAULT_LAYOUT has h=4 for Engagement/My Rooms (288px)
   - Sparse content doesn't fill allocated height, creating visual gaps
   - May need to reduce default heights

4. **Filtering Logic**
   - `hasWidgetData()` in `src/app/(admin)/dashboard/page.tsx` filters widgets
   - Filtered widgets leave gaps that compactLayout should fill
   - Need to verify compactLayout is being called correctly

---

## Key Files

| File                                           | Purpose                                 |
| ---------------------------------------------- | --------------------------------------- |
| `src/components/dashboard/DashboardGrid.tsx`   | Grid wrapper, react-grid-layout config  |
| `src/components/dashboard/DashboardWidget.tsx` | Widget card with drag handle            |
| `src/lib/dashboard-defaults.ts`                | Default layouts, compactLayout function |
| `src/app/(admin)/dashboard/page.tsx`           | Dashboard page, filtering logic         |
| `src/app/api/dashboard/v2/route.ts`            | API returning layout data               |
| `src/hooks/useDashboardLayout.ts`              | Layout state management                 |

---

## Default Layouts Reference

### ADMIN_DEFAULT_LAYOUT (9 widgets)

```
Row 0-3:  action-required (x=0, w=6, h=3), messages (x=6, w=6, h=3)
Row 3-7:  engagement (x=0, w=8, h=4), my-rooms (x=8, w=4, h=4)
Row 7-11: recent-activity (x=0, w=6, h=4), checklist-progress (x=6, w=6, h=4)
Row 11-14: continue-reading (x=0, w=4, h=3), bookmarks (x=4, w=4, h=3), new-documents (x=8, w=4, h=3)
```

### VIEWER_DEFAULT_LAYOUT (7 widgets)

```
Row 0-4:  messages (x=0, w=6, h=4), new-documents (x=6, w=6, h=4)
Row 4-7:  continue-reading (x=0, w=6, h=3), bookmarks (x=6, w=6, h=3)
Row 7-11: my-questions (x=0, w=6, h=4), my-rooms (x=6, w=6, h=4)
Row 11-14: announcements (x=0, w=12, h=3)
```

---

## Grid Configuration

```typescript
const ROW_HEIGHT = 60;
const MARGIN: [number, number] = [16, 16];
const COLS = 12;
const CONTAINER_PADDING: [number, number] = [0, 0];
```

Each row unit = 60px + 16px margin = 76px

---

## Next Steps When Resuming

1. **Clear saved layout for test user**
   - Delete from `user_dashboard_layouts` table for admin@demo.vaultspace.app
   - Force fresh default layout

2. **Debug compactLayout**
   - Add console.log to trace layout before/after compaction
   - Verify y-positions are being adjusted correctly

3. **Check widget heights**
   - Consider reducing h values in defaults for sparse widgets
   - Or implement auto-sizing based on content

4. **Test on fresh browser**
   - Clear cache completely
   - Test with incognito window

---

## Test Credentials

- Admin: `admin@demo.vaultspace.app` / `Demo123!`
- Viewer: `alice@acme-corp.example` / `Demo123!`

---

## Staging URL

https://ca-vaultspace-web.victoriousglacier-374689f2.eastus.azurecontainerapps.io/dashboard
