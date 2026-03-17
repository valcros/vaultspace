/**
 * Group Service
 *
 * Handles user group management for batch permissions.
 * Groups simplify permission assignment by allowing users to be organized.
 */

import type { Group, GroupMembership, Prisma } from '@prisma/client';

import { withOrgContext } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

import type { PaginatedResult, PaginationOptions, ServiceContext } from './types';

/**
 * Group creation options
 */
export interface CreateGroupOptions {
  name: string;
  description?: string;
}

/**
 * Group update options
 */
export interface UpdateGroupOptions {
  name?: string;
  description?: string;
}

/**
 * Group list filters
 */
export interface GroupListOptions extends PaginationOptions {
  search?: string;
}

/**
 * Group with member count
 */
export interface GroupWithCount extends Group {
  _count: {
    memberships: number;
  };
}

/**
 * Group member info
 */
export interface GroupMemberInfo {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  joinedAt: Date;
}

export class GroupService {
  /**
   * Create a new group
   * @mutating
   */
  async create(ctx: ServiceContext, options: CreateGroupOptions): Promise<Group> {
    const { session, eventBus } = ctx;
    const organizationId = session.organizationId;

    // Only admins can create groups
    if (session.organization.role !== 'ADMIN') {
      throw new ConflictError('Only admins can create groups');
    }

    // Validate name
    if (!options.name || options.name.trim().length === 0) {
      throw new ValidationError('Group name is required');
    }

    if (options.name.length > 100) {
      throw new ValidationError('Group name must be 100 characters or less');
    }

    // Use RLS context for all org-scoped operations
    const group = await withOrgContext(organizationId, async (tx) => {
      // Check for duplicate name
      const existing = await tx.group.findFirst({
        where: {
          organizationId,
          name: options.name.trim(),
        },
      });

      if (existing) {
        throw new ConflictError('A group with this name already exists');
      }

      // Create group
      return tx.group.create({
        data: {
          organizationId,
          name: options.name.trim(),
          description: options.description?.trim(),
        },
      });
    });

    // Emit event (EventBus wraps in RLS context internally)
    await eventBus.emit('PERMISSION_GRANTED', {
      description: `Created group: ${group.name}`,
      metadata: {
        groupId: group.id,
        groupName: group.name,
        action: 'group_created',
      },
    });

    return group;
  }

  /**
   * Get a group by ID
   * @readonly
   */
  async getById(ctx: ServiceContext, groupId: string): Promise<GroupWithCount | null> {
    const { session } = ctx;

    // Use RLS context for org-scoped query
    return withOrgContext(session.organizationId, async (tx) => {
      return tx.group.findFirst({
        where: {
          id: groupId,
          organizationId: session.organizationId,
        },
        include: {
          _count: {
            select: { memberships: true },
          },
        },
      });
    });
  }

