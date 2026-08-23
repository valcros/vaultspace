/**
 * Room Service
 *
 * Handles room lifecycle: creation, status changes, archival.
 * All mutations emit events for audit trail.
 */

import type { Prisma, Room, RoomStatus } from '@prisma/client';

import { withOrgContext } from '@/lib/db';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
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
  description?: string | null;
  status?: RoomStatus;
  allowDownloads?: boolean;
  allowViewerVersionHistory?: boolean;
  defaultExpiryDays?: number | null;
  requiresPassword?: boolean;
  requiresEmailVerification?: boolean;
  enableWatermark?: boolean;
  watermarkTemplate?: string | null;
  requiresNda?: boolean;
  ndaContent?: string | null;
  allDocumentsConfidential?: boolean;
  brandColor?: string | null;
  brandLogoUrl?: string | null;
  ipAllowlist?: string[];
  /** Internal-only input set by the settings route after hashing a new password. */
  passwordHash?: string | null;
}

export type RoomWithoutPassword = Omit<Room, 'passwordHash'>;

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
export type RoomWithStats = Omit<Room, 'passwordHash'> & {
  _count: {
    documents: number;
    folders: number;
    links: number;
    permissions: number;
  };
};

const ROOM_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  _count: {
    select: {
      documents: true,
      folders: true,
    },
  },
} satisfies Prisma.RoomSelect;

export type RoomListItem = Prisma.RoomGetPayload<{ select: typeof ROOM_LIST_SELECT }>;

/**
 * The canonical room lifecycle. All status mutations must flow through
 * RoomService.changeStatus so authorization, timestamps, and audit evidence
 * cannot diverge between API surfaces.
 */
