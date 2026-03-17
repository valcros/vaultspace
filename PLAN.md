# Architectural Review & MVP Implementation Plan

## Executive Summary

This document provides a comprehensive architectural review of VaultSpace's permission model and outlines the implementation plan for missing MVP features: folder delete, share links, and member management.

---

## Part 1: Permission Model Architecture Review

### Current Implementation (PermissionEngine)

The `PermissionEngine` at `src/lib/permissions/PermissionEngine.ts` implements a **14-layer evaluation algorithm**:

```
Layer 0:  System actor check (bypass all)
Layer 1:  Organization ADMIN role (full access to all org resources)
Layer 2:  Room-level ADMIN role (full access to room resources)
Layer 3-5: Explicit user permissions (document → folder → room)
Layer 6:  Group membership permissions
Layer 7:  Link-based access (viewer sessions)
Layer 8-14: Inheritance from parent resources
Default:  Deny access
```

### Permission Levels
```typescript
type PermissionLevel = 'NONE' | 'VIEW' | 'DOWNLOAD' | 'ADMIN';

// Action requirements:
const actionRequirements = {
  view: 'VIEW',
  download: 'DOWNLOAD',
  admin: 'ADMIN',
  delete: 'ADMIN',
  manage_permissions: 'ADMIN',
};
```

### Key Finding: Admin Users Have Full Access

**Organization ADMINs** (Layer 1) and **Room ADMINs** (Layer 2) automatically have `ADMIN` level access, which grants ALL actions including:
- view
- download
- admin
- delete
- manage_permissions

**This means admin users already have programmatic permission to perform all operations.** The issue is that the UI hasn't been wired to call the backend APIs.

### Permission Check Pattern

All APIs should follow this pattern:
```typescript
const permissionEngine = getPermissionEngine();
const canPerform = await permissionEngine.can(
  { userId: session.userId, role: session.organization.role },
  'admin',  // or 'view', 'download', 'delete'
  { type: 'ROOM', organizationId, roomId },
  tx  // Pass transaction for RLS context
);
```

---

## Part 2: MVP Feature Gap Analysis

### Features Implemented (Backend) but Not Wired (UI)

| Feature | API Status | UI Status | MVP Feature ID |
|---------|------------|-----------|----------------|
| Document Preview | ✅ Implemented | ✅ Just wired | F008 |
| Document Download | ✅ Implemented | ✅ Just wired | F014 |
| Document Delete | ✅ Implemented | ✅ Just wired | F114 |
| Share Link Create | ✅ Implemented | ❌ UI disabled | F116 |
| Share Link List | ✅ Implemented | ✅ Shows in UI | F116 |
| Team Invite | ✅ Implemented | ❌ UI disabled | F044 |
| Folder Create | ✅ Implemented | ✅ Working | F006 |
| Folder List | ✅ Implemented | ✅ Working | F006 |

### Features Missing (Backend + UI)

| Feature | API Status | UI Status | MVP Feature ID |
|---------|------------|-----------|----------------|
| Folder Delete | ❌ Missing | ❌ Disabled | F114 |
| Folder Rename | ❌ Missing | ❌ Not shown | F006 |
| Share Link Delete | ❌ Missing | ❌ Disabled | F116 |
| Share Link Edit | ❌ Missing | ❌ Disabled | F116 |
| Room Member Add | Partial (room admins API exists) | ❌ Disabled | F044 |
| Room Member Remove | ✅ Exists | ❌ Not shown | F044 |

---

## Part 3: Implementation Plan

### Phase 1: Folder Operations (F114, F006)

**1.1 Create Folder Delete API**
- Path: `src/app/api/rooms/[roomId]/folders/[folderId]/route.ts`
- Methods: DELETE, PATCH (for rename)
- Permission: Requires `admin` action on ROOM
- Behavior: Soft delete (recursive) - move folder and all contents to DELETED status

**1.2 Update Room Page UI**
- Enable folder delete in dropdown menu
- Add confirmation dialog
- Wire to DELETE API

### Phase 2: Share Link Operations (F116)

