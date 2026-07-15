/**
 * Room Service
 *
 * Handles room lifecycle: creation, status changes, archival.
 * All mutations emit events for audit trail.
 */

import type { Prisma, Room, RoomStatus } from '@prisma/client';

import { withOrgContext } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { getPermissionEngine } from '@/lib/permissions';

import type { PaginatedResult, PaginationOptions, ServiceContext } from './types';

/**
 * Room creation options
 */
export interface CreateRoomOptions {
  name: string;
  description?: string;
  status?: RoomStatus;
}

/**
 * Room update options
 */
export interface UpdateRoomOptions {
  name?: string;
  description?: string;
}

/**
 * Room list filters
 */
export interface RoomListOptions extends PaginationOptions {
  status?: RoomStatus;
  search?: string;
}

/**
 * Room with statistics
 */
export interface RoomWithStats extends Room {
  _count: {
    documents: number;
    folders: number;
    links: number;
  };
}

/**
 * Generate URL-safe slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

export class RoomService {
  /**
   * Create a new room
   * @mutating
   */
  async create(ctx: ServiceContext, options: CreateRoomOptions): Promise<Room> {
    const { session, eventBus } = ctx;
    const organizationId = session.organizationId;

    // Validate name
    if (!options.name || options.name.trim().length === 0) {
      throw new ValidationError('Room name is required');
    }

    if (options.name.length > 255) {
      throw new ValidationError('Room name must be 255 characters or less');
    }

    // Use RLS context for all org-scoped operations
    const room = await withOrgContext(organizationId, async (tx) => {
      // Generate slug
      let slug = generateSlug(options.name);
      let suffix = 0;

      // Ensure unique slug within organization
      while (true) {
        const existing = await tx.room.findFirst({
          where: { organizationId, slug },
        });

        if (!existing) {
          break;
        }

        suffix++;
        slug = `${generateSlug(options.name)}-${suffix}`;
      }

      // Create room
      return tx.room.create({
        data: {
          organizationId,
          name: options.name.trim(),
          slug,
          description: options.description?.trim(),
          status: options.status ?? 'DRAFT',
          createdByUserId: session.userId,
        },
      });
    });

    // Emit event (EventBus wraps in RLS context internally)
    await eventBus.emit('ROOM_CREATED', {
      roomId: room.id,
      description: `Created room: ${room.name}`,
      metadata: {
        name: room.name,
        slug: room.slug,
        status: room.status,
      },
    });

    return room;
  }

  /**
   * Get a room by ID
   * @readonly
   */
  async getById(ctx: ServiceContext, roomId: string): Promise<RoomWithStats | null> {
    const { session } = ctx;

    // Use RLS context for org-scoped query and permission check
    return withOrgContext(session.organizationId, async (tx) => {
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
        include: {
          _count: {
            select: {
              documents: true,
              folders: true,
              links: true,
            },
          },
        },
      });

      if (!room) {
        return null;
      }

      // Check permissions (pass transaction for RLS context)
      const permissionEngine = getPermissionEngine();
      const canView = await permissionEngine.can(
        { userId: session.userId, role: session.organization.role },
        'view',
        { type: 'ROOM', organizationId: session.organizationId, roomId },
        tx
      );

      if (!canView) {
        return null;
      }

      return room;
    });
  }

  /**
   * Get a room by slug
   * @readonly
   */
  async getBySlug(ctx: ServiceContext, slug: string): Promise<RoomWithStats | null> {
    const { session } = ctx;

    // Use RLS context for org-scoped query and permission check
    return withOrgContext(session.organizationId, async (tx) => {
      const room = await tx.room.findFirst({
        where: {
          slug,
          organizationId: session.organizationId,
        },
        include: {
          _count: {
            select: {
              documents: true,
              folders: true,
              links: true,
            },
          },
        },
      });

      if (!room) {
        return null;
      }

      // Check permissions (pass transaction for RLS context)
      const permissionEngine = getPermissionEngine();
      const canView = await permissionEngine.can(
        { userId: session.userId, role: session.organization.role },
        'view',
        { type: 'ROOM', organizationId: session.organizationId, roomId: room.id },
        tx
      );

      if (!canView) {
        return null;
      }

      return room;
    });
  }

  /**
   * List rooms in the organization
   * @readonly
   */
  async list(
    ctx: ServiceContext,
    options: RoomListOptions = {}
  ): Promise<PaginatedResult<RoomWithStats>> {
    const { session } = ctx;
    const { status, search, offset = 0, limit = 50 } = options;

    // Build where clause
    const where: Prisma.RoomWhereInput = {
      organizationId: session.organizationId,
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    // Use RLS context for org-scoped queries
    const { total, rooms } = await withOrgContext(session.organizationId, async (tx) => {
      const total = await tx.room.count({ where });

      const rooms = await tx.room.findMany({
        where,
        include: {
          _count: {
            select: {
              documents: true,
              folders: true,
              links: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      });

      return { total, rooms };
    });

    return {
      items: rooms,
      total,
      offset,
      limit,
      hasMore: offset + rooms.length < total,
    };
  }

  /**
   * Update a room
   * @mutating
   */
  async update(ctx: ServiceContext, roomId: string, options: UpdateRoomOptions): Promise<Room> {
    const { session, eventBus } = ctx;

    // Use RLS context for all org-scoped operations
    const updated = await withOrgContext(session.organizationId, async (tx) => {
      // Get the room
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        throw new NotFoundError('Room not found');
      }

      // Check permissions (pass transaction for RLS context)
      const permissionEngine = getPermissionEngine();
      const canAdmin = await permissionEngine.can(
        { userId: session.userId, role: session.organization.role },
        'admin',
        { type: 'ROOM', organizationId: session.organizationId, roomId },
        tx
      );

      if (!canAdmin) {
        throw new ConflictError('You do not have permission to update this room');
      }

      // Build update data
      const data: Prisma.RoomUpdateInput = {};

      if (options.name !== undefined) {
        if (!options.name.trim()) {
          throw new ValidationError('Room name cannot be empty');
        }
        data.name = options.name.trim();
      }

      if (options.description !== undefined) {
        data.description = options.description?.trim() || null;
      }

      // Update room
      return tx.room.update({
        where: { id: roomId },
        data,
      });
    });

    // Emit event (EventBus wraps in RLS context internally)
    await eventBus.emit('ROOM_UPDATED', {
      roomId,
      description: `Updated room: ${updated.name}`,
      metadata: {
        changes: options,
      },
    });

    return updated;
  }

  /**
   * Enable accession numbering for a room and optionally backfill existing
   * documents with immutable citation IDs in curated display order.
   *
   * Idempotent: documents that already have an accession number are skipped, and
   * the room counter only ever moves forward, so a number is never reused.
   * @mutating
   */
  async enableAccessionNumbering(
    ctx: ServiceContext,
    roomId: string,
    options: { prefix?: string; backfill?: boolean }
  ): Promise<{ prefix: string; assigned: number; lastAccessionSeq: number }> {
    const { session, eventBus } = ctx;

    const result = await withOrgContext(
      session.organizationId,
      async (tx) => {
        const room = await tx.room.findFirst({
          where: { id: roomId, organizationId: session.organizationId },
        });

        if (!room) {
          throw new NotFoundError('Room not found');
        }

        const permissionEngine = getPermissionEngine();
        const canAdmin = await permissionEngine.can(
          { userId: session.userId, role: session.organization.role },
          'admin',
          { type: 'ROOM', organizationId: session.organizationId, roomId },
          tx
        );

        if (!canAdmin) {
          throw new ConflictError('You do not have permission to update this room');
        }

        const prefix = (options.prefix?.trim() || room.accessionPrefix || 'DOC').toUpperCase();
        if (!/^[A-Z0-9]{1,16}$/.test(prefix)) {
          throw new ValidationError('Accession prefix must be 1-16 letters or digits');
        }

        let lastAccessionSeq = room.lastAccessionSeq;
        let assigned = 0;

        if (options.backfill) {
          // Only number documents that do not already have one.
          const docs = await tx.document.findMany({
            where: {
              roomId,
              organizationId: session.organizationId,
              status: 'ACTIVE',
              accessionNumber: null,
            },
            select: { id: true, name: true, folder: { select: { path: true } } },
          });

          // Curated reading order: by folder path, then by document name. The
          // number prefixes in both sort strings mirror the browse order.
          docs.sort((a, b) => {
            const pa = a.folder?.path ?? '';
            const pb = b.folder?.path ?? '';
            if (pa !== pb) {
              return pa < pb ? -1 : 1;
            }
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
          });

          for (const doc of docs) {
            lastAccessionSeq += 1;
            const accessionNumber = `${prefix}-${String(lastAccessionSeq).padStart(4, '0')}`;
            await tx.document.update({
              where: { id: doc.id },
              data: { accessionNumber, accessionSeq: lastAccessionSeq },
            });
            assigned += 1;
          }
        }

        await tx.room.update({
          where: { id: roomId },
          data: {
            accessionNumberingEnabled: true,
            accessionPrefix: prefix,
            lastAccessionSeq,
          },
        });

        return { prefix, assigned, lastAccessionSeq };
      },
      // Backfilling a large room performs many row updates in one transaction.
      { timeout: 30_000, maxWait: 10_000 }
    );

    await eventBus.emit('ROOM_UPDATED', {
      roomId,
      description:
        `Enabled accession numbering (prefix ${result.prefix})` +
        (result.assigned ? `, backfilled ${result.assigned} documents` : ''),
      metadata: {
        accessionNumbering: true,
        prefix: result.prefix,
        backfilled: result.assigned,
      },
    });

    return result;
  }

  /**
   * Change room status
   * @mutating
   */
  async changeStatus(ctx: ServiceContext, roomId: string, status: RoomStatus): Promise<Room> {
    const { session, eventBus } = ctx;

    // Use RLS context for all org-scoped operations
    const { updated, previousStatus } = await withOrgContext(session.organizationId, async (tx) => {
      // Get the room
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        throw new NotFoundError('Room not found');
      }

      // Check permissions (pass transaction for RLS context)
      const permissionEngine = getPermissionEngine();
      const canAdmin = await permissionEngine.can(
        { userId: session.userId, role: session.organization.role },
        'admin',
        { type: 'ROOM', organizationId: session.organizationId, roomId },
        tx
      );

      if (!canAdmin) {
        throw new ConflictError('You do not have permission to change room status');
      }

      const previousStatus = room.status;

      // Update status
      const updated = await tx.room.update({
        where: { id: roomId },
        data: { status },
      });

      return { updated, previousStatus };
    });

    // Emit appropriate event (EventBus wraps in RLS context internally)
    const eventType =
      status === 'ARCHIVED'
        ? 'ROOM_ARCHIVED'
        : status === 'CLOSED'
          ? 'ROOM_CLOSED'
          : 'ROOM_STATUS_CHANGED';

    await eventBus.emit(eventType, {
      roomId,
      description: `Room status changed from ${previousStatus} to ${status}`,
      metadata: {
        previousStatus,
        newStatus: status,
      },
    });

    return updated;
  }

  /**
   * Delete a room (soft delete by setting status to CLOSED and archiving)
   * @mutating
   */
  async delete(ctx: ServiceContext, roomId: string): Promise<Room> {
    const { session, eventBus } = ctx;

    // Only org admins can delete rooms
    if (session.organization.role !== 'ADMIN') {
      throw new ConflictError('Only organization admins can delete rooms');
    }

    // Use RLS context for all org-scoped operations
    const { room, updated } = await withOrgContext(session.organizationId, async (tx) => {
      // Get the room
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        throw new NotFoundError('Room not found');
      }

      // Update to CLOSED status
      const updated = await tx.room.update({
        where: { id: roomId },
        data: { status: 'CLOSED' },
      });

      return { room, updated };
    });

    // Emit event (EventBus wraps in RLS context internally)
    await eventBus.emit('ROOM_DELETED', {
      roomId,
      description: `Deleted room: ${room.name}`,
    });

    return updated;
  }
}

// Export singleton instance
export const roomService = new RoomService();
