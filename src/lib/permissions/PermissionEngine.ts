/**
 * PermissionEngine
 *
 * Evaluates access permissions using a 14-layer algorithm.
 * Supports role-based access, group membership, and link-based permissions.
 *
 * See PERMISSION_MODEL.md for full specification.
 *
 * RLS Support:
 * The PermissionEngine can accept an optional Prisma transaction client
 * to run permission checks within an RLS-scoped context. When called from
 * services using withOrgContext(), pass the transaction client to ensure
 * all permission queries respect the RLS tenant boundary.
 */

import type { PermissionLevel, PermissionResourceType, UserRole, Prisma } from '@prisma/client';

import { db } from '../db';
import { canLinkAccessResource, linkPermissionLevel } from './LinkPolicy';

/**
 * Database client type - either the global singleton or a transaction client
 */
type DbClient = typeof db | Prisma.TransactionClient;

export type Action = 'view' | 'download' | 'admin' | 'delete' | 'manage_permissions';

export interface Actor {
  userId?: string;
  /** @deprecated Persisted organization membership is authoritative. */
  role?: UserRole;
  /** @deprecated Group memberships are loaded from the database. */
  groupIds?: string[];
  linkId?: string;
  isSystem?: boolean;
}

export interface Resource {
  type: PermissionResourceType;
  organizationId: string;
  roomId?: string;
  folderId?: string;
  documentId?: string;
}

export interface DocumentViewCandidate {
  id: string;
  folderId: string | null;
}

export interface PreparedDocumentViewAuthorization {
  readonly unrestricted: boolean;
  getViewableIds(candidates: readonly DocumentViewCandidate[]): string[];
}

export interface PermissionResult {
  allowed: boolean;
  level: PermissionLevel;
  reason: string;
  inheritedFrom?: {
    type: PermissionResourceType;
    id: string;
  };
}

export interface PermissionExplanation {
  allowed: boolean;
  action: Action;
  resource: Resource;
  reasoning: string[];
  summary: string;
}

const PERMISSION_LEVEL_RANK: Record<PermissionLevel, number> = {
  NONE: 0,
  VIEW: 1,
  DOWNLOAD: 2,
  ADMIN: 3,
};

type ApplicablePermission = {
  permissionLevel: PermissionLevel;
  resourceType: PermissionResourceType;
  roomId: string | null;
  folderId: string | null;
  documentId: string | null;
};

type PreparedPermission = ApplicablePermission & {
  inheritFromParent: boolean;
};

/**
 * The PermissionEngine class evaluates access permissions.
 */
export class PermissionEngine {
  /**
   * Evaluate if an actor can perform an action on a resource
   *
   * @param actor - The actor requesting access
   * @param action - The action being performed
   * @param resource - The resource being accessed
   * @param client - Optional Prisma transaction client for RLS context
   */
  async evaluate(
    actor: Actor,
    action: Action,
    resource: Resource,
    client?: DbClient
  ): Promise<PermissionResult> {
    const dbClient = client ?? db;

    if (actor.isSystem) {
      return {
        allowed: true,
        level: 'ADMIN',
        reason: 'System actor',
      };
    }

    // A request carrying link identity stays link-bound. An authenticated user
    // cannot widen a scoped link with unrelated organization permissions.
    if (actor.linkId) {
      const linkPermission = await this.getLinkPermission(actor.linkId, action, resource, dbClient);
      if (linkPermission) {
        return this.evaluatePermissionLevel(linkPermission.level, action);
      }
      return this.defaultDeny('Link is not valid for this resource');
    }

    if (!actor.userId) {
      return this.defaultDeny('No authenticated actor');
    }

    const orgMembership = await this.getOrgMembership(
      resource.organizationId,
      actor.userId,
      dbClient
    );
    if (!orgMembership?.isActive) {
      return this.defaultDeny('No active organization membership');
    }

    // Persisted organization and room authority is evaluated before non-admin
    // ACL denies, as required by the permission contract.
    if (orgMembership.role === 'ADMIN') {
      return { allowed: true, level: 'ADMIN', reason: 'Organization admin' };
    }

    if (resource.roomId) {
      const roomRole = await this.getRoomRole(
        resource.organizationId,
        actor.userId,
        resource.roomId,
        dbClient
      );
      if (roomRole === 'ADMIN') {
        return { allowed: true, level: 'ADMIN', reason: 'Room admin' };
      }
    }

    const permissions = await this.getApplicablePermissions(actor.userId, resource, dbClient);
    const explicitDeny = permissions.find((permission) => permission.permissionLevel === 'NONE');
    if (explicitDeny) {
      return {
        allowed: false,
        level: 'NONE',
        reason: `Explicit deny on ${explicitDeny.resourceType.toLowerCase()}`,
        inheritedFrom: this.inheritedFrom(explicitDeny, resource),
      };
    }

    const strongest = permissions.reduce<ApplicablePermission | null>((current, permission) => {
      if (!current) {
        return permission;
      }
      return PERMISSION_LEVEL_RANK[permission.permissionLevel] >
        PERMISSION_LEVEL_RANK[current.permissionLevel]
        ? permission
        : current;
    }, null);

    if (!strongest) {
      return this.defaultDeny('No permission found');
    }

    const result = this.evaluatePermissionLevel(strongest.permissionLevel, action);
    const inheritedFrom = this.inheritedFrom(strongest, resource);
    return {
      ...result,
      reason: inheritedFrom
        ? `${result.reason}; inherited from ${inheritedFrom.type.toLowerCase()}`
        : result.reason,
      inheritedFrom,
    };
  }