**2.1 Create Share Link Management API**
- Path: `src/app/api/rooms/[roomId]/links/[linkId]/route.ts`
- Methods: PATCH (edit), DELETE
- Permission: Organization ADMIN only

**2.2 Update Room Page UI**
- Enable "Create Link" button in dialog
- Wire to POST `/api/rooms/:roomId/links`
- Add edit/delete actions to link cards

### Phase 3: Member Management (F044)

**3.1 Wire Room Admin Management**
- Existing APIs:
  - GET `/api/rooms/:roomId/admins` - List room admins
  - POST `/api/rooms/:roomId/admins` - Add room admin
  - DELETE `/api/rooms/:roomId/admins/:userId` - Remove room admin

**3.2 Update Room Page UI**
- Enable "Add Admin" button
- Wire to POST API
- Enable remove action in member list

---

## Part 4: Detailed Implementation

### 4.1 Folder Delete API

```typescript
// src/app/api/rooms/[roomId]/folders/[folderId]/route.ts

// DELETE - Soft delete folder and contents
export async function DELETE(request, context) {
  const session = await requireAuth();
  const { roomId, folderId } = await context.params;

  await withOrgContext(session.organizationId, async (tx) => {
    // Permission check
    const canDelete = await permissionEngine.can(
      { userId: session.userId, role: session.organization.role },
      'delete',
      { type: 'ROOM', organizationId, roomId },
      tx
    );

    // Recursive soft delete: folder + subfolders + documents
    await softDeleteFolderRecursive(tx, folderId, roomId, organizationId);
  });
}

// PATCH - Rename folder
export async function PATCH(request, context) {
  // Similar pattern, update name field
}
```

### 4.2 Share Link Management API

```typescript
// src/app/api/rooms/[roomId]/links/[linkId]/route.ts

// DELETE - Deactivate link
export async function DELETE(request, context) {
  // Set isActive = false
}

// PATCH - Update link settings
export async function PATCH(request, context) {
  // Update name, password, expiry, etc.
}
```

### 4.3 UI Wiring Pattern

For each feature, the pattern is:
1. Add state for dialog/loading
2. Add handler function that calls API
3. Remove `disabled` from menu item
4. Add `onClick` to call handler
5. Add confirmation dialog if needed

---

## Part 5: Security Considerations

### Permission Enforcement Points

1. **API Layer** (Primary): All APIs must check permissions using PermissionEngine
2. **RLS Layer** (Defense in depth): Prisma queries run within `withOrgContext()`
3. **UI Layer** (UX only): Disabled buttons are UX hints, not security

### Multi-tenant Isolation

- Every query includes `organizationId` filter
- RLS context set via `SET LOCAL vaultspace.current_organization_id`
- Cross-tenant access returns 404 (not 403) to prevent existence disclosure

### Audit Trail

All mutations emit events via EventBus:
```typescript
await eventBus.emit('FOLDER_DELETED', {
  roomId,
  folderId,
  description: `Deleted folder: ${folder.name}`,
});
```

---

## Part 6: Implementation Priority

### Immediate (Complete MVP functionality):

1. **Folder Delete** - Blocks users from managing folder structure
2. **Share Link Create** - Blocks sharing with external viewers
3. **Member Add** - Blocks team collaboration

### Secondary (Improve user experience):

4. Folder Rename
5. Share Link Edit/Delete
6. Member Remove (API exists, wire UI)

---

## Part 7: Files to Create/Modify

### New Files:
- `src/app/api/rooms/[roomId]/folders/[folderId]/route.ts`
- `src/app/api/rooms/[roomId]/links/[linkId]/route.ts`

### Files to Modify:
- `src/app/(admin)/rooms/[roomId]/page.tsx` (wire all UI actions)

---

## Conclusion

The PermissionEngine is well-architected and already grants admin users full access. The gap is primarily in:

1. **Missing backend APIs** for folder delete and link management
2. **Disabled UI elements** that need to be wired to existing/new APIs

The implementation is straightforward following established patterns in the codebase.
