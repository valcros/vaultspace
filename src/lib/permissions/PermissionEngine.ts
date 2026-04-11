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

/**
 * Database client type - either the global singleton or a transaction client
 */
type DbClient = typeof db | Prisma.TransactionClient;

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

export interface PermissionExplanation {
  allowed: boolean;
  action: Action;
  resource: Resource;
  reasoning: string[];
  summary: string;
}

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
      const orgMembership = await this.getOrgMembership(
        resource.organizationId,
        actor.userId,
        dbClient
      );

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
          resource.roomId,
          dbClient
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
    const explicitPermission = await this.getExplicitPermission(actor, resource, dbClient);
    if (explicitPermission) {
      return this.evaluatePermissionLevel(explicitPermission.level, action);
    }

    // Layer 6: Check group permissions
    if (actor.groupIds?.length) {
      const groupPermission = await this.getGroupPermission(actor.groupIds, resource, dbClient);
      if (groupPermission) {
        return this.evaluatePermissionLevel(groupPermission.level, action);
      }
    }

    // Layer 7: Check link-based access
    if (actor.linkId) {
      const linkPermission = await this.getLinkPermission(actor.linkId, resource, dbClient);
      if (linkPermission) {
        return this.evaluatePermissionLevel(linkPermission.level, action);
      }
    }

    // Layer 8-14: Inheritance and defaults
    const inheritedPermission = await this.getInheritedPermission(actor, resource, dbClient);
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
    const dbClient = client ?? db;
    const reasoning: string[] = [];

    // Layer 0: System actors
    if (actor.isSystem) {
      reasoning.push('Layer 0: Actor is system user → ADMIN access granted');
      return {
        allowed: true,
        action,
        resource,
        reasoning,
        summary: 'Allowed: system actor has full access',
      };
    }
    reasoning.push('Layer 0: Not a system actor → continue evaluation');

    // Layer 1: Organization admin check
    if (actor.userId) {
      const orgMembership = await this.getOrgMembership(
        resource.organizationId,
        actor.userId,
        dbClient
      );

      if (orgMembership?.role === 'ADMIN') {
        reasoning.push(`Layer 1: User is organization admin → ADMIN access granted`);
        return {
          allowed: true,
          action,
          resource,
          reasoning,
          summary: 'Allowed: organization admin has full access',
        };
      }
      reasoning.push(
        `Layer 1: User role is ${orgMembership?.role ?? 'VIEWER'} (not ADMIN) → continue`
      );

      // Layer 2: Room-level role assignment
      if (resource.roomId) {
        const roomRole = await this.getRoomRole(
          resource.organizationId,
          actor.userId,
          resource.roomId,
          dbClient
        );

        if (roomRole === 'ADMIN') {
          reasoning.push(`Layer 2: User has ADMIN role on room → ADMIN access granted`);
          return {
            allowed: true,
            action,
            resource,
            reasoning,
            summary: 'Allowed: room admin has full access to room resources',
          };
        }
        reasoning.push(`Layer 2: User room role is ${roomRole ?? 'none'} → continue`);
      } else {
        reasoning.push('Layer 2: No room context → skip room role check');
      }
    } else {
      reasoning.push('Layer 1-2: No userId provided → skip user-specific checks');
    }

    // Layer 3-5: Explicit permissions (document → folder → room)
    const explicitPermission = await this.getExplicitPermission(actor, resource, dbClient);
    if (explicitPermission) {
      const result = this.evaluatePermissionLevel(explicitPermission.level, action);
      const resourceType = resource.documentId ? 'document' : resource.folderId ? 'folder' : 'room';
      reasoning.push(
        `Layer 3-5: Found explicit ${explicitPermission.level} permission on ${resourceType}`
      );
      reasoning.push(
        `Permission level ${explicitPermission.level} ${result.allowed ? 'allows' : 'does not allow'} ${action}`
      );
      return {
        allowed: result.allowed,
        action,
        resource,
        reasoning,
        summary: result.allowed
          ? `Allowed: explicit ${explicitPermission.level} permission on ${resourceType}`
          : `Denied: ${explicitPermission.level} permission insufficient for ${action}`,
      };
    }
    reasoning.push('Layer 3-5: No explicit user permission found → continue');

    // Layer 6: Group permissions
    if (actor.groupIds?.length) {
      const groupPermission = await this.getGroupPermission(actor.groupIds, resource, dbClient);
      if (groupPermission) {
        const result = this.evaluatePermissionLevel(groupPermission.level, action);
        reasoning.push(`Layer 6: User in group(s) with ${groupPermission.level} permission`);
        reasoning.push(
          `Permission level ${groupPermission.level} ${result.allowed ? 'allows' : 'does not allow'} ${action}`
        );
        return {
          allowed: result.allowed,
          action,
          resource,
          reasoning,
          summary: result.allowed
            ? `Allowed: group membership grants ${groupPermission.level} access`
            : `Denied: group ${groupPermission.level} permission insufficient for ${action}`,
        };
      }
      reasoning.push(
        `Layer 6: User groups [${actor.groupIds.join(', ')}] have no permissions → continue`
      );
    } else {
      reasoning.push('Layer 6: User has no group memberships → skip group check');
    }

    // Layer 7: Link-based access
    if (actor.linkId) {
      const linkPermission = await this.getLinkPermission(actor.linkId, resource, dbClient);
      if (linkPermission) {
        const result = this.evaluatePermissionLevel(linkPermission.level, action);
        reasoning.push(`Layer 7: Link grants ${linkPermission.level} access`);
        reasoning.push(
          `Permission level ${linkPermission.level} ${result.allowed ? 'allows' : 'does not allow'} ${action}`
        );
        return {
          allowed: result.allowed,
          action,
          resource,
          reasoning,
          summary: result.allowed
            ? `Allowed: link access grants ${linkPermission.level}`
            : `Denied: link ${linkPermission.level} permission insufficient for ${action}`,
        };
      }
      reasoning.push('Layer 7: Link not valid for this resource → continue');
    } else {
      reasoning.push('Layer 7: No link context → skip link check');
    }

    // Layer 8-14: Inheritance
    const inheritedPermission = await this.getInheritedPermission(actor, resource, dbClient);
    if (inheritedPermission) {
      reasoning.push(
        `Layer 8-14: ${inheritedPermission.reason} (${inheritedPermission.inheritedFrom?.type})`
      );
      reasoning.push(
        `Inherited level ${inheritedPermission.level} ${inheritedPermission.allowed ? 'allows' : 'does not allow'} ${action}`
      );
      return {
        allowed: inheritedPermission.allowed,
        action,
        resource,
        reasoning,
        summary: inheritedPermission.allowed
          ? `Allowed: inherited from ${inheritedPermission.inheritedFrom?.type?.toLowerCase()}`
          : `Denied: inherited ${inheritedPermission.level} insufficient for ${action}`,
      };
    }
    reasoning.push('Layer 8-14: No inherited permissions found');

    // Default deny
    reasoning.push('Default: No permission found → DENIED');
    return {
      allowed: false,
      action,
      resource,
      reasoning,
      summary: 'Denied: no permission grants access to this resource',
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
    });
    return assignment?.role ?? null;
  }

  /**
   * Get explicit permission for a resource
   */
  private async getExplicitPermission(
    actor: Actor,
    resource: Resource,
    client: DbClient
  ): Promise<{ level: PermissionLevel } | null> {
    if (!actor.userId) {
      return null;
    }

    // Check document permission first
    if (resource.documentId) {
      const docPermission = await client.permission.findFirst({
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
      const folderPermission = await client.permission.findFirst({
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
      const roomPermission = await client.permission.findFirst({
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
    resource: Resource,
    client: DbClient
  ): Promise<{ level: PermissionLevel } | null> {
    const permission = await client.permission.findFirst({
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
    resource: Resource,
    client: DbClient
  ): Promise<{ level: PermissionLevel } | null> {
    const link = await client.link.findUnique({
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
    resource: Resource,
    client: DbClient
  ): Promise<PermissionResult | null> {
    // If checking document, try to inherit from folder
    if (resource.documentId && resource.folderId) {
      const folderResult = await this.evaluate(
        actor,
        'view',
        {
          ...resource,
          type: 'FOLDER',
          documentId: undefined,
        },
        client
      );
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
      const roomResult = await this.evaluate(
        actor,
        'view',
        {
          type: 'ROOM',
          organizationId: resource.organizationId,
          roomId: resource.roomId,
        },
        client
      );
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