  /**
   * List groups in the organization
   * @readonly
   */
  async list(
    ctx: ServiceContext,
    options: GroupListOptions = {}
  ): Promise<PaginatedResult<GroupWithCount>> {
    const { session } = ctx;
    const { search, offset = 0, limit = 50 } = options;

    // Build where clause
    const where: Prisma.GroupWhereInput = {
      organizationId: session.organizationId,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    // Use RLS context for org-scoped queries
    const { total, groups } = await withOrgContext(session.organizationId, async (tx) => {
      const total = await tx.group.count({ where });

      const groups = await tx.group.findMany({
        where,
        include: {
          _count: {
            select: { memberships: true },
          },
        },
        orderBy: { name: 'asc' },
        skip: offset,
        take: limit,
      });

      return { total, groups };
    });

    return {
      items: groups,
      total,
      offset,
      limit,
      hasMore: offset + groups.length < total,
    };
  }

  /**
   * Update a group
   * @mutating
   */
  async update(ctx: ServiceContext, groupId: string, options: UpdateGroupOptions): Promise<Group> {
    const { session, eventBus } = ctx;

    // Only admins can update groups
    if (session.organization.role !== 'ADMIN') {
      throw new ConflictError('Only admins can update groups');
    }

    // Use RLS context for all org-scoped operations
    const updated = await withOrgContext(session.organizationId, async (tx) => {
      // Get the group
      const group = await tx.group.findFirst({
        where: {
          id: groupId,
          organizationId: session.organizationId,
        },
      });

      if (!group) {
        throw new NotFoundError('Group not found');
      }

      // Build update data
      const data: Prisma.GroupUpdateInput = {};

      if (options.name !== undefined) {
        if (!options.name.trim()) {
          throw new ValidationError('Group name cannot be empty');
        }

        // Check for duplicate name
        const existing = await tx.group.findFirst({
          where: {
            organizationId: session.organizationId,
            name: options.name.trim(),
            id: { not: groupId },
          },
        });

        if (existing) {
          throw new ConflictError('A group with this name already exists');
        }

        data.name = options.name.trim();
      }

      if (options.description !== undefined) {
        data.description = options.description?.trim() || null;
      }

      // Update group
      return tx.group.update({
        where: { id: groupId },
        data,
      });
    });

    // Emit event (EventBus wraps in RLS context internally)
    await eventBus.emit('PERMISSION_UPDATED', {
      description: `Updated group: ${updated.name}`,
      metadata: {
        groupId,
        changes: options,
      },
    });

    return updated;
  }

  /**
   * Delete a group
   * @mutating
   */
  async delete(ctx: ServiceContext, groupId: string): Promise<void> {
    const { session, eventBus } = ctx;

    // Only admins can delete groups
    if (session.organization.role !== 'ADMIN') {
      throw new ConflictError('Only admins can delete groups');
    }

    // Use RLS context for all org-scoped operations
    const group = await withOrgContext(session.organizationId, async (tx) => {
      // Get the group
      const group = await tx.group.findFirst({
        where: {
          id: groupId,
          organizationId: session.organizationId,
        },
      });

      if (!group) {
        throw new NotFoundError('Group not found');
      }

      // Delete group (cascades to memberships)
      await tx.group.delete({
        where: { id: groupId },
      });

      return group;
    });

    // Emit event (EventBus wraps in RLS context internally)
    await eventBus.emit('PERMISSION_REVOKED', {
      description: `Deleted group: ${group.name}`,
      metadata: {
        groupId,
        groupName: group.name,
        action: 'group_deleted',
      },
    });
  }

  /**
   * Add a member to a group
   * @mutating
   */
  async addMember(ctx: ServiceContext, groupId: string, userId: string): Promise<GroupMembership> {
    const { session, eventBus } = ctx;

    // Only admins can manage group members
    if (session.organization.role !== 'ADMIN') {
      throw new ConflictError('Only admins can manage group members');
    }

    // Use RLS context for all org-scoped operations
    const { membership, group, userMembership } = await withOrgContext(
      session.organizationId,
      async (tx) => {
        // Get the group
        const group = await tx.group.findFirst({
          where: {
            id: groupId,
            organizationId: session.organizationId,
          },
        });

        if (!group) {
          throw new NotFoundError('Group not found');
        }

        // Verify user exists and is in the organization
        const userMembership = await tx.userOrganization.findFirst({
          where: {
            userId,
            organizationId: session.organizationId,
            isActive: true,
          },
          include: {
            user: true,
          },
        });

        if (!userMembership) {
          throw new NotFoundError('User not found in organization');
        }

        // Check if already a member
        const existing = await tx.groupMembership.findFirst({
          where: { groupId, userId },
        });

        if (existing) {
          throw new ConflictError('User is already a member of this group');
        }

        // Add membership
        const membership = await tx.groupMembership.create({
          data: {
            groupId,
            userId,
          },
        });

        return { membership, group, userMembership };
      }
    );

    // Emit event (EventBus wraps in RLS context internally)
    await eventBus.emit('PERMISSION_GRANTED', {
      description: `Added ${userMembership.user.email} to group: ${group.name}`,
      metadata: {
        groupId,
        groupName: group.name,
        userId,
        userEmail: userMembership.user.email,
        action: 'member_added',
      },
    });

    return membership;
  }

  /**
   * Remove a member from a group
   * @mutating
   */
  async removeMember(ctx: ServiceContext, groupId: string, userId: string): Promise<void> {
    const { session, eventBus } = ctx;

    // Only admins can manage group members
    if (session.organization.role !== 'ADMIN') {
      throw new ConflictError('Only admins can manage group members');
    }

    // Use RLS context for all org-scoped operations
    const { group, membership } = await withOrgContext(session.organizationId, async (tx) => {
      // Get the group
      const group = await tx.group.findFirst({
        where: {
          id: groupId,
          organizationId: session.organizationId,
        },
      });

      if (!group) {
        throw new NotFoundError('Group not found');
      }

      // Get membership
      const membership = await tx.groupMembership.findFirst({
        where: { groupId, userId },
        include: {
          user: true,
        },
      });

      if (!membership) {
        throw new NotFoundError('User is not a member of this group');
      }

      // Remove membership
      await tx.groupMembership.delete({
        where: { id: membership.id },
      });

      return { group, membership };
    });

    // Emit event (EventBus wraps in RLS context internally)
    await eventBus.emit('PERMISSION_REVOKED', {
      description: `Removed ${membership.user.email} from group: ${group.name}`,
      metadata: {
        groupId,
        groupName: group.name,
        userId,
        userEmail: membership.user.email,
        action: 'member_removed',
      },
    });
  }

  /**
   * List members of a group
   * @readonly
   */
  async listMembers(
    ctx: ServiceContext,
    groupId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<GroupMemberInfo>> {
    const { session } = ctx;
    const { offset = 0, limit = 50 } = options;

    // Use RLS context for all org-scoped operations
    const { total, memberships } = await withOrgContext(session.organizationId, async (tx) => {
      // Get the group
      const group = await tx.group.findFirst({
        where: {
          id: groupId,
          organizationId: session.organizationId,
        },
      });

      if (!group) {
        throw new NotFoundError('Group not found');
      }

      // Get total count
      const total = await tx.groupMembership.count({
        where: { groupId },
      });

      // Get memberships with user info
      const memberships = await tx.groupMembership.findMany({
        where: { groupId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: offset,
        take: limit,
      });

      return { total, memberships };
    });

    const items: GroupMemberInfo[] = memberships.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      joinedAt: m.createdAt,
    }));

    return {
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * Get groups a user belongs to
   * @readonly
   */
  async getUserGroups(ctx: ServiceContext, userId: string): Promise<Group[]> {
    const { session } = ctx;

    // Use RLS context for org-scoped query
    const memberships = await withOrgContext(session.organizationId, async (tx) => {
      return tx.groupMembership.findMany({
        where: {
          userId,
          group: {
            organizationId: session.organizationId,
          },
        },
        include: {
          group: true,
        },
      });
    });

    return memberships.map((m) => m.group);
  }
}

// Export singleton instance
export const groupService = new GroupService();