  /**
   * Check if an actor can perform an action (simplified boolean result)
   *
   * @param actor - The actor requesting access
   * @param action - The action being performed
   * @param resource - The resource being accessed
   * @param client - Optional Prisma transaction client for RLS context
   */
  async can(actor: Actor, action: Action, resource: Resource, client?: DbClient): Promise<boolean> {
    const result = await this.evaluate(actor, action, resource, client);
    return result.allowed;
  }

  /**
   * Explain why a permission decision was made (F141)
   * Returns human-readable reasoning chain for debugging and audit
   *
   * @param actor - The actor requesting access
   * @param action - The action being performed
   * @param resource - The resource being accessed
   * @param client - Optional Prisma transaction client for RLS context
   */
  async explainPermission(
    actor: Actor,
    action: Action,
    resource: Resource,
    client?: DbClient
  ): Promise<PermissionExplanation> {
    const result = await this.evaluate(actor, action, resource, client);
    return {
      allowed: result.allowed,
      action,
      resource,
      reasoning: [result.reason],
      summary: `${result.allowed ? 'Allowed' : 'Denied'}: ${result.reason}`,
    };
  }

  /**
   * Resolve the room IDs that may appear in the general room list.
   * A null result means the persisted organization ADMIN authority is
   * unrestricted inside the supplied organization. Leaf-only grants are
   * intentionally excluded from discovery.
   */
  async getViewableRoomIds(
    actor: Actor,
    organizationId: string,
    client?: DbClient
  ): Promise<Set<string> | null> {
    const dbClient = client ?? db;
    if (actor.isSystem) {
      return null;
    }
    if (!actor.userId) {
      return new Set();
    }

    const membership = await this.getOrgMembership(organizationId, actor.userId, dbClient);
    if (!membership?.isActive) {
      return new Set();
    }
    if (membership.role === 'ADMIN') {
      return null;
    }

    const groupIds = await this.getActiveGroupIds(organizationId, actor.userId, dbClient);
    const grantees: Prisma.PermissionWhereInput[] = [
      { granteeType: 'USER', userId: actor.userId },
      ...(groupIds.length > 0
        ? [{ granteeType: 'GROUP' as const, groupId: { in: groupIds } }]
        : []),
    ];
    const now = new Date();

    const [assignments, permissions] = await Promise.all([
      dbClient.roleAssignment.findMany({
        where: {
          organizationId,
          userId: actor.userId,
          scopeType: 'ROOM',
          role: 'ADMIN',
          roomId: { not: null },
        },
        select: { roomId: true },
      }),
      dbClient.permission.findMany({
        where: {
          organizationId,
          resourceType: 'ROOM',
          roomId: { not: null },
          isActive: true,
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { OR: grantees }],
        },
        select: {
          permissionLevel: true,
          resourceType: true,
          roomId: true,
          folderId: true,
          documentId: true,
        },
      }),
    ]);

