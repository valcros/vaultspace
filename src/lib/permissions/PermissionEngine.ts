/**
 * PermissionEngine
 *
 * Evaluates access permissions using a 14-layer algorithm.
 * Supports role-based access, group membership, and link-based permissions.
 *
 * See PERMISSION_MODEL.md for full specification.
 */

import type { PermissionLevel, PermissionResourceType, UserRole } from '@prisma/client';

import { db } from '../db';

export type Action = 'view' | 'download' | 'admin' | 'delete' | 'manage_permissions';

export interface Actor {
  userId?: string;
  role?: UserRole;
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

export interface PermissionResult {
  allowed: boolean;
  level: PermissionLevel;
  reason: string;
  inheritedFrom?: {
    type: PermissionResourceType;
    id: string;
  };
}

/**
 * The PermissionEngine class evaluates access permissions.
 */
export class PermissionEngine {
  /**
   * Evaluate if an actor can perform an action on a resource
   */
  async evaluate(actor: Actor, action: Action, resource: Resource): Promise<PermissionResult> {
    // Layer 0: System actors always have access
    if (actor.isSystem) {
      return {
        allowed: true,
        level: 'ADMIN',
        reason: 'System actor',
      };
    }

    // Layer 1: Organization admin has full access
    if (actor.userId) {
      const orgMembership = await this.getOrgMembership(resource.organizationId, actor.userId);

      if (orgMembership?.role === 'ADMIN') {
        return {
          allowed: true,
          level: 'ADMIN',
          reason: 'Organization admin',
        };
      }

      // Layer 2: Room-level role assignment
      if (resource.roomId) {
        const roomRole = await this.getRoomRole(
          resource.organizationId,
          actor.userId,
          resource.roomId
        );

        if (roomRole === 'ADMIN') {
          return {
            allowed: true,
            level: 'ADMIN',
            reason: 'Room admin',
          };
        }
      }
    }

    // Layer 3-5: Check explicit permissions (document -> folder -> room)
    const explicitPermission = await this.getExplicitPermission(actor, resource);
    if (explicitPermission) {
      return this.evaluatePermissionLevel(explicitPermission.level, action);
    }

    // Layer 6: Check group permissions
    if (actor.groupIds?.length) {
      const groupPermission = await this.getGroupPermission(actor.groupIds, resource);
      if (groupPermission) {
        return this.evaluatePermissionLevel(groupPermission.level, action);
      }
    }

    // Layer 7: Check link-based access
    if (actor.linkId) {
      const linkPermission = await this.getLinkPermission(actor.linkId, resource);
      if (linkPermission) {
        return this.evaluatePermissionLevel(linkPermission.level, action);
      }
    }

    // Layer 8-14: Inheritance and defaults
    const inheritedPermission = await this.getInheritedPermission(actor, resource);
    if (inheritedPermission) {
      return inheritedPermission;
    }

    // Default: deny access
    return {
      allowed: false,
      level: 'NONE',
      reason: 'No permission found',
    };
  }

  /**
   * Check if an actor can perform an action (simplified boolean result)
   */
  async can(actor: Actor, action: Action, resource: Resource): Promise<boolean> {
    const result = await this.evaluate(actor, action, resource);
    return result.allowed;
  }

  /**
   * Get user's organization membership
   */
  private async getOrgMembership(organizationId: string, userId: string) {
    return db.userOrganization.findUnique({
      where: {
        organizationId_userId: { organizationId, userId },
      },
    });
  }

  /**
   * Get user's role for a specific room
   */
  private async getRoomRole(
    organizationId: string,
    userId: string,
    roomId: string
  ): Promise<UserRole | null> {
    const assignment = await db.roleAssignment.findFirst({
      where: {
        organizationId,
        userId,
        roomId,
        scopeType: 'ROOM',
      },
    });
    return assignment?.role ?? null;
  }