export const ROOM_STATUS_TRANSITIONS: Readonly<Record<RoomStatus, readonly RoomStatus[]>> = {
  DRAFT: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['ARCHIVED', 'CLOSED'],
  ARCHIVED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
};

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
              permissions: true,
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
        { userId: session.userId },
        'view',
        { type: 'ROOM', organizationId: session.organizationId, roomId },
        tx
      );

      if (!canView) {
        return null;
      }

      // Draft, archived, and closed rooms are administrative workspaces. An
      // ordinary Viewer must not be able to bypass lifecycle discovery rules by
      // navigating directly to a known room URL. Room-scoped administrators
      // retain setup and retention access, while publishing itself remains an
      // organization-admin operation in changeStatus().
      if (room.status !== 'ACTIVE') {
        const canManage = await permissionEngine.can(
          { userId: session.userId, role: session.organization.role },
          'admin',
          { type: 'ROOM', organizationId: session.organizationId, roomId },
          tx
        );
        if (!canManage) {
          return null;
        }
      }

      const { passwordHash: _passwordHash, ...safeRoom } = room;
      return safeRoom;
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
              permissions: true,
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
        { userId: session.userId },
        'view',
        { type: 'ROOM', organizationId: session.organizationId, roomId: room.id },
        tx
      );

      if (!canView) {
        return null;
      }

      if (room.status !== 'ACTIVE') {
        const canManage = await permissionEngine.can(
          { userId: session.userId, role: session.organization.role },
          'admin',
          { type: 'ROOM', organizationId: session.organizationId, roomId: room.id },
          tx
        );
        if (!canManage) {
          return null;
        }
      }

      const { passwordHash: _passwordHash, ...safeRoom } = room;
      return safeRoom;
    });
  }

  /**
   * List rooms in the organization
   * @readonly
   */
  async list(
    ctx: ServiceContext,
    options: RoomListOptions = {}
  ): Promise<PaginatedResult<RoomListItem>> {
    const { session } = ctx;
    const { status, search, offset = 0, limit = 50 } = options;

    // Use RLS context for org-scoped queries
    const { total, rooms } = await withOrgContext(session.organizationId, async (tx) => {
      const permissionEngine = getPermissionEngine();
      const viewableRoomIds = await permissionEngine.getViewableRoomIds(
        { userId: session.userId },
        session.organizationId,
        tx
      );
      const isOrganizationAdmin = viewableRoomIds === null;
      const where: Prisma.RoomWhereInput = {
        organizationId: session.organizationId,
        ...(isOrganizationAdmin
          ? status && { status }
          : { id: { in: [...viewableRoomIds] }, status: 'ACTIVE' }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }),
      };

      const [total, rooms] = await Promise.all([
        tx.room.count({ where }),
        tx.room.findMany({
          where,
          select: ROOM_LIST_SELECT,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: offset,
          take: limit,
        }),
      ]);

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
  async update(
    ctx: ServiceContext,
    roomId: string,
    options: UpdateRoomOptions
  ): Promise<RoomWithoutPassword> {
    const { session, eventBus } = ctx;

    if (options.status !== undefined && session.organization.role !== 'ADMIN') {
      throw new AuthorizationError(
        'Organization administrator access is required to change room status'
      );
    }

    // Use RLS context for all org-scoped operations
    return withOrgContext(session.organizationId, async (tx) => {
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
        throw new AuthorizationError('You do not have permission to update this room');
      }

      const { status, passwordHash, ...settings } = options;

      // Build settings update data. Status is intentionally handled below so
      // lifecycle validation completes before any write is issued.
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

      if (options.allowDownloads !== undefined) {
        data.allowDownloads = options.allowDownloads;
      }
      if (options.allowViewerVersionHistory !== undefined) {
        data.allowViewerVersionHistory = options.allowViewerVersionHistory;
      }
      if (options.defaultExpiryDays !== undefined) {
        data.defaultExpiryDays = options.defaultExpiryDays;
      }
      if (options.requiresPassword !== undefined) {
        data.requiresPassword = options.requiresPassword;
      }
      if (options.requiresEmailVerification !== undefined) {
        data.requiresEmailVerification = options.requiresEmailVerification;
      }
      if (options.enableWatermark !== undefined) {
        data.enableWatermark = options.enableWatermark;
      }
      if (options.watermarkTemplate !== undefined) {
        data.watermarkTemplate = options.watermarkTemplate?.trim() || null;
      }
      if (options.requiresNda !== undefined) {
        data.requiresNda = options.requiresNda;
      }
      if (options.ndaContent !== undefined) {
        data.ndaContent = options.ndaContent?.trim() || null;
      }
      if (options.allDocumentsConfidential !== undefined) {
        data.allDocumentsConfidential = options.allDocumentsConfidential;
      }
      if (options.brandColor !== undefined) {
        data.brandColor = options.brandColor;
      }
      if (options.brandLogoUrl !== undefined) {
        data.brandLogoUrl = options.brandLogoUrl?.trim() || null;
      }
      if (options.ipAllowlist !== undefined) {
        data.ipAllowlist = options.ipAllowlist;
      }
      if (passwordHash !== undefined) {
        data.passwordHash = passwordHash;
      }

      const previousStatus = room.status;
      const statusChanged = status !== undefined && status !== previousStatus;
      if (statusChanged) {
        const allowed = ROOM_STATUS_TRANSITIONS[previousStatus] ?? [];
        if (!allowed.includes(status)) {
          throw new ValidationError(`Cannot transition from ${previousStatus} to ${status}`);
        }

        const transitionAt = new Date();
        data.status = status;
        if (status === 'ARCHIVED') {
          data.archivedAt = transitionAt;
        }
        if (previousStatus === 'ARCHIVED' && status === 'ACTIVE') {
          data.archivedAt = null;
        }
        if (status === 'CLOSED') {
          data.closedAt = transitionAt;
        }
      }

      const hasSettingsChange = Object.keys(settings).length > 0 || passwordHash !== undefined;
      if (!hasSettingsChange && !statusChanged) {
        const { passwordHash: _passwordHash, ...safeRoom } = room;
        return safeRoom;
      }

      // Settings, lifecycle state, timestamps, and all audit records are
      // committed in the same tenant-scoped transaction.
      const updated = await tx.room.update({ where: { id: roomId }, data });

      if (hasSettingsChange) {
        await eventBus.emit(
          'ROOM_UPDATED',
          {
            roomId,
            description: `Updated room: ${updated.name}`,
            metadata: { changes: settings },
          },
          tx
        );
      }

      if (statusChanged) {
        const eventType =
          status === 'ARCHIVED'
            ? 'ROOM_ARCHIVED'
            : status === 'CLOSED'
              ? 'ROOM_CLOSED'
              : 'ROOM_STATUS_CHANGED';
        await eventBus.emit(
          eventType,
          {
            roomId,
            description: `Room status changed from ${previousStatus} to ${status}`,
            metadata: { previousStatus, newStatus: status },
          },
          tx
        );
      }

      const { passwordHash: _passwordHash, ...safeRoom } = updated;
      return safeRoom;
    });
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
  async changeStatus(
    ctx: ServiceContext,
    roomId: string,
    status: RoomStatus
  ): Promise<RoomWithoutPassword> {
    return this.update(ctx, roomId, { status });
  }

  /**
   * Close and retain a room through the canonical lifecycle transition.
   * @mutating
   */
  async delete(ctx: ServiceContext, roomId: string): Promise<RoomWithoutPassword> {
    return this.changeStatus(ctx, roomId, 'CLOSED');
  }
}

// Export singleton instance
export const roomService = new RoomService();