    const roomAdminIds = new Set(
      assignments.flatMap((assignment) => (assignment.roomId ? [assignment.roomId] : []))
    );
    const allowed = new Set(roomAdminIds);
    const denied = new Set<string>();

    for (const permission of permissions) {
      if (
        permission.resourceType !== 'ROOM' ||
        !permission.roomId ||
        roomAdminIds.has(permission.roomId)
      ) {
        continue;
      }
      if (permission.permissionLevel === 'NONE') {
        denied.add(permission.roomId);
        allowed.delete(permission.roomId);
      } else if (
        !denied.has(permission.roomId) &&
        PERMISSION_LEVEL_RANK[permission.permissionLevel] >= PERMISSION_LEVEL_RANK.VIEW
      ) {
        allowed.add(permission.roomId);
      }
    }

    return allowed;
  }

  /**
   * Prepare a set-based document VIEW authorizer for one actor and room.
   * Persisted authority and ACL rows are loaded once; callers can then pass
   * bounded candidate pages without issuing permission queries per document.
   */
  async prepareDocumentViewAuthorization(
    actor: Actor,
    organizationId: string,
    roomId: string,
    client?: DbClient
  ): Promise<PreparedDocumentViewAuthorization> {
    const allowAll = (): PreparedDocumentViewAuthorization => ({
      unrestricted: true,
      getViewableIds: (candidates) => candidates.map(({ id }) => id),
    });
    const denyAll = (): PreparedDocumentViewAuthorization => ({
      unrestricted: false,
      getViewableIds: () => [],
    });

    if (actor.isSystem) {
      return allowAll();
    }
    if (actor.linkId || !actor.userId) {
      return denyAll();
    }

    const dbClient = client ?? db;
    const membership = await this.getOrgMembership(organizationId, actor.userId, dbClient);
    if (!membership?.isActive) {
      return denyAll();
    }
    if (membership.role === 'ADMIN') {
      return allowAll();
    }

    const roomRole = await this.getRoomRole(organizationId, actor.userId, roomId, dbClient);
    if (roomRole === 'ADMIN') {
      return allowAll();
    }

    const [groupIds, folders] = await Promise.all([
      this.getActiveGroupIds(organizationId, actor.userId, dbClient),
      dbClient.folder.findMany({
        where: { organizationId, roomId },
        select: { id: true, parentId: true },
      }),
    ]);
    const grantees: Prisma.PermissionWhereInput[] = [
      { granteeType: 'USER', userId: actor.userId },
      ...(groupIds.length > 0
        ? [{ granteeType: 'GROUP' as const, groupId: { in: groupIds } }]
        : []),
    ];
    const permissions: PreparedPermission[] = await dbClient.permission.findMany({
      where: {
        organizationId,
        isActive: true,
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, { OR: grantees }],
      },
      select: {
        permissionLevel: true,
        resourceType: true,
        roomId: true,
        folderId: true,
        documentId: true,
        inheritFromParent: true,
      },
    });

    const parentByFolderId = new Map(folders.map((folder) => [folder.id, folder.parentId]));
    const roomPermissions = permissions.filter(
      (permission) =>
        permission.resourceType === 'ROOM' &&
        permission.roomId === roomId &&
        permission.inheritFromParent
    );
    const permissionsByFolderId = new Map<string, PreparedPermission[]>();
    const permissionsByDocumentId = new Map<string, PreparedPermission[]>();

    for (const permission of permissions) {
      if (
        permission.resourceType === 'FOLDER' &&
        permission.folderId &&
        permission.inheritFromParent &&
        parentByFolderId.has(permission.folderId)
      ) {
        const existing = permissionsByFolderId.get(permission.folderId) ?? [];
        existing.push(permission);
        permissionsByFolderId.set(permission.folderId, existing);
      } else if (permission.resourceType === 'DOCUMENT' && permission.documentId) {
        const existing = permissionsByDocumentId.get(permission.documentId) ?? [];
        existing.push(permission);
        permissionsByDocumentId.set(permission.documentId, existing);
      }
    }

    const getFolderLineage = (folderId: string | null): string[] => {
      if (!folderId) {
        return [];
      }
      const lineage: string[] = [];
      const visited = new Set<string>();
      let currentFolderId: string | null = folderId;
      while (
        currentFolderId &&
        !visited.has(currentFolderId) &&
        parentByFolderId.has(currentFolderId)
      ) {
        visited.add(currentFolderId);
        lineage.push(currentFolderId);
        currentFolderId = parentByFolderId.get(currentFolderId) ?? null;
      }
      return lineage;
    };

    return {
      unrestricted: false,
      getViewableIds: (candidates) => {
        const viewableIds: string[] = [];
        for (const candidate of candidates) {
          let explicitlyDenied = false;
          let strongestRank = PERMISSION_LEVEL_RANK.NONE;
          const apply = (applicable: readonly PreparedPermission[]) => {
            for (const permission of applicable) {
              if (permission.permissionLevel === 'NONE') {
                explicitlyDenied = true;
              }
              strongestRank = Math.max(
                strongestRank,
                PERMISSION_LEVEL_RANK[permission.permissionLevel]
              );
            }
          };

          apply(roomPermissions);
          apply(permissionsByDocumentId.get(candidate.id) ?? []);
          for (const ancestorId of getFolderLineage(candidate.folderId)) {
            apply(permissionsByFolderId.get(ancestorId) ?? []);
          }

          if (!explicitlyDenied && strongestRank >= PERMISSION_LEVEL_RANK.VIEW) {
            viewableIds.push(candidate.id);
          }
        }
        return viewableIds;
      },
    };
  }

  /**
   * Get user's organization membership
   */
  private async getOrgMembership(organizationId: string, userId: string, client: DbClient) {
    return client.userOrganization.findUnique({
      where: {
        organizationId_userId: { organizationId, userId },
      },
      select: { role: true, isActive: true },
    });
  }

  /**
   * Get user's role for a specific room
   */
  private async getRoomRole(
    organizationId: string,
    userId: string,
    roomId: string,
    client: DbClient
  ): Promise<UserRole | null> {
    const assignment = await client.roleAssignment.findFirst({
      where: {
        organizationId,
        userId,
        roomId,
        scopeType: 'ROOM',
      },
      select: { role: true },
    });
    return assignment?.role ?? null;
  }

  private async getActiveGroupIds(
    organizationId: string,
    userId: string,
    client: DbClient
  ): Promise<string[]> {
    const memberships = await client.groupMembership.findMany({
      where: {
        userId,
        group: { organizationId, isActive: true },
      },
      select: { groupId: true },
    });
    return memberships.map((membership) => membership.groupId);
  }

  private async getApplicablePermissions(
    userId: string,
    resource: Resource,
    client: DbClient
  ): Promise<ApplicablePermission[]> {
    const [groupIds, folderLineage] = await Promise.all([
      this.getActiveGroupIds(resource.organizationId, userId, client),
      this.getFolderLineage(resource, client),
    ]);
    const grantees: Prisma.PermissionWhereInput[] = [
      { granteeType: 'USER', userId },
      ...(groupIds.length > 0
        ? [{ granteeType: 'GROUP' as const, groupId: { in: groupIds } }]
        : []),
    ];
    const resources: Prisma.PermissionWhereInput[] = [];

    if (resource.documentId) {
      resources.push({ resourceType: 'DOCUMENT', documentId: resource.documentId });
    }
    const [directFolderId, ...ancestorFolderIds] = folderLineage;
    if (directFolderId && resource.type === 'FOLDER') {
      resources.push({
        resourceType: 'FOLDER',
        folderId: directFolderId,
      });
    }
    const inheritableFolderIds = resource.type === 'FOLDER' ? ancestorFolderIds : folderLineage;
    if (inheritableFolderIds.length > 0) {
      resources.push({
        resourceType: 'FOLDER',
        folderId: { in: inheritableFolderIds },
        inheritFromParent: true,
      });
    }
    if (resource.roomId) {
      resources.push({
        resourceType: 'ROOM',
        roomId: resource.roomId,
        ...(resource.type !== 'ROOM' && { inheritFromParent: true }),
      });
    }
    if (resources.length === 0) {
      return [];
    }

    return client.permission.findMany({
      where: {
        organizationId: resource.organizationId,
        isActive: true,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          { OR: grantees },
          { OR: resources },
        ],
      },
      select: {
        permissionLevel: true,
        resourceType: true,
        roomId: true,
        folderId: true,
        documentId: true,
      },
    });
  }

  /**
   * Resolve the requested folder followed by its ancestors. Folder IDs are
   * constrained to the resource tenant and room so a malformed resource tuple
   * cannot borrow an inheritance chain from another room or organization.
   */
  private async getFolderLineage(resource: Resource, client: DbClient): Promise<string[]> {
    if (!resource.folderId) {
      return [];
    }

    const folderIds: string[] = [];
    const visited = new Set<string>();
    let currentFolderId: string | null = resource.folderId;

    while (currentFolderId && !visited.has(currentFolderId)) {
      visited.add(currentFolderId);
      const folder: { id: string; parentId: string | null } | null = await client.folder.findFirst({
        where: {
          id: currentFolderId,
          organizationId: resource.organizationId,
          ...(resource.roomId ? { roomId: resource.roomId } : {}),
        },
        select: { id: true, parentId: true },
      });
      if (!folder) {
        break;
      }
      folderIds.push(folder.id);
      currentFolderId = folder.parentId;
    }

    return folderIds;
  }

  /**
   * Get permission through link access
   */
  private async getLinkPermission(
    linkId: string,
    action: Action,
    resource: Resource,
    client: DbClient
  ): Promise<{ level: PermissionLevel } | null> {
    const link = await client.link.findUnique({
      where: { id: linkId },
      select: {
        organizationId: true,
        roomId: true,
        permission: true,
        scope: true,
        scopedFolderId: true,
        scopedDocumentId: true,
        isActive: true,
        expiresAt: true,
        room: {
          select: {
            id: true,
            organizationId: true,
            status: true,
          },
        },
      },
    });

    if (!link || !resource.roomId || (action !== 'view' && action !== 'download')) {
      return null;
    }

    const allowed = await canLinkAccessResource(client as Prisma.TransactionClient, link, action, {
      organizationId: resource.organizationId,
      roomId: resource.roomId,
      folderId: resource.folderId,
      documentId: resource.documentId,
    });
    return allowed ? { level: linkPermissionLevel(link.permission) } : null;
  }

  private inheritedFrom(
    permission: ApplicablePermission,
    resource: Resource
  ): PermissionResult['inheritedFrom'] {
    if (permission.resourceType === resource.type) {
      return undefined;
    }
    const id =
      permission.resourceType === 'ROOM'
        ? permission.roomId
        : permission.resourceType === 'FOLDER'
          ? permission.folderId
          : permission.documentId;
    return id ? { type: permission.resourceType, id } : undefined;
  }

  private defaultDeny(reason: string): PermissionResult {
    return { allowed: false, level: 'NONE', reason };
  }

  /**
   * Evaluate if a permission level allows an action
   */
  private evaluatePermissionLevel(level: PermissionLevel, action: Action): PermissionResult {
    const actionRequirements: Record<Action, PermissionLevel> = {
      view: 'VIEW',
      download: 'DOWNLOAD',
      admin: 'ADMIN',
      delete: 'ADMIN',
      manage_permissions: 'ADMIN',
    };

    const requiredLevel = actionRequirements[action];
    const allowed = PERMISSION_LEVEL_RANK[level] >= PERMISSION_LEVEL_RANK[requiredLevel];

    return {
      allowed,
      level,
      reason: allowed
        ? `Permission level ${level} allows ${action}`
        : `Permission level ${level} insufficient for ${action}`,
    };
  }
}

// Singleton instance
let permissionEngine: PermissionEngine | null = null;

/**
 * Get the PermissionEngine singleton
 */
export function getPermissionEngine(): PermissionEngine {
  if (!permissionEngine) {
    permissionEngine = new PermissionEngine();
  }
  return permissionEngine;
}
