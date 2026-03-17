# PERMISSION_MODEL.md - VaultSpace Authorization System

**Feature ID:** F141, F154
**Priority:** MVP
**Status:** Design Specification
**Last Updated:** 2026-03-14

---

## Table of Contents

1. [Overview](#overview)
2. [Core Design Principles](#core-design-principles)
3. [Permission Layers](#permission-layers)
4. [Role Definitions](#role-definitions)
5. [Group System](#group-system)
6. [PermissionEngine API](#permissionengine-api)
7. [Action Types](#action-types)
8. [Permission Resolution Algorithm](#permission-resolution-algorithm)
9. [Caching Strategy](#caching-strategy)
10. [Database Schema](#database-schema)
11. [Middleware Integration](#middleware-integration)
12. [Link Permissions & Constraints](#link-permissions--constraints)
13. [Examples & Walkthroughs](#examples--walkthroughs)
14. [Cross-References](#cross-references)

---

## Overview

The **PermissionEngine** is the single source of truth for all access control decisions in VaultSpace. Every access check—whether through the admin interface, viewer portal, API, or internal service-to-service calls—flows through this centralized module.

### Core Responsibility

The PermissionEngine evaluates whether a given user can perform a specific action on a specific resource. It synthesizes information from:

- **Organization membership and role** (Owner, Admin, Member)
- **Room-level membership and role** (Admin, Viewer)
- **Folder and document inheritance chains**
- **Explicit permission grants and denials**
- **Group membership** (transitive permissions)
- **Link-level permissions** (for anonymous access)
- **Constraint checks**: IP allowlist/blocklist, time-based expiry, NDA status, password protection
- **Resource state**: archived rooms, soft-deleted documents, legal holds

### Design Principle: Deny by Default, Explicit Grants Only

```
No grant → No access
Explicit allow + Explicit deny → Deny wins
Explicit allow only → Allow
```

The PermissionEngine never assumes access. Absence of a grant is equivalent to denial.

---

## Core Design Principles

### 1. Single Responsibility

All permission logic lives in `PermissionEngine`. No scattered permission checks throughout the codebase. All routes, API endpoints, and service methods call `PermissionEngine.canUserPerformAction()` before proceeding.

### 2. Multi-Tenant Isolation

Every permission check is scoped to `organization_id` at the query layer. A user with access to Room A in Organization 1 cannot see Room A in Organization 2, even if both organizations are in the same database.

```typescript
// Every permission check includes organization_id
const canAccess = await permissionEngine.canUserAccessRoom(user, room, 'view', {
  organizationId: user.organization_id,
});
```

### 3. Explicit Deny Wins

If a user has explicit **allow** on a document but explicit **deny** on the containing folder, the **deny** prevails. This prevents security bypasses through inheritance loopholes.

### 4. Auditability

Every permission decision is logged in the event bus (F102). The `explainPermission()` function provides a full chain of reasoning for debugging. Admins can ask "why can Alice see this?" and get a detailed answer.

### 5. Caching for Performance

Permission results are cached with automatic invalidation on permission mutations. Cache keys encode the (user, resource, action, organization) tuple. TTL is short (5 minutes) to balance performance and freshness.

### 6. Link Visitors as a First-Class Concept

Unauthenticated viewers accessing via a shared link have permissions defined entirely by the link, not by user identity. Link permissions are evaluated independently of organization membership.

---

## Permission Layers

The PermissionEngine evaluates permissions in a strict layered order. Each layer acts as a gate; if a layer denies access, evaluation stops and access is denied.

### Layer 1: Multi-Tenant Scoping

**Question:** Does the resource belong to the user's organization?

```typescript
if (resource.organization_id !== user.organization_id) {
  return { allowed: false, reason: 'TENANT_ISOLATION' };
}
```

**Link Visitors:** Link visitors (anonymous via shared link) do NOT bypass tenant scoping. They bypass AUTHENTICATION (no user account required), but the tenant isolation check is always enforced. The link itself must belong to the same organization as the resource: `resource.organization_id == link.organization_id == context.organizationId`.

### Layer 2: Organization Membership

**Question:** Is the user a member of the organization?

```typescript
if (!user.organizationMemberships.includes(org.id)) {
  return { allowed: false, reason: 'NOT_ORG_MEMBER' };
}
```

**Exception:** Link visitors are not required to be org members.

### Layer 3: Organization Role

**Question:** Does the user's org role grant access to this action?

Organization roles define the upper bound of what a user can do:

- **Organization Owner**: Full control. No layer-3 restrictions.
- **Organization Admin**: Can manage rooms, users, settings. Some admin actions require higher privilege.
- **Organization Member**: Limited to viewer-level actions on assigned rooms.

```typescript
const orgRole = user.roleInOrganization; // 'owner' | 'admin' | 'member'

if (orgRole === 'member' && action.requiresAdminRole) {
  return { allowed: false, reason: 'ORG_ROLE_INSUFFICIENT' };
}
```

### Layer 4: Room-Level Membership

**Question:** Is the user a member of this room?

Users can be invited to rooms explicitly, or inherit room access via org-wide admin role.

```typescript
const roomMembership = await db.roomMembership.findUnique({
  where: { userId_roomId: { userId: user.id, roomId: resource.room_id } },
});

if (!roomMembership && orgRole !== 'admin') {
  return { allowed: false, reason: 'NOT_ROOM_MEMBER' };
}
```

**Exception:** Admin users (org or room admin) bypass room membership checks for administrative actions.

### Layer 5: Room-Level Permissions

**Question:** What is the user's role in this room?

Room roles are:

- **Room Admin**: Full control. Can manage documents, permissions, settings.
- **Room Viewer**: Can view/download per document permissions.

```typescript
const roomRole = roomMembership?.role ?? null; // 'admin' | 'viewer'

if (roomRole === 'viewer' && action.requiresRoomAdminRole) {
  return { allowed: false, reason: 'ROOM_ROLE_INSUFFICIENT' };
}
```

### Layer 6: Folder Inheritance

**Question:** What permissions does the folder grant?

If a folder has explicit permissions, they apply to all children (documents) unless overridden. Folder permissions follow an inheritance chain: Document → Folder → Room → Org.

```typescript
const folderPermissions = await db.folderPermission.findMany({
  where: { folderId: folder.id, grantor_id: user.id },
});

// If folder grants access, child documents inherit unless explicitly denied
```

### Layer 7: Document-Level Permissions

**Question:** What permissions does the document have (via ACL or inheritance)?

Document permissions can:

- Be explicitly granted to the user
- Be explicitly granted to a group the user belongs to
- Be inherited from the containing folder
- Be inherited from the room

```typescript
const docPermissions = await getDocumentPermissions(document, user);

if (!docPermissions.includes(action)) {
  return { allowed: false, reason: 'DOC_ACL_DENY' };
}
```

### Layer 8: Link-Level Permissions (if applicable)

**Question:** If the request came through a shared link, what does the link permit?

Link permissions are orthogonal to user permissions. A link can grant "view-only" on a specific document set, even if the user has broader permissions.

```typescript
if (context.linkId) {
  const link = await db.shareLink.findUnique({
    where: { id: context.linkId },
  });

  if (!link.permits(action)) {
    return { allowed: false, reason: 'LINK_PERMISSION_DENY' };
  }
}
```

### Layer 9: Time-Based Constraints

**Question:** Is access allowed at this moment?

Checks include:

- **Link expiry**: Share link has expired
- **Access window**: Scheduled access time (e.g., "view only between 9 AM - 5 PM on weekdays")
- **Document expiry**: Document access revoked after expiry date (F012)
- **Session TTL**: Viewer session has expired

```typescript
if (link.expiresAt && new Date() > link.expiresAt) {
  return { allowed: false, reason: 'LINK_EXPIRED' };
}

if (doc.expiresAt && new Date() > doc.expiresAt) {
  return { allowed: false, reason: 'DOC_EXPIRED' };
}
```

### Layer 10: IP-Based Constraints (V1)

**Question:** Is the request IP within the allowlist/blocklist?

```typescript
const allowedIPs = await db.ipRestriction.findMany({
  where: { roomId: room.id, type: 'allowlist' },
});

if (allowedIPs.length > 0 && !isIPAllowed(context.ip, allowedIPs)) {
  return { allowed: false, reason: 'IP_RESTRICTED' };
}
```

### Layer 11: NDA Requirements (V1)

**Question:** Has the user signed the required NDA?

Some rooms or documents require NDA acceptance before access. F018 defines the NDA gate; here we check compliance.

```typescript
if (room.requiresNDA && !(await user.hasSignedNDA(room.id))) {
  return { allowed: false, reason: 'NDA_NOT_SIGNED' };
}
```

### Layer 12: Password Protection

**Question:** If the link is password-protected, has the correct password been provided?

Checked at link access time. For authenticated users, passwords are verified on first link access and session is created.

```typescript
if (link.passwordProtected) {
  if (!context.hasValidPassword || !bcrypt.compareSync(context.password, link.passwordHash)) {
    return { allowed: false, reason: 'PASSWORD_REQUIRED' };
  }
}
```

### Layer 13: Legal Hold

**Question:** Is the resource under legal hold?

If a document or room is under legal hold (F157), certain actions (delete, modify retention policy) are blocked.

```typescript
if (resource.isUnderLegalHold && ['delete', 'modify_retention'].includes(action)) {
  return { allowed: false, reason: 'LEGAL_HOLD_ACTIVE' };
}
```

### Layer 14: Resource State

**Question:** Is the resource in a state that permits this action?

State checks:

- **Archived rooms**: Permit view/download, deny upload/delete
- **Closed rooms**: Deny all viewer access
- **Soft-deleted documents**: Deny access; only admin recovery is allowed
- **Quarantined documents** (failed scan, F107): Deny access except admin review

```typescript
if (room.status === 'archived' && action === 'upload') {
  return { allowed: false, reason: 'ROOM_ARCHIVED' };
}

if (room.status === 'closed' && !user.isOrgAdmin) {
  return { allowed: false, reason: 'ROOM_CLOSED' };
}
```

---

## Role Definitions

### Organization Roles

#### Organization Owner

- **Scope:** Entire organization
- **Capabilities:**
  - Create/edit/delete rooms
  - Invite/remove org members
  - Assign org member roles
  - Configure org settings (name, logo, domain, email settings)
  - View billing and subscription info (if SaaS)
  - Force logout of other users
  - View audit trail for all rooms
  - Manage API keys
  - Configure integrations (webhooks, SSO, etc.)
- **Limitations:** None. Implicit superset of all other permissions.
- **Count:** Typically 1–3 per organization

#### Organization Admin

- **Scope:** All rooms in the organization
- **Capabilities:**
  - Create/edit/delete rooms and folder hierarchies
  - Upload documents
  - Invite viewers to rooms
  - Manage room permissions (override room admin decisions)
  - View room analytics and audit trail
  - Configure room-level settings
  - Bulk operations (move, tag, delete, reassign permissions)
  - Create and manage groups
- **Limitations:**
  - Cannot modify billing or org settings
  - Cannot change org member roles
  - Cannot force logout other admins
  - Cannot access API keys or integrations (requires org owner)
- **Count:** 1–10 per organization

#### Organization Member

- **Scope:** Only explicitly assigned rooms
- **Capabilities:**
  - View documents in assigned rooms per document permissions
  - Download documents per document permissions
  - May comment or bookmark (if F037 enabled)
  - Access is denied to unassigned rooms, even if they exist
- **Limitations:**
  - Cannot manage any room, folder, or document
  - Cannot invite users
  - Cannot modify permissions
  - Cannot see org settings or analytics
- **Count:** Variable, typically 5–100 per organization

---

### Room Roles

#### Room Admin

- **Scope:** Single room
- **Capabilities:**
  - Manage folder structure (create, rename, move, delete folders)
  - Upload documents to folders
  - Edit document metadata (tags, custom fields)
  - Manage document permissions (set ACLs)
  - Manage document versions (promote/delete versions)
  - Create and manage share links
  - View room analytics
  - Invite room members
  - Modify room settings (allowed actions, watermark, NDA requirement)
- **Limitations:**
  - Cannot delete the room itself (requires org admin)
  - Cannot change room lifecycle state (archive/close)
  - Cannot modify org-level settings
- **Count:** 1–5 per room

#### Room Viewer

- **Scope:** Single room
- **Capabilities:**
  - View documents per folder/document permissions
  - Download documents if download is enabled
  - View document metadata
  - May comment or bookmark (if enabled)
  - May request access to unrestricted documents (F118)
- **Limitations:**
  - Cannot upload documents
  - Cannot manage any permissions
  - Cannot see admin-only features (analytics, user list, audit trail)
- **Count:** 5–1000 per room

---

### Link Visitor (No Authentication)

- **Scope:** Single share link
- **Capabilities:** Defined by link permissions (see Layer 8)
- **Examples:**
  - "view-only on folder /due_diligence/financial_statements"
  - "download-enabled on document /legal/nda.pdf"
  - "password-protected, expires 2026-04-01"
- **Limitations:** Cannot take actions beyond what the link permits

---

## Group System

Groups are a mechanism for bulk permission assignment. They allow admins to define logical sets of users and grant permissions to the group once, rather than to each user individually.

### Group Model

```typescript
interface Group {
  id: string;
  organization_id: string;
  name: string; // e.g., "Investors", "Audit Committee", "Legal Team"
  description?: string;
  created_at: DateTime;
  updated_at: DateTime;
  is_active: boolean;
}

interface GroupMembership {
  id: string;
  group_id: string;
  user_id: string;
  added_at: DateTime;
}
```

### Group CRUD Operations

#### Create Group

```typescript
async createGroup(org: Organization, input: {
  name: string;
  description?: string;
}): Promise<Group> {
  const group = await db.group.create({
    data: {
      organization_id: org.id,
      name: input.name,
      description: input.description,
      is_active: true
    }
  });

  await eventBus.emit('group.created', {
    group_id: group.id,
    organization_id: org.id,
    actor_id: currentUser.id
  });

  // Invalidate permission cache for all group members
  await cache.invalidatePrefix(`permissions:*:group:${group.id}`);

  return group;
}
```

#### Add Member to Group

```typescript
async addGroupMember(group: Group, user: User): Promise<void> {
  // Check if already a member
  const existing = await db.groupMembership.findUnique({
    where: { group_id_user_id: { group_id: group.id, user_id: user.id } }
  });

  if (existing) return; // Idempotent

  const membership = await db.groupMembership.create({
    data: {
      group_id: group.id,
      user_id: user.id
    }
  });

  await eventBus.emit('group_membership.added', {
    group_id: group.id,
    user_id: user.id,
    organization_id: group.organization_id
  });

  // Invalidate user's permission cache
  await cache.invalidatePrefix(`permissions:${user.id}:*`);
}
```

#### Remove Member from Group

```typescript
async removeGroupMember(group: Group, user: User): Promise<void> {
  await db.groupMembership.deleteMany({
    where: {
      group_id: group.id,
      user_id: user.id
    }
  });

  await eventBus.emit('group_membership.removed', {
    group_id: group.id,
    user_id: user.id,
    organization_id: group.organization_id
  });

  // Invalidate user's permission cache
  await cache.invalidatePrefix(`permissions:${user.id}:*`);
}
```

### Group Permissions

Groups can be granted permissions on rooms, folders, and documents.

```typescript
interface GroupPermission {
  id: string;
  group_id: string;
  resource_type: 'room' | 'folder' | 'document';
  resource_id: string;
  action: PermissionAction;
  granted_at: DateTime;
  granted_by: string; // user_id
}
```

Example: Grant the "Investors" group view/download on the "/Due Diligence" folder.

```typescript
async grantGroupPermission(
  group: Group,
  resource: Folder | Document | Room,
  actions: PermissionAction[]
): Promise<void> {
  for (const action of actions) {
    await db.groupPermission.create({
      data: {
        group_id: group.id,
        resource_type: resource.__typename,
        resource_id: resource.id,
        action
      }
    });
  }

  await eventBus.emit('group_permission.granted', {
    group_id: group.id,
    resource_id: resource.id,
    resource_type: resource.__typename,
    actions
  });

  // Invalidate permission cache for all group members
  const members = await db.groupMembership.findMany({
    where: { group_id: group.id }
  });

  for (const member of members) {
    await cache.invalidatePrefix(`permissions:${member.user_id}:*`);
  }
}
```

### Permission Union Model

When a user has both individual permissions and group permissions, the **union** is used. If the user is in Group A with "view" permission and individually has "download" permission on the same document, the effective permission is {"view", "download"}.

```typescript
// Pseudocode for permission resolution with groups
async getEffectivePermissions(user: User, resource: Resource): Promise<Set<Action>> {
  const permissions = new Set<Action>();

  // 1. Direct user permissions
  const direct = await db.permission.findMany({
    where: {
      user_id: user.id,
      resource_id: resource.id
    }
  });

  direct.forEach(p => permissions.add(p.action));

  // 2. Group permissions (union)
  const groupMemberships = await db.groupMembership.findMany({
    where: { user_id: user.id }
  });

  for (const membership of groupMemberships) {
    const groupPerms = await db.groupPermission.findMany({
      where: {
        group_id: membership.group_id,
        resource_id: resource.id
      }
    });

    groupPerms.forEach(p => permissions.add(p.action));
  }

  return permissions;
}
```

### Explicit Denies on Groups

If a user is in a group with "view" permission but has an explicit "deny download" on a document, the deny takes precedence.

```typescript
async canUserDownload(user: User, doc: Document): Promise<boolean> {
  // Check for explicit deny first
  const explicitDeny = await db.permission.findUnique({
    where: {
      user_id_resource_id_action: {
        user_id: user.id,
        resource_id: doc.id,
        action: 'download'
      },
      granted: false
    }
  });

  if (explicitDeny) return false;

  // Then check union of group + direct permissions
  const permissions = await getEffectivePermissions(user, doc);
  return permissions.has('download');
}
```

---

## PermissionEngine API

The `PermissionEngine` class provides the complete public interface for permission checks. All permission decisions flow through these methods.

### TypeScript Interface

```typescript
/**
 * Central authorization engine for VaultSpace.
 *
 * All permission checks in the application must use this interface.
 * Do not implement custom permission logic elsewhere.
 */
export interface PermissionEngine {
  /**
   * Determine if a user can perform an action on a specific document.
   *
   * @param user - The authenticated user (or null for anonymous link visitors)
   * @param document - The target document
   * @param action - The action to check (e.g., 'view', 'download')
   * @param context - Additional context (link_id, ip, timestamp, org_id)
   * @returns boolean - true if allowed, false otherwise
   */
  canUserAccessDocument(
    user: User | null,
    document: Document,
    action: PermissionAction,
    context: PermissionContext
  ): Promise<boolean>;

  /**
   * Determine if a user can perform an action on a specific room.
   *
   * @param user - The authenticated user
   * @param room - The target room
   * @param action - The action to check (e.g., 'view', 'upload')
   * @param context - Additional context (ip, timestamp, org_id)
   * @returns boolean - true if allowed, false otherwise
   */
  canUserAccessRoom(
    user: User,
    room: Room,
    action: PermissionAction,
    context: PermissionContext
  ): Promise<boolean>;

  /**
   * Determine if a user can perform an action on a specific folder.
   *
   * @param user - The authenticated user
   * @param folder - The target folder
   * @param action - The action to check (e.g., 'view', 'create_subfolder')
   * @param context - Additional context
   * @returns boolean - true if allowed, false otherwise
   */
  canUserAccessFolder(
    user: User,
    folder: Folder,
    action: PermissionAction,
    context: PermissionContext
  ): Promise<boolean>;

  /**
   * Generic permission check for any resource type.
   *
   * @param user - The authenticated user (or null for link visitors)
   * @param resource - The target resource (Document, Folder, Room, etc.)
   * @param action - The action to check
   * @param context - Additional context
   * @returns boolean - true if allowed, false otherwise
   */
  canUserPerformAction(
    user: User | null,
    resource: Resource,
    action: PermissionAction,
    context: PermissionContext
  ): Promise<boolean>;

  /**
   * Detailed explanation of why access was granted or denied.
   *
   * Returns a chain of reasoning that admins can use to debug permission issues.
   * Used in admin UI and audit logs.
   *
   * @param user - The authenticated user (or null for link visitors)
   * @param resource - The target resource
   * @param action - The action to check
   * @param context - Additional context
   * @returns PermissionExplanation - Full reasoning chain
   */
  explainPermission(
    user: User | null,
    resource: Resource,
    action: PermissionAction,
    context: PermissionContext
  ): Promise<PermissionExplanation>;

  /**
   * List all rooms a user can access.
   *
   * @param user - The authenticated user
   * @param context - Additional context (org_id)
   * @returns Room[] - Accessible rooms (sorted by name)
   */
  listAccessibleRooms(user: User, context: PermissionContext): Promise<Room[]>;

  /**
   * List all documents a user can access in a specific room.
   *
   * @param user - The authenticated user
   * @param room - The room context
   * @param action - The action to filter by (default 'view')
   * @param context - Additional context
   * @returns Document[] - Accessible documents
   */
  listAccessibleDocuments(
    user: User,
    room: Room,
    action?: PermissionAction,
    context?: PermissionContext
  ): Promise<Document[]>;

  /**
   * Get the effective set of permissions a user has on a resource.
   *
   * Used to determine the exact action set available to a user.
   * Accounts for org role, room role, direct permissions, and group memberships.
   *
   * @param user - The authenticated user
   * @param resource - The target resource
   * @param context - Additional context
   * @returns Permission[] - Set of actions user can perform
   */
  getEffectivePermissions(
    user: User,
    resource: Resource,
    context: PermissionContext
  ): Promise<Permission[]>;

  /**
   * Invalidate cached permission results for a user.
   *
   * Called after permission mutations (grant, revoke, group add/remove).
   *
   * @param userId - User ID to invalidate
   * @returns Promise<void>
   */
  invalidateUserPermissionCache(userId: string): Promise<void>;

  /**
   * Invalidate all cached permission results (e.g., after system configuration change).
   *
   * Use sparingly; prefer targeted invalidation.
   *
   * @returns Promise<void>
   */
  invalidateAllPermissionCache(): Promise<void>;
}

/**
 * Context for a permission check.
 */
export interface PermissionContext {
  /**
   * Organization ID (scoping).
   * Required for authenticated users; derived from link for link visitors.
   */
  organizationId: string;

  /**
   * The share link being accessed (if applicable).
   */
  linkId?: string;

  /**
   * The IP address of the requester.
   * Used for IP allowlist/blocklist checks (F021).
   */
  ip?: string;

  /**
   * The password provided (if link is password-protected).
   */
  password?: string;

  /**
   * The timestamp of the request.
   * Used for time-based constraint checks.
   */
  timestamp?: Date;

  /**
   * The user's session ID.
   * Used for logging and constraint tracking.
   */
  sessionId?: string;

  /**
   * For internal requests, mark this as a system action (bypasses some constraints).
   */
  isSystemAction?: boolean;
}

/**
 * The result of explainPermission().
 * Provides a human-readable chain of why access was granted or denied.
 */
export interface PermissionExplanation {
  /**
   * Was access allowed?
   */
  allowed: boolean;

  /**
   * Reason code (e.g., 'DOC_ACL_DENY', 'LINK_EXPIRED', 'IP_RESTRICTED').
   * If allowed, shows the final allow reason.
   */
  reason: string;

  /**
   * Step-by-step chain of evaluations.
   * Each step shows a layer and whether it passed/failed.
   */
  chain: ExplanationStep[];

  /**
   * Which rule prevented access (if allowed=false).
   * Points to the specific step in the chain.
   */
  failedAt?: string;

  /**
   * Human-readable summary (for UI display).
   */
  summary: string;

  /**
   * Metadata for debugging (query counts, cache hits, timing).
   */
  metadata: {
    evaluationTimeMs: number;
    cacheHit: boolean;
    policyCheckedCount: number;
  };
}

/**
 * A single step in the permission evaluation chain.
 */
export interface ExplanationStep {
  /**
   * Layer name (e.g., 'TENANT_ISOLATION', 'ORG_ROLE', 'DOC_ACL').
   */
  layer: string;

  /**
   * Did this layer pass?
   */
  passed: boolean;

  /**
   * Reason/description.
   */
  reason: string;

  /**
   * Additional details (e.g., org role value, explicit deny grant).
   */
  details?: Record<string, any>;
}

/**
 * Enumeration of all permission actions in the system.
 */
export enum PermissionAction {
  // Room actions
  ROOM_VIEW = 'room.view',
  ROOM_EDIT = 'room.edit',
  ROOM_DELETE = 'room.delete',
  ROOM_MANAGE_PERMISSIONS = 'room.manage_permissions',
  ROOM_INVITE = 'room.invite',
  ROOM_ARCHIVE = 'room.archive',
  ROOM_CLOSE = 'room.close',

  // Document actions
  DOC_VIEW = 'document.view',
  DOC_DOWNLOAD = 'document.download',
  DOC_UPLOAD = 'document.upload',
  DOC_DELETE = 'document.delete',
  DOC_EDIT_METADATA = 'document.edit_metadata',
  DOC_MANAGE_VERSIONS = 'document.manage_versions',
  DOC_PRINT = 'document.print',
  DOC_COMMENT = 'document.comment',

  // Folder actions
  FOLDER_VIEW = 'folder.view',
  FOLDER_CREATE = 'folder.create',
  FOLDER_EDIT = 'folder.edit',
  FOLDER_DELETE = 'folder.delete',

  // Link actions
  LINK_CREATE = 'link.create',
  LINK_EDIT = 'link.edit',
  LINK_DELETE = 'link.delete',

  // Admin actions
  ADMIN_MANAGE_USERS = 'admin.manage_users',
  ADMIN_MANAGE_SETTINGS = 'admin.manage_settings',
  ADMIN_VIEW_ANALYTICS = 'admin.view_analytics',
  ADMIN_VIEW_AUDIT = 'admin.view_audit',
  ADMIN_MANAGE_GROUPS = 'admin.manage_groups',
  ADMIN_MANAGE_API_KEYS = 'admin.manage_api_keys',

  // Additional granular actions
  LEGAL_HOLD = 'legal.hold',
  VIEW_WATERMARK = 'document.view_with_watermark',
}

/**
 * A granted permission.
 */
export interface Permission {
  id: string;
  user_id?: string;
  group_id?: string;
  resource_id: string;
  resource_type: 'document' | 'folder' | 'room';
  action: PermissionAction;
  granted: boolean; // true = allow, false = deny
  granted_at: DateTime;
  granted_by: string;
}
```

---

## Action Types

Below is the exhaustive enumeration of permission-checked actions in VaultSpace.

### Room Actions

| Action                    | Description                             | Typical Role | Notes                          |
| ------------------------- | --------------------------------------- | ------------ | ------------------------------ |
| `room.view`               | View room contents (folders, documents) | Room Viewer+ | Basic access gate              |
| `room.edit`               | Rename room, change description         | Room Admin   |                                |
| `room.delete`             | Soft-delete room                        | Org Admin    | Not reversible without restore |
| `room.manage_permissions` | Grant/revoke room-level permissions     | Room Admin   | Org Admin can override         |
| `room.invite`             | Invite users to room                    | Room Admin+  |                                |
| `room.archive`            | Archive room (read-only)                | Org Admin    | Scheduled archival (F108)      |
| `room.close`              | Close room (deny all viewer access)     | Org Admin    | Typically post-deal close      |

### Document Actions

| Action                     | Description                    | Typical Role | Notes                            |
| -------------------------- | ------------------------------ | ------------ | -------------------------------- |
| `document.view`            | View document preview/content  | Room Viewer+ | Gate for previewer               |
| `document.download`        | Download original file         | Room Viewer+ | Granular control (F014)          |
| `document.upload`          | Upload new version or new doc  | Room Admin   |                                  |
| `document.delete`          | Soft-delete document           | Room Admin   | Trash recovery (F114)            |
| `document.edit_metadata`   | Edit tags, custom fields       | Room Admin   |                                  |
| `document.manage_versions` | Promote/delete versions (F002) | Room Admin   | Version control                  |
| `document.print`           | Print document                 | Room Viewer+ | CSS-based deterrent (F024) in V2 |
| `document.comment`         | Add comments (F115)            | Room Admin   | Internal admin comments          |

### Folder Actions

| Action          | Description            | Typical Role | Notes                    |
| --------------- | ---------------------- | ------------ | ------------------------ |
| `folder.view`   | List folder contents   | Room Viewer+ | Inherited from room view |
| `folder.create` | Create subfolder       | Room Admin   |                          |
| `folder.edit`   | Rename/describe folder | Room Admin   |                          |
| `folder.delete` | Soft-delete folder     | Room Admin   | Deletes all child docs   |

### Link Actions

| Action        | Description                             | Typical Role | Notes                    |
| ------------- | --------------------------------------- | ------------ | ------------------------ |
| `link.create` | Create share link                       | Room Admin   | Defines link permissions |
| `link.edit`   | Modify link settings (expiry, password) | Room Admin   |                          |
| `link.delete` | Revoke share link                       | Room Admin   |                          |

### Admin Actions

| Action                  | Description                             | Typical Role | Notes |
| ----------------------- | --------------------------------------- | ------------ | ----- |
| `admin.manage_users`    | Invite/remove org members, assign roles | Org Admin+   |       |
| `admin.manage_settings` | Change org settings                     | Org Owner    |       |
| `admin.view_analytics`  | View room/viewer analytics (F121, F028) | Org Admin+   |       |
| `admin.view_audit`      | Access audit trail (F025, F040)         | Org Admin+   |       |
| `admin.manage_groups`   | Create/modify/delete groups (F020)      | Org Admin+   |       |
| `admin.manage_api_keys` | Create/revoke API keys (F135)           | Org Owner    |       |

### Compliance Actions

| Action                    | Description                            | Typical Role | Notes |
| ------------------------- | -------------------------------------- | ------------ | ----- |
| `legal.hold`              | Place room/doc under legal hold (F157) | Org Admin+   |       |
| `legal.export_compliance` | Export compliance package (F133)       | Org Admin+   |       |

---

## Permission Resolution Algorithm

The algorithm below is the pseudocode for `canUserPerformAction()`. It walks through each layer in order, returning false as soon as a layer denies access.

### TENANT ISOLATION INVARIANT (Non-Bypassable)

**This check MUST occur before ANY permission evaluation path, including anonymous link access:**

```
resource.organization_id == link.organization_id == context.organizationId
```

Tenant isolation is the foundational security boundary. It is enforced at:

1. **Layer 1 (Authenticated users):** User's organization context is validated against resource
2. **Anonymous link access:** Even for unathenticated visitors, the link itself must belong to the resource's organization
3. **Middleware:** All database queries are auto-scoped to the current organization context

If any component of this equation fails, access is denied immediately with reason `TENANT_ISOLATION`.

### High-Level Pseudocode

```pseudocode
function canUserPerformAction(user, resource, action, context):

  // Layer 1: Multi-tenant scoping
  if resource.organization_id != context.organizationId:
    return false with reason "TENANT_ISOLATION"

  // Link visitor flow (no authentication)
  if user == null:
    return evaluateLinkPermissions(resource, action, context)

  // Authenticated user flow

  // Layer 2: Organization membership
  if user.organization_id != context.organizationId:
    return false with reason "TENANT_MISMATCH"

  // Layer 3: Organization role
  org_role = user.getOrgRole(context.organizationId)
  if actionRequiresOrgAdminRole(action) and org_role not in [OWNER, ADMIN]:
    return false with reason "ORG_ROLE_INSUFFICIENT"

  // Layer 4-5: Room membership and role (if resource is a document or folder)
  if resource is Document or Folder:
    room = resource.getContainingRoom()

    if actionRequiresRoomAdminRole(action):
      room_role = user.getRoomRole(room)
      if room_role != ADMIN and org_role != ADMIN:
        return false with reason "ROOM_ROLE_INSUFFICIENT"

    if actionRequiresRoomMembership(action):
      if not user.isMemberOfRoom(room) and org_role != ADMIN:
        return false with reason "NOT_ROOM_MEMBER"

  // Layer 6-7: Folder and document inheritance
  if resource is Document:
    folder = resource.getContainingFolder()
    doc_permissions = getDocumentPermissions(user, resource, folder)

    if action not in doc_permissions:
      return false with reason "DOC_ACL_DENY"

  // Layer 8: Link permissions (if applicable)
  if context.linkId:
    link = getShareLink(context.linkId)
    if action not in link.allowed_actions:
      return false with reason "LINK_PERMISSION_DENY"

  // Layer 9: Time constraints
  if resource.expiresAt and now() > resource.expiresAt:
    return false with reason "RESOURCE_EXPIRED"

  if context.linkId:
    link = getShareLink(context.linkId)
    if link.expiresAt and now() > link.expiresAt:
      return false with reason "LINK_EXPIRED"

  // Layer 10: IP constraints
  if context.ip:
    if not isIPAllowed(context.ip, context.organizationId):
      return false with reason "IP_RESTRICTED"

  // Layer 11: NDA constraints
  if resource.requiresNDA and not user.hasSignedNDA(resource):
    return false with reason "NDA_NOT_SIGNED"

  // Layer 12: Password constraints
  if context.linkId:
    link = getShareLink(context.linkId)
    if link.passwordProtected and not context.hasValidPassword:
      return false with reason "PASSWORD_REQUIRED"

  // Layer 13: Legal hold
  if resource.isUnderLegalHold and action in [DELETE, MODIFY_RETENTION]:
    return false with reason "LEGAL_HOLD_ACTIVE"

  // Layer 14: Resource state
  if resource.status == ARCHIVED and actionRequiresWriteAccess(action):
    return false with reason "RESOURCE_ARCHIVED"

  if resource.status == CLOSED and user.getRoomRole(resource.room) == VIEWER:
    return false with reason "ROOM_CLOSED"

  return true with reason "ALLOWED"
```

### Detailed Implementation: getDocumentPermissions()

```pseudocode
function getDocumentPermissions(user, document, folder):

  permissions = new Set()

  // 1. Check for explicit document-level permissions
  direct_grants = queryPermissions(
    user_id: user.id,
    resource_id: document.id,
    granted: true
  )
  permissions.addAll(direct_grants.actions)

  // 2. Check for explicit document-level denies (these override everything)
  explicit_denies = queryPermissions(
    user_id: user.id,
    resource_id: document.id,
    granted: false
  )
  if explicit_denies.length > 0:
    return permissions -- explicit_denies  // Remove denied actions

  // 3. Check group memberships for document-level permissions
  groups = getUserGroups(user.id)
  for each group in groups:
    group_grants = queryPermissions(
      group_id: group.id,
      resource_id: document.id,
      granted: true
    )
    permissions.addAll(group_grants.actions)

    group_denies = queryPermissions(
      group_id: group.id,
      resource_id: document.id,
      granted: false
    )
    if group_denies.length > 0:
      permissions -= group_denies  // Explicit denies win

  // 4. If no document-level permissions found, inherit from folder
  if permissions.isEmpty():
    folder_permissions = getFolderPermissions(user, folder)
    permissions.addAll(folder_permissions)

  // 5. If still no permissions, inherit from room role
  if permissions.isEmpty():
    room_role = user.getRoomRole(document.room)
    if room_role == ADMIN:
      permissions.addAll([VIEW, DOWNLOAD, UPLOAD, DELETE, ...])
    else if room_role == VIEWER:
      permissions.addAll([VIEW, DOWNLOAD]) // Standard viewer perms

  return permissions
```

### Detailed Implementation: getFolderPermissions()

```pseudocode
function getFolderPermissions(user, folder):

  permissions = new Set()

  // Walk up the folder hierarchy
  current_folder = folder
  while current_folder != null:

    // Check explicit folder grants
    direct_grants = queryPermissions(
      user_id: user.id,
      resource_id: current_folder.id,
      granted: true
    )
    permissions.addAll(direct_grants.actions)

    // Check explicit denies
    explicit_denies = queryPermissions(
      user_id: user.id,
      resource_id: current_folder.id,
      granted: false
    )
    if explicit_denies.length > 0:
      return permissions -- explicit_denies

    // Check group permissions
    groups = getUserGroups(user.id)
    for each group in groups:
      group_grants = queryPermissions(
        group_id: group.id,
        resource_id: current_folder.id,
        granted: true
      )
      permissions.addAll(group_grants.actions)

      group_denies = queryPermissions(
        group_id: group.id,
        resource_id: current_folder.id,
        granted: false
      )
      if group_denies.length > 0:
        return permissions -- group_denies

    // If we found permissions at this level, stop here
    if permissions.length > 0:
      break

    // Otherwise, move up to parent folder
    current_folder = current_folder.parent

  return permissions
```

### Detailed Implementation: evaluateLinkPermissions()

For unauthenticated link visitors, permissions are defined entirely by the link.

```pseudocode
function evaluateLinkPermissions(resource, action, context):

  if context.linkId == null:
    return false with reason "NO_LINK_PROVIDED"

  link = getShareLink(context.linkId)
  if link == null or not link.is_active:
    return false with reason "LINK_NOT_FOUND"

  // Layer 9: Expiry
  if link.expiresAt and now() > link.expiresAt:
    return false with reason "LINK_EXPIRED"

  // Layer 10: IP restriction
  if context.ip and not isLinkIPAllowed(link, context.ip):
    return false with reason "IP_RESTRICTED"

  // Layer 12: Password protection
  if link.passwordProtected:
    if context.password == null or not bcrypt.compare(context.password, link.passwordHash):
      return false with reason "PASSWORD_REQUIRED"

  // Check if link allows this action on this resource
  if not link.appliesToResource(resource):
    return false with reason "LINK_SCOPE_MISMATCH"

  if action not in link.allowed_actions:
    return false with reason "LINK_PERMISSION_DENY"

  return true with reason "LINK_PERMITTED"
```

---

## Caching Strategy

Permission decisions are expensive (multiple database queries, group expansion). Caching significantly improves performance.

### Cache Key Structure

```typescript
const permissionCacheKey = (
  userId: string,
  resourceId: string,
  action: PermissionAction
): string => {
  return `permissions:${userId}:${resourceId}:${action}`;
};

const permissionExplanationCacheKey = (
  userId: string,
  resourceId: string,
  action: PermissionAction
): string => {
  return `permission_explain:${userId}:${resourceId}:${action}`;
};

const listAccessibleRoomsCacheKey = (userId: string, organizationId: string): string => {
  return `accessible_rooms:${userId}:${organizationId}`;
};
```

### Cache Invalidation Triggers

Permission cache is invalidated when:

1. **User permission is modified**

   ```typescript
   await cache.invalidatePrefix(`permissions:${userId}:*`);
   ```

2. **User group membership changes**

   ```typescript
   await cache.invalidatePrefix(`permissions:${userId}:*`);
   ```

3. **Group permissions change**

   ```typescript
   const groupMembers = await db.groupMembership.findMany({
     where: { group_id: group.id },
   });

   for (const member of groupMembers) {
     await cache.invalidatePrefix(`permissions:${member.user_id}:*`);
   }
   ```

4. **Resource state changes** (archived, closed, deleted)

   ```typescript
   await cache.invalidatePrefix(`*:${resource.id}:*`);
   ```

5. **Room membership changes**
   ```typescript
   await cache.invalidatePrefix(`permissions:${user.id}:*`);
   await cache.invalidatePrefix(`accessible_rooms:${user.id}:*`);
   ```

### TTL Strategy

- **Standard permission check**: 5 minutes (short, security-critical)
- **List accessible rooms**: 10 minutes (less frequently changing)
- **Permission explanation**: 5 minutes (same as standard check)

```typescript
const DEFAULT_PERMISSION_TTL = 5 * 60; // 5 minutes in seconds
const DEFAULT_LIST_TTL = 10 * 60; // 10 minutes in seconds

// Set with TTL
await cache.set(cacheKey, result, { ttl: DEFAULT_PERMISSION_TTL });
```

### Redis-Based Caching

The implementation uses Redis for all permission caching.

```typescript
import Redis from 'ioredis';

class PermissionCache {
  private redis: Redis;

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void> {
    const serialized = JSON.stringify(value);
    if (options?.ttl) {
      await this.redis.setex(key, options.ttl, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    const keys = await this.redis.keys(`${prefix}*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
```

### Caching in the Engine

```typescript
async canUserPerformAction(
  user: User | null,
  resource: Resource,
  action: PermissionAction,
  context: PermissionContext
): Promise<boolean> {
  // Skip caching for link visitors (context-dependent)
  if (user === null) {
    return this.evaluateLinkPermissions(resource, action, context);
  }

  const cacheKey = permissionCacheKey(user.id, resource.id, action);

  // Try cache first
  const cached = await this.cache.get<boolean>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // Not in cache; evaluate
  const result = await this._evaluatePermission(user, resource, action, context);

  // Store in cache with TTL
  await this.cache.set(cacheKey, result, {
    ttl: DEFAULT_PERMISSION_TTL
  });

  return result;
}
```

### Permission Cache Invalidation Strategy

The basic prefix-based invalidation shown above is straightforward but can be inefficient at scale, especially with high-cardinality scenarios (e.g., granting access to a group with 1,000 members or deep folder hierarchies). The following strategy addresses performance concerns identified in Layer 6 (Folder Inheritance) and Layer 7 (Document ACLs).

#### Version-Based Invalidation (Recommended Primary Strategy)

Rather than deleting cache entries, use versioning to naturally expire them without triggering a "thundering herd" problem.

**Design:**

- Each permission-affecting entity (Organization, Room, Folder, Document, Group, User) maintains a `permissionVersion` counter.
- When permissions change, increment the version on the affected entity.
- Cache keys incorporate the version: `perm:{orgId}:{userId}:{resourceId}:{permissionVersion}`
- Old cache entries naturally expire via TTL; explicit deletion is unnecessary.

**Benefits:**

- Avoids expensive mass cache deletion operations.
- No race conditions between cache invalidation and subsequent reads.
- Simple to implement and reason about.

**TypeScript Implementation:**

```typescript
// Entity schema includes version tracking
interface VersionedEntity {
  id: string;
  permissionVersion: number; // Incremented on permission changes
}

// Cache key generation with version
function buildVersionedCacheKey(
  orgId: string,
  userId: string,
  resourceId: string,
  action: PermissionAction,
  permissionVersion: number
): string {
  return `perm:${orgId}:${userId}:${resourceId}:${action}:v${permissionVersion}`;
}

// Read from cache with version lookup
async function getCachedPermission(
  userId: string,
  resource: Resource,
  action: PermissionAction,
  currentPermissionVersion: number
): Promise<boolean | null> {
  const cacheKey = buildVersionedCacheKey(
    resource.organization_id,
    userId,
    resource.id,
    action,
    currentPermissionVersion
  );
  return this.cache.get<boolean>(cacheKey);
}

// Write to cache with version
async function setCachedPermission(
  userId: string,
  resource: Resource,
  action: PermissionAction,
  result: boolean,
  permissionVersion: number,
  ttl: number = DEFAULT_PERMISSION_TTL
): Promise<void> {
  const cacheKey = buildVersionedCacheKey(
    resource.organization_id,
    userId,
    resource.id,
    action,
    permissionVersion
  );
  await this.cache.set(cacheKey, result, { ttl });
}

// Invalidation: increment the version counter
async function invalidatePermissionsForEntity(entity: VersionedEntity): Promise<void> {
  await db[entity.type].update({
    where: { id: entity.id },
    data: { permissionVersion: { increment: 1 } },
  });
  // No explicit cache deletion needed; old keys expire naturally
}
```

#### Tag-Based Invalidation (Complementary Strategy)

For surgical, targeted invalidation of dependent caches without full prefix deletion.

**Design:**

- Permission cache entries are tagged with the entities they depend on: `group:{groupId}`, `folder:{folderId}`, `room:{roomId}`.
- A Redis SET tracks the reverse mapping: `tag:group:{groupId} → [cache_key1, cache_key2, ...]`
- When a group membership changes, invalidate all cache entries tagged with that group.

**TypeScript Implementation:**

```typescript
interface CacheEntry<T> {
  key: string;
  value: T;
  tags: string[];
  ttl?: number;
}

class TaggedPermissionCache {
  private redis: Redis;

  async setWithTags<T>(
    key: string,
    value: T,
    tags: string[],
    options?: { ttl?: number }
  ): Promise<void> {
    const serialized = JSON.stringify(value);
    if (options?.ttl) {
      await this.redis.setex(key, options.ttl, serialized);
    } else {
      await this.redis.set(key, serialized);
    }

    // Track tags for reverse lookup
    for (const tag of tags) {
      await this.redis.sadd(`tags:${tag}`, key);
      // Tag entries also expire with TTL
      if (options?.ttl) {
        await this.redis.expire(`tags:${tag}`, options.ttl);
      }
    }
  }

  async invalidateByTag(tag: string): Promise<void> {
    // Get all cache keys tagged with this tag
    const keys = await this.redis.smembers(`tags:${tag}`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
      await this.redis.del(`tags:${tag}`);
    }
  }

  async invalidateByTags(tags: string[]): Promise<void> {
    const allKeys = new Set<string>();
    for (const tag of tags) {
      const keys = await this.redis.smembers(`tags:${tag}`);
      keys.forEach((k) => allKeys.add(k));
    }
    if (allKeys.size > 0) {
      await this.redis.del(...Array.from(allKeys));
      for (const tag of tags) {
        await this.redis.del(`tags:${tag}`);
      }
    }
  }
}

// Example usage: cache permission check with tags
const tags = [`group:${group.id}`, `folder:${folder.id}`, `user:${user.id}`, `room:${room.id}`];
await taggedCache.setWithTags(cacheKey, result, tags, { ttl: DEFAULT_PERMISSION_TTL });

// On group membership change:
await taggedCache.invalidateByTag(`group:${group.id}`);
```

#### Hierarchical Propagation Rules

Different permission changes require invalidation at different scopes:

| Change                        | Invalidation Scope                              |
| ----------------------------- | ----------------------------------------------- |
| **Room permission change**    | All folder & document caches in that room       |
| **Folder permission change**  | Folder + all descendant folders & documents     |
| **Group membership change**   | All caches for affected users (batch operation) |
| **Document ACL change**       | Only that document's cache entries              |
| **Organization-level change** | Full cache flush for that organization          |

**Implementation:**

```typescript
async handleRoomPermissionChange(room: Room): Promise<void> {
  // Invalidate all folder/document caches within this room
  await taggedCache.invalidateByTag(`room:${room.id}`);

  // Increment room's permission version
  await db.room.update({
    where: { id: room.id },
    data: { permissionVersion: { increment: 1 } }
  });
}

async handleFolderPermissionChange(folder: Folder): Promise<void> {
  // Invalidate folder and all descendants
  const descendants = await db.folder.findMany({
    where: {
      left_bound: { gte: folder.left_bound },
      right_bound: { lte: folder.right_bound }
    }
  });

  const affectedFolderIds = [folder.id, ...descendants.map(f => f.id)];
  for (const folderId of affectedFolderIds) {
    await taggedCache.invalidateByTag(`folder:${folderId}`);
    await db.folder.update({
      where: { id: folderId },
      data: { permissionVersion: { increment: 1 } }
    });
  }
}

async handleGroupMembershipChange(group: Group): Promise<void> {
  // Invalidate all caches for affected users
  const members = await db.groupMembership.findMany({
    where: { group_id: group.id }
  });

  for (const member of members) {
    await taggedCache.invalidateByTag(`user:${member.user_id}`);
  }

  // Increment group's permission version
  await db.group.update({
    where: { id: group.id },
    data: { permissionVersion: { increment: 1 } }
  });
}

async handleDocumentACLChange(document: Document): Promise<void> {
  // Only invalidate this document's cache
  await taggedCache.invalidateByTag(`document:${document.id}`);

  await db.document.update({
    where: { id: document.id },
    data: { permissionVersion: { increment: 1 } }
  });
}

async handleOrganizationPermissionChange(org: Organization): Promise<void> {
  // Full flush is necessary for org-level changes (rare)
  await this.cache.flushByOrganization(org.id);

  await db.organization.update({
    where: { id: org.id },
    data: { permissionVersion: { increment: 1 } }
  });
}
```

#### High-Cardinality Scenarios

**Problem:** A group with 1,000 members is granted access to a parent folder. Naively invalidating all 1,000 members' caches could cause cache stampede and performance degradation.

**Solutions:**

1. **Batch Background Invalidation:**

   ```typescript
   async grantGroupPermissionToFolder(group: Group, folder: Folder): Promise<void> {
     // Record the grant
     await db.folderPermission.create({ group_id: group.id, folder_id: folder.id, /* ... */ });

     // Queue background job instead of immediate invalidation
     await jobQueue.enqueue('invalidate_group_permission_caches', {
       groupId: group.id,
       batchSize: 100, // Process 100 users at a time
       delayMs: 500   // Stagger invalidation to avoid thundering herd
     });
   }

   // Background job handler
   async function invalidateGroupPermissionCachesJob(payload) {
     const members = await db.groupMembership.findMany({
       where: { group_id: payload.groupId },
       skip: payload.offset,
       take: payload.batchSize
     });

     for (const member of members) {
       await taggedCache.invalidateByTag(`user:${member.user_id}`);
     }

     // If more members remain, requeue with offset
     if (members.length === payload.batchSize) {
       await jobQueue.enqueue('invalidate_group_permission_caches', {
         ...payload,
         offset: (payload.offset || 0) + payload.batchSize
       });
     }
   }
   ```

2. **Stale-and-Revalidate Pattern:**

   ```typescript
   async canUserPerformAction(user: User, resource: Resource, action: PermissionAction): Promise<boolean> {
     const permissionVersion = resource.permissionVersion;
     const cacheKey = buildVersionedCacheKey(..., action, permissionVersion);

     // Try cache
     const cached = await this.cache.get<boolean>(cacheKey);
     if (cached !== null) {
       return cached; // Cache hit
     }

     // Cache miss: evaluate (potentially returning stale result while revalidating)
     const result = await this._evaluatePermissionWithTimeout(user, resource, action, 1000); // 1s timeout

     // Cache the result
     await this.cache.set(cacheKey, result, { ttl: DEFAULT_PERMISSION_TTL });

     // Trigger background revalidation for high-cardinality scenarios
     if (resource.membership_count > 500) {
       await jobQueue.enqueue('revalidate_permission', {
         userId: user.id,
         resourceId: resource.id,
         action: action
       });
     }

     return result;
   }
   ```

3. **Pre-Computed Effective Permissions (Deep Hierarchies):**

   ```typescript
   async cacheEffectivePermissions(folder: Folder): Promise<void> {
     // For deep hierarchies, pre-compute effective permissions at each level
     const ancestors = await getAncestorFolders(folder);

     for (const ancestor of ancestors) {
       const effectivePerms = await this._computeEffectivePermissions(ancestor);

       // Store in Redis sorted set: score = depth, value = serialized permissions
       await this.redis.zadd(
         `effective_perms:folder:${ancestor.id}`,
         ancestor.depth,
         JSON.stringify(effectivePerms)
       );
     }
   }
   ```

#### Cache Warming After Bulk Changes

After bulk permission changes, proactively warm cache for active users to avoid subsequent cache misses.

**Implementation:**

```typescript
async function warmCacheAfterBulkPermissionChange(
  affectedUserIds: string[],
  affectedResourceIds: string[],
  actions: PermissionAction[]
): Promise<void> {
  // Query recent access patterns to identify hot user-resource pairs
  const recentAccesses = await db.accessLog.findMany({
    where: {
      user_id: { in: affectedUserIds },
      resource_id: { in: affectedResourceIds },
      accessed_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24h
    },
    distinct: ['user_id', 'resource_id'],
    take: 1000,
  });

  // Batch-evaluate permissions for hot pairs
  for (const access of recentAccesses) {
    const user = await db.user.findUnique({ where: { id: access.user_id } });
    const resource = await db[access.resource_type].findUnique({
      where: { id: access.resource_id },
    });

    for (const action of actions) {
      const result = await this._evaluatePermission(user, resource, action, {});
      const permissionVersion = resource.permissionVersion;
      const cacheKey = buildVersionedCacheKey(
        resource.organization_id,
        user.id,
        resource.id,
        action,
        permissionVersion
      );
      await this.cache.set(cacheKey, result, { ttl: DEFAULT_PERMISSION_TTL });
    }
  }
}
```

---

## Database Schema

This section defines the database tables related to permissions. For the complete schema, refer to DATABASE_SCHEMA.md.

### RoleAssignment Table

Tracks user roles in organizations and rooms.

```sql
CREATE TABLE role_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  room_id UUID REFERENCES room(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL, -- 'owner', 'admin', 'member' (org level)
                              -- 'admin', 'viewer' (room level)
  assigned_at TIMESTAMP NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES user(id),

  CONSTRAINT unique_org_role UNIQUE (organization_id, user_id, room_id)
);

CREATE INDEX idx_role_assignment_user ON role_assignment(user_id);
CREATE INDEX idx_role_assignment_org ON role_assignment(organization_id);
CREATE INDEX idx_role_assignment_room ON role_assignment(room_id);
```

### Group Tables

```sql
CREATE TABLE "group" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT unique_group_name_per_org UNIQUE (organization_id, name)
);

CREATE INDEX idx_group_org ON "group"(organization_id);

CREATE TABLE group_membership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  added_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT unique_group_member UNIQUE (group_id, user_id)
);

CREATE INDEX idx_group_membership_user ON group_membership(user_id);
CREATE INDEX idx_group_membership_group ON group_membership(group_id);
```

### Permission Tables

```sql
CREATE TABLE room_permission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user(id) ON DELETE CASCADE,
  group_id UUID REFERENCES "group"(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true, -- true = allow, false = deny
  granted_at TIMESTAMP NOT NULL DEFAULT now(),
  granted_by UUID NOT NULL REFERENCES user(id),

  CONSTRAINT check_user_or_group CHECK (user_id IS NOT NULL OR group_id IS NOT NULL),
  CONSTRAINT unique_room_perm UNIQUE (room_id, user_id, group_id, action)
);

CREATE INDEX idx_room_permission_user ON room_permission(user_id);
CREATE INDEX idx_room_permission_group ON room_permission(group_id);
CREATE INDEX idx_room_permission_room ON room_permission(room_id);

CREATE TABLE folder_permission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user(id) ON DELETE CASCADE,
  group_id UUID REFERENCES "group"(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true,
  granted_at TIMESTAMP NOT NULL DEFAULT now(),
  granted_by UUID NOT NULL REFERENCES user(id),

  CONSTRAINT check_user_or_group CHECK (user_id IS NOT NULL OR group_id IS NOT NULL),
  CONSTRAINT unique_folder_perm UNIQUE (folder_id, user_id, group_id, action)
);

CREATE INDEX idx_folder_permission_user ON folder_permission(user_id);
CREATE INDEX idx_folder_permission_group ON folder_permission(group_id);
CREATE INDEX idx_folder_permission_folder ON folder_permission(folder_id);

CREATE TABLE document_permission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user(id) ON DELETE CASCADE,
  group_id UUID REFERENCES "group"(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true,
  granted_at TIMESTAMP NOT NULL DEFAULT now(),
  granted_by UUID NOT NULL REFERENCES user(id),

  CONSTRAINT check_user_or_group CHECK (user_id IS NOT NULL OR group_id IS NOT NULL),
  CONSTRAINT unique_doc_perm UNIQUE (document_id, user_id, group_id, action)
);

CREATE INDEX idx_document_permission_user ON document_permission(user_id);
CREATE INDEX idx_document_permission_group ON document_permission(group_id);
CREATE INDEX idx_document_permission_document ON document_permission(document_id);
```

### LinkPermission Table

Link-level permissions are stored separately.

```sql
CREATE TABLE link_permission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  share_link_id UUID NOT NULL REFERENCES share_link(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,

  CONSTRAINT unique_link_perm UNIQUE (share_link_id, action)
);

CREATE INDEX idx_link_permission_link ON link_permission(share_link_id);
```

### Share Link Table

```sql
CREATE TABLE share_link (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES user(id),

  -- Scope: which resources can be accessed via this link
  scope_type VARCHAR(50) NOT NULL, -- 'room', 'folder', 'document'
  scope_id UUID NOT NULL, -- room_id, folder_id, or document_id depending on scope_type

  -- Access constraints
  password_hash VARCHAR(255), -- bcrypt hash, null if no password
  expires_at TIMESTAMP,
  max_downloads INTEGER, -- null = unlimited

  -- Link settings
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  token VARCHAR(255) NOT NULL UNIQUE, -- public shareable token

  -- Analytics
  view_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMP
);

CREATE INDEX idx_share_link_room ON share_link(room_id);
CREATE INDEX idx_share_link_token ON share_link(token);
```

---

## Middleware Integration

Permission checks integrate with Next.js middleware and API routes.

### API Route Middleware

Every API route must call `requirePermission()` at the start.

```typescript
// pages/api/documents/[id]/download.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { permissionEngine } from '@/lib/permission-engine';
import { getSessionUser } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Authenticate user
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Get resource (scope to current organization first to prevent existence disclosure)
  const { id } = req.query;
  const document = await db.document.findFirst({
    where: {
      id: id as string,
      organizationId: user.organization_id, // Scope to current org
    },
  });
  if (!document) {
    return res.status(404).json({ error: 'Not found' }); // 404 whether doesn't exist OR wrong org
  }

  // 3. Check permission
  const canDownload = await permissionEngine.canUserPerformAction(
    user,
    document,
    PermissionAction.DOC_DOWNLOAD,
    {
      organizationId: user.organization_id,
      ip: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress,
      sessionId: req.cookies.sessionId,
    }
  );

  if (!canDownload) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 4. Proceed with download
  // All data access follows the scope-then-authorize pattern to prevent existence disclosure across tenants.
  // ...
}
```

### Middleware for Link Visitors

For unauthenticated link access, middleware validates the link token and sets up context.

```typescript
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { permissionEngine } from '@/lib/permission-engine';

export async function middleware(request: NextRequest) {
  // If accessing via /link/:token path
  const token = request.nextUrl.searchParams.get('link_token');

  if (token) {
    const link = await db.shareLink.findUnique({
      where: { token },
    });

    if (!link) {
      return NextResponse.redirect(new URL('/404', request.url));
    }

    // Set link ID in request context (not headers) for downstream code
    const response = NextResponse.next();

    // Store in AsyncLocalStorage or request context object (NOT in HTTP headers)
    // This prevents exposure to client-side code
    setRequestContext({
      linkId: link.id,
      organizationId: link.organization_id,
    });

    return response;
  }

  return NextResponse.next();
}
```

### SECURITY NOTE: Tenant Context Derivation and Header Trust

**CRITICAL:** Organization context must NEVER be trusted from client-supplied headers. The `organizationId` MUST be derived server-side from one of these sources:

1. **Authenticated User:** Extract from validated session/JWT claims

   ```typescript
   const organizationId = session.user.organization_id; // Server-validated
   ```

2. **Anonymous Link Access:** Extract from validated link record

   ```typescript
   const link = await db.shareLink.findUnique({ where: { token } });
   const organizationId = link.organization_id; // From database, not client
   ```

3. **API Key:** Extract from API key scope stored server-side
   ```typescript
   const apiKey = await validateAndDecodeApiKey(request);
   const organizationId = apiKey.organizationId; // From server validation
   ```

**Do NOT do this:**

```typescript
// WRONG: Trusting client-supplied headers
const organizationId = request.headers.get('x-organization-id');
```

**Store context securely:**

- Use request-scoped storage (AsyncLocalStorage in Node.js, context objects in frameworks)
- Do NOT propagate organizationId via HTTP response headers to the client
- If passing context between services, use encrypted/signed tokens only

This prevents context injection attacks and ensures tenant isolation cannot be bypassed through header manipulation.

### Admin UI Permission Checks

Admin panels show only resources the user can access. Example: Room list.

```typescript
// pages/admin/rooms.tsx
import { useAsync } from 'react-async';
import { permissionEngine } from '@/lib/permission-engine';

export default function RoomsPage() {
  const { data: rooms } = useAsync(async () => {
    return await permissionEngine.listAccessibleRooms(
      currentUser,
      { organizationId: currentUser.organization_id }
    );
  });

  return (
    <div>
      {rooms?.map(room => (
        <RoomCard key={room.id} room={room} />
      ))}
    </div>
  );
}
```

### Viewer UI Permission Checks

The viewer portal checks link permissions before rendering documents.

```typescript
// components/DocumentViewer.tsx
import { useEffect, useState } from 'react';
import { permissionEngine } from '@/lib/permission-engine';

interface DocumentViewerProps {
  document: Document;
  linkToken?: string;
}

export default function DocumentViewer({ document, linkToken }: DocumentViewerProps) {
  const [canView, setCanView] = useState(false);
  const [canDownload, setCanDownload] = useState(false);

  useEffect(() => {
    const checkPermissions = async () => {
      const viewAllowed = await permissionEngine.canUserPerformAction(
        null, // Link visitor
        document,
        PermissionAction.DOC_VIEW,
        {
          organizationId: document.organization_id,
          linkId: linkToken,
          ip: await getClientIP()
        }
      );

      const downloadAllowed = await permissionEngine.canUserPerformAction(
        null,
        document,
        PermissionAction.DOC_DOWNLOAD,
        {
          organizationId: document.organization_id,
          linkId: linkToken
        }
      );

      setCanView(viewAllowed);
      setCanDownload(downloadAllowed);
    };

    checkPermissions();
  }, [document, linkToken]);

  if (!canView) {
    return <div>Access denied to this document.</div>;
  }

  return (
    <div>
      <DocumentPreview document={document} />
      {canDownload && <DownloadButton document={document} />}
    </div>
  );
}
```

---

## Link Permissions & Constraints

Share links are a first-class permission mechanism for unauthenticated access.

### Link Permission Model

A share link has:

1. **Scope**: Which resources it grants access to
   - Single document
   - Folder (all children)
   - Room (all folders + documents)

2. **Allowed actions**: Subset of [view, download, print]

3. **Constraints**:
   - Expiry date
   - Password protection
   - IP allowlist
   - Download limit
   - NDA requirement

### Link Creation

```typescript
async createShareLink(user: User, input: {
  roomId: string;
  scopeType: 'room' | 'folder' | 'document';
  scopeId: string;
  expiresAt?: Date;
  passwordProtected?: boolean;
  password?: string;
  allowedActions?: PermissionAction[];
  ipRestrictions?: string[];
  requiresNDA?: boolean;
}): Promise<ShareLink> {
  // Permission check: user must be room admin
  const room = await db.room.findUnique({ where: { id: input.roomId } });
  const canCreate = await this.canUserPerformAction(
    user,
    room,
    PermissionAction.LINK_CREATE,
    { organizationId: user.organization_id }
  );

  if (!canCreate) {
    throw new Error('Insufficient permissions to create link');
  }

  // Generate token
  const token = generateSecureToken(32);

  // Hash password if provided
  let passwordHash = null;
  if (input.passwordProtected && input.password) {
    passwordHash = await bcrypt.hash(input.password, 10);
  }

  const link = await db.shareLink.create({
    data: {
      organization_id: user.organization_id,
      room_id: input.roomId,
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      token,
      password_hash: passwordHash,
      expires_at: input.expiresAt,
      created_by: user.id
    }
  });

  // Store allowed actions
  for (const action of input.allowedActions || ['view']) {
    await db.linkPermission.create({
      data: {
        share_link_id: link.id,
        action,
        organization_id: user.organization_id
      }
    });
  }

  // Store IP restrictions if provided
  if (input.ipRestrictions?.length) {
    for (const ip of input.ipRestrictions) {
      await db.ipRestriction.create({
        data: {
          share_link_id: link.id,
          ip,
          type: 'allowlist'
        }
      });
    }
  }

  await eventBus.emit('share_link.created', {
    link_id: link.id,
    room_id: input.roomId,
    actor_id: user.id
  });

  return link;
}
```

### Link Expiry Cleanup

Background job checks and revokes expired links.

```typescript
// workers/expiry-check.ts
import { CronJob } from 'cron';
import { db } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';

export const expiryCheckJob = new CronJob('0 * * * *', async () => {
  // Hourly check
  const expiredLinks = await db.shareLink.findMany({
    where: {
      expires_at: { lte: new Date() },
      is_active: true,
    },
  });

  for (const link of expiredLinks) {
    await db.shareLink.update({
      where: { id: link.id },
      data: { is_active: false },
    });

    await eventBus.emit('share_link.expired', {
      link_id: link.id,
      organization_id: link.organization_id,
    });

    // Invalidate cache
    await cache.invalidatePrefix(`share_link:${link.id}:*`);
  }
});
```

---

## Examples & Walkthroughs

### Example 1: Investor Accessing a Document

**Scenario:** Alice is an investor in Company X (a viewer in Organization A). She accesses a share link to the "/Financial Statements" folder. Can she download a document?

```typescript
const resource = await db.document.findUnique({
  where: { id: 'doc-123' }, // Financial_2024.pdf
});

const context = {
  organizationId: 'org-A',
  linkId: 'share-link-456', // The share link token
  ip: '203.0.113.42',
};

const canDownload = await permissionEngine.canUserPerformAction(
  null, // Alice is accessing via link (unauthenticated)
  resource,
  PermissionAction.DOC_DOWNLOAD,
  context
);

// Walkthrough:
// Layer 1: Tenant isolation ✓ (document.org_id == context.org_id)
// Layer 2-7: SKIPPED (unauthenticated)
// Layer 8: Link permissions ✓ (link allows 'download')
// Layer 9: Time constraints ✓ (link expires 2026-04-15, now is 2026-03-14)
// Layer 10: IP restrictions ✓ (link has no IP allowlist)
// Layer 12: Password ✓ (link not password-protected)
// Result: ALLOWED
```

### Example 2: Admin Explaining a Permission Denial

**Scenario:** Bob tries to access a document in a room but is denied. He asks the admin, "Why can't I see this?"

```typescript
const user = await db.user.findUnique({ where: { id: 'user-bob' } });
const document = await db.document.findUnique({ where: { id: 'doc-789' } });

const explanation = await permissionEngine.explainPermission(
  user,
  document,
  PermissionAction.DOC_VIEW,
  {
    organizationId: user.organization_id,
    ip: '203.0.113.99',
  }
);

console.log(explanation);
/*
{
  allowed: false,
  reason: 'DOC_ACL_DENY',
  chain: [
    { layer: 'TENANT_ISOLATION', passed: true, reason: 'User and document are in same org' },
    { layer: 'ORG_MEMBERSHIP', passed: true, reason: 'User is member of organization' },
    { layer: 'ROOM_MEMBERSHIP', passed: true, reason: 'User is member of room' },
    { layer: 'ROOM_ROLE', passed: true, reason: 'User has role=viewer in room' },
    { layer: 'DOC_ACL', passed: false, reason: 'Document has explicit deny on group "Finance Review"' }
  ],
  failedAt: 'DOC_ACL',
  summary: 'Access denied: Document has an explicit deny permission for the Finance Review group you belong to.',
  metadata: {
    evaluationTimeMs: 23,
    cacheHit: false,
    policyCheckedCount: 5
  }
}
*/
```

The admin can see that Bob is in the "Finance Review" group which has been explicitly denied access to this document. The admin can then decide to either:

- Remove Bob from the group
- Create a specific allow for Bob on this document
- Explain to Bob why the group has restricted access

### Example 3: Group-Based Permission Management

**Scenario:** M&A team invites 50 investors. Instead of setting individual permissions, they create groups.

```typescript
// Create groups by investor tier
const seniorInvestors = await permissionEngine.createGroup(organization, {
  name: 'Senior Investors',
  description: 'Tier 1 investors with full access',
});

const juniorInvestors = await permissionEngine.createGroup(organization, {
  name: 'Junior Investors',
  description: 'Tier 2 investors with limited access',
});

// Add users to groups (via admin UI or CSV import)
await permissionEngine.addGroupMember(seniorInvestors, alice);
await permissionEngine.addGroupMember(seniorInvestors, bob);
await permissionEngine.addGroupMember(juniorInvestors, charlie);

// Grant group permissions on folders
const financialFolder = await db.folder.findUnique({
  where: { id: 'folder-financials' },
});

// Senior investors: full access
await permissionEngine.grantGroupPermission(seniorInvestors, financialFolder, [
  PermissionAction.DOC_VIEW,
  PermissionAction.DOC_DOWNLOAD,
]);

// Junior investors: view-only
await permissionEngine.grantGroupPermission(juniorInvestors, financialFolder, [
  PermissionAction.DOC_VIEW,
]);

// Later: a specific sensitive document is marked restricted for juniors
const sensitiveDoc = await db.document.findUnique({
  where: { id: 'doc-executive-summary' },
});

await permissionEngine.denyGroupPermission(juniorInvestors, sensitiveDoc, [
  PermissionAction.DOC_VIEW,
]);

// Now:
// - Alice (senior): can view and download all financials, including exec summary
// - Bob (senior): same
// - Charlie (junior): can view financials EXCEPT exec summary (explicit deny wins)
```

### Example 4: Time-Limited Access

**Scenario:** A document must be accessible only during a 2-hour Q&A window on March 21, 2 PM - 4 PM EST.

```typescript
const shareLink = await permissionEngine.createShareLink(admin, {
  roomId: 'room-qa',
  scopeType: 'document',
  scopeId: 'doc-technical-details',
  expiresAt: new Date('2026-03-21T21:00:00Z'), // 4 PM EST
  allowedActions: [PermissionAction.DOC_VIEW, PermissionAction.DOC_DOWNLOAD],
});

// Background job at 4 PM EST revokes the link by setting is_active=false
// Any attempt to access the link after expiry is denied with reason 'LINK_EXPIRED'
```

---

## Cross-References

- **ARCHITECTURE.md** (F148): High-level system design and module interactions
- **DATABASE_SCHEMA.md** (F152): Complete database table definitions including all permission-related tables
- **EVENT_MODEL.md** (F153): Event catalog for permission-related events (permission.granted, permission.denied, group.created, etc.)
- **Feature F141** (Centralized permission engine): This document is the specification for F141
- **Feature F020** (User group management): Group CRUD operations
- **Feature F005** (Per-document and per-folder access controls): ACL evaluation
- **Feature F116** (Granular link permissions): Share link constraints
- **Feature F021** (IP allowlist/blocklist): V1 feature, Layer 10
- **Feature F022** (Time-limited access): V1 feature, Layer 9
- **Feature F018** (NDA gate): V1 feature, Layer 11
- **Feature F157** (Legal hold): V1 feature, Layer 13

---

## Mandatory Security Test Matrix

These tests MUST pass before any release. They are the minimum security contract.

### Cross-Tenant Isolation Tests

| Test ID | Test Description                                       | Setup                                                              | Action                                                              | Expected Result                                               |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| SEC-001 | User in Org-A cannot access Org-B document             | Create doc in Org-B                                                | User-A calls GET /api/documents/{orgB-docId}                        | 404 Not Found (not 403, to prevent existence disclosure)      |
| SEC-002 | User in Org-A cannot list Org-B rooms                  | Create room in Org-B                                               | User-A calls GET /api/rooms                                         | Empty list (Org-B rooms not visible)                          |
| SEC-003 | Link scoped to Org-A cannot access Org-B document      | Create link in Org-A, doc in Org-B                                 | Visit link with Org-B doc ID                                        | 404 Not Found                                                 |
| SEC-004 | Session token scoped to Org-A rejects Org-B operations | Authenticated user in Org-A                                        | Call GET /api/rooms with manipulated organizationId in request body | 404 Not Found (server uses session org, ignores request body) |
| SEC-005 | RLS prevents cross-tenant access at DB level           | Bypass application layer, query DB directly with wrong org context | SELECT from documents with wrong app.current_org_id                 | Empty result set                                              |

**Note:** SEC-004 tests session-based tenant isolation (MVP). When API keys ship (V1, F135),
add SEC-017: "API key scoped to Org-A rejects Org-B operations" to extend this coverage.

### Header Spoofing Tests

| Test ID | Test Description                                 | Setup                       | Action                                     | Expected Result                                   |
| ------- | ------------------------------------------------ | --------------------------- | ------------------------------------------ | ------------------------------------------------- |
| SEC-006 | Client x-organization-id header is ignored       | Authenticated as Org-A user | Send request with x-organization-id: Org-B | Request uses Org-A (from session), header ignored |
| SEC-007 | Unauthenticated request with org header rejected | No auth                     | Send request with x-organization-id: Org-A | 401 Unauthorized                                  |

### Permission Revocation Tests

| Test ID | Test Description                                 | Setup                                        | Action                                   | Expected Result                   |
| ------- | ------------------------------------------------ | -------------------------------------------- | ---------------------------------------- | --------------------------------- |
| SEC-008 | Revoked permission takes effect within cache TTL | Grant access, user views doc, revoke access  | User requests doc again after revocation | 403 within 30 seconds (cache TTL) |
| SEC-009 | Removed group membership revokes access          | User has access via group, remove from group | User requests doc                        | 403 within 30 seconds             |

### Link Scope Tests

| Test ID | Test Description                                  | Setup                                               | Action                 | Expected Result      |
| ------- | ------------------------------------------------- | --------------------------------------------------- | ---------------------- | -------------------- |
| SEC-010 | Expired link returns 410 Gone                     | Create link, wait past expiry                       | Visit expired link     | 410 Gone             |
| SEC-011 | Link with wrong org_id match fails                | Tamper with link to point to different org resource | Visit tampered link    | 404 Not Found        |
| SEC-012 | Password-protected link requires correct password | Create password-protected link                      | Visit without password | 401, password prompt |

### Audit Immutability Tests

| Test ID | Test Description                         | Setup      | Action                                    | Expected Result                                  |
| ------- | ---------------------------------------- | ---------- | ----------------------------------------- | ------------------------------------------------ |
| SEC-013 | Events cannot be updated via application | Emit event | Attempt UPDATE on events table via Prisma | Database error (immutable)                       |
| SEC-014 | Events cannot be deleted via application | Emit event | Attempt DELETE on events table via Prisma | Database error (immutable or requires SUPERUSER) |

### Signed URL Tests

| Test ID | Test Description                                        | Setup                       | Action                         | Expected Result            |
| ------- | ------------------------------------------------------- | --------------------------- | ------------------------------ | -------------------------- |
| SEC-015 | Preview URL expires after 5 minutes                     | Generate preview signed URL | Wait 6 minutes, request URL    | 403 Forbidden from storage |
| SEC-016 | Signed URL cannot be reused after permission revocation | Generate URL, revoke access | Client requests new signed URL | 403 from application       |

---

## Implementation Checklist

MVP permission system implementation checklist:

- [ ] Define `PermissionEngine` interface (all methods)
- [ ] Implement permission resolution algorithm with all 14 layers
- [ ] Set up Redis-based permission caching with TTL and invalidation
- [ ] Create database tables: role_assignment, group, group_membership, room_permission, folder_permission, document_permission, link_permission, share_link
- [ ] Implement `canUserAccessDocument()` with full layer evaluation
- [ ] Implement `canUserAccessRoom()` with full layer evaluation
- [ ] Implement `canUserAccessFolder()` with full layer evaluation
- [ ] Implement `explainPermission()` for debugging and admin UI
- [ ] Implement `listAccessibleRooms()` for admin dashboard
- [ ] Implement `listAccessibleDocuments()` for folder/room views
- [ ] Implement `getEffectivePermissions()` for UI permission indicators
- [ ] Implement group CRUD operations (create, add member, remove member)
- [ ] Implement group permission grant/deny operations
- [ ] Integrate PermissionEngine into all API routes via middleware
- [ ] Integrate into admin UI (show only accessible rooms/documents)
- [ ] Integrate into viewer UI (enforce link permissions)
- [ ] Write comprehensive unit tests for each layer
- [ ] Write integration tests for complex scenarios (groups, inheritance, denies)
- [ ] Document permission troubleshooting in admin guide

---

**End of PERMISSION_MODEL.md**

Specification version: 1.0 | Last updated: 2026-03-14 | Feature ID: F141, F154