  /**
   * Get explicit permission for a resource
   */
  private async getExplicitPermission(
    actor: Actor,
    resource: Resource
  ): Promise<{ level: PermissionLevel } | null> {
    if (!actor.userId) {
      return null;
    }

    // Check document permission first
    if (resource.documentId) {
      const docPermission = await db.permission.findFirst({
        where: {
          organizationId: resource.organizationId,
          documentId: resource.documentId,
          userId: actor.userId,
          granteeType: 'USER',
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (docPermission) {
        return { level: docPermission.permissionLevel };
      }
    }

    // Check folder permission
    if (resource.folderId) {
      const folderPermission = await db.permission.findFirst({
        where: {
          organizationId: resource.organizationId,
          folderId: resource.folderId,
          userId: actor.userId,
          granteeType: 'USER',
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (folderPermission) {
        return { level: folderPermission.permissionLevel };
      }
    }

    // Check room permission
    if (resource.roomId) {
      const roomPermission = await db.permission.findFirst({
        where: {
          organizationId: resource.organizationId,
          roomId: resource.roomId,
          userId: actor.userId,
          granteeType: 'USER',
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (roomPermission) {
        return { level: roomPermission.permissionLevel };
      }
    }

    return null;
  }

  /**
   * Get permission through group membership
   */
  private async getGroupPermission(
    groupIds: string[],
    resource: Resource
  ): Promise<{ level: PermissionLevel } | null> {
    const permission = await db.permission.findFirst({
      where: {
        organizationId: resource.organizationId,
        groupId: { in: groupIds },
        granteeType: 'GROUP',
        isActive: true,
        OR: [
          { roomId: resource.roomId },
          { folderId: resource.folderId },
          { documentId: resource.documentId },
        ],
      },
      orderBy: { permissionLevel: 'desc' }, // Highest permission wins
    });

    return permission ? { level: permission.permissionLevel } : null;
  }

  /**
   * Get permission through link access
   */
  private async getLinkPermission(
    linkId: string,
    resource: Resource
  ): Promise<{ level: PermissionLevel } | null> {
    const link = await db.link.findUnique({
      where: { id: linkId },
    });

    if (!link || !link.isActive) {
      return null;
    }

    // Check link scope
    if (link.scope === 'ENTIRE_ROOM' && link.roomId === resource.roomId) {
      return { level: link.permission === 'DOWNLOAD' ? 'DOWNLOAD' : 'VIEW' };
    }

    if (link.scope === 'FOLDER' && link.scopedFolderId === resource.folderId) {
      return { level: link.permission === 'DOWNLOAD' ? 'DOWNLOAD' : 'VIEW' };
    }

    if (link.scope === 'DOCUMENT' && link.scopedDocumentId === resource.documentId) {
      return { level: link.permission === 'DOWNLOAD' ? 'DOWNLOAD' : 'VIEW' };
    }

    return null;
  }

  /**
   * Get inherited permission from parent resources
   */
  private async getInheritedPermission(
    actor: Actor,
    resource: Resource
  ): Promise<PermissionResult | null> {
    // If checking document, try to inherit from folder
    if (resource.documentId && resource.folderId) {
      const folderResult = await this.evaluate(actor, 'view', {
        ...resource,
        type: 'FOLDER',
        documentId: undefined,
      });
      if (folderResult.allowed) {
        return {
          ...folderResult,
          reason: `Inherited from folder`,
          inheritedFrom: { type: 'FOLDER', id: resource.folderId },
        };
      }
    }

    // If checking folder or document, try to inherit from room
    if ((resource.folderId || resource.documentId) && resource.roomId) {
      const roomResult = await this.evaluate(actor, 'view', {
        type: 'ROOM',
        organizationId: resource.organizationId,
        roomId: resource.roomId,
      });
      if (roomResult.allowed) {
        return {
          ...roomResult,
          reason: `Inherited from room`,
          inheritedFrom: { type: 'ROOM', id: resource.roomId },
        };
      }
    }

    return null;
  }

  /**
   * Evaluate if a permission level allows an action
   */
  private evaluatePermissionLevel(level: PermissionLevel, action: Action): PermissionResult {
    const levelHierarchy: Record<PermissionLevel, number> = {
      NONE: 0,
      VIEW: 1,
      DOWNLOAD: 2,
      ADMIN: 3,
    };

    const actionRequirements: Record<Action, PermissionLevel> = {
      view: 'VIEW',
      download: 'DOWNLOAD',
      admin: 'ADMIN',
      delete: 'ADMIN',
      manage_permissions: 'ADMIN',
    };

    const requiredLevel = actionRequirements[action];
    const allowed = levelHierarchy[level] >= levelHierarchy[requiredLevel];

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
