/**
 * Organization member room-access API.
 *
 * GET   /api/users/:userId/room-access - inspect direct room grants
 * PATCH /api/users/:userId/room-access - atomically reconcile direct room grants
 *
 * This is deliberately separate from the user-profile PATCH route. Room access
 * is organization-scoped authorization state, while a profile may be shared by
 * the same person across organizations.
 */

import { NextRequest, NextResponse } from 'next/server';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { lockUserAccessMutation } from '@/lib/permissions/userAccessMutationLock';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

type DirectPermission = {
  id: string;
  roomId: string | null;
  folderId?: string | null;
  documentId?: string | null;
  resourceType: 'ROOM' | 'FOLDER' | 'DOCUMENT';
  permissionLevel: 'NONE' | 'VIEW' | 'DOWNLOAD' | 'ADMIN';
  expiresAt: Date | null;
};

type ScopedDirectPermission = DirectPermission & {
  folder: { roomId: string } | null;
  document: { roomId: string } | null;
};

const PERMISSION_RANK = { NONE: 0, VIEW: 1, DOWNLOAD: 2, ADMIN: 3 } as const;

function strongestCurrentAllow(
  permissions: DirectPermission[],
  roomId: string,
  now: Date
): 'VIEW' | 'DOWNLOAD' | 'ADMIN' | null {
  const currentAllows = permissions.filter(
    (
      permission
    ): permission is DirectPermission & { permissionLevel: 'VIEW' | 'DOWNLOAD' | 'ADMIN' } =>
      permission.roomId === roomId &&
      permission.permissionLevel !== 'NONE' &&
      (permission.expiresAt === null || permission.expiresAt > now)
  );
  return currentAllows.reduce<'VIEW' | 'DOWNLOAD' | 'ADMIN' | null>((strongest, permission) => {
    if (!strongest || PERMISSION_RANK[permission.permissionLevel] > PERMISSION_RANK[strongest]) {
      return permission.permissionLevel;
    }
    return strongest;
  }, null);
}

function hasCurrentRoomGrant(permission: DirectPermission, now: Date) {
  return (
    permission.resourceType === 'ROOM' &&
    permission.permissionLevel !== 'NONE' &&
    (permission.expiresAt === null || permission.expiresAt > now)
  );
}

function hasCurrentAllow(permission: DirectPermission, now: Date) {
  return (
    permission.permissionLevel !== 'NONE' &&
    (permission.expiresAt === null || permission.expiresAt > now)
  );
}

function normalizeRoomIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
    return null;
  }

  const roomIds = [...new Set(value.map((id) => id.trim()).filter(Boolean))];
  return roomIds.length <= 100 ? roomIds : null;
}

type AdminAuthorization =
  | { ok: true; session: Awaited<ReturnType<typeof requireAuth>> }
  | { ok: false; response: NextResponse };

async function requireAdmin(): Promise<AdminAuthorization> {
  const session = await requireAuth();
  if (session.organization.role !== 'ADMIN') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }),
    };
  }
  return { ok: true, session };
}

/**
 * Return active rooms and the member's direct grants. The endpoint labels these
 * grants as direct because group grants and room-admin assignments are separate
 * authorization paths and must never be silently represented as editable here.
 */
export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const authorization = await requireAdmin();
    if (!authorization.ok) {
      return authorization.response;
    }
    const { session } = authorization;
    const { userId } = await context.params;
    const now = new Date();

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const member = await tx.userOrganization.findFirst({
        where: { organizationId: session.organizationId, userId },
        include: {
          user: { select: { id: true, email: true, isActive: true } },
        },
      });
      if (!member) {
        return { error: 'User not found in organization', status: 404 } as const;
      }
      if (!member.isActive || !member.user.isActive) {
        return {
          error: 'Archived or inactive members do not have editable room access',
          status: 409,
        } as const;
      }

      const rooms = await tx.room.findMany({
        where: { organizationId: session.organizationId, status: 'ACTIVE' },
        select: { id: true, name: true, description: true },
        orderBy: { name: 'asc' },
      });
      const roomIds = rooms.map((room) => room.id);
      const permissions = (await tx.permission.findMany({
        where: {
          organizationId: session.organizationId,
          userId,
          granteeType: 'USER',
          resourceType: 'ROOM',
          roomId: { in: roomIds },
          isActive: true,
        },
        select: {
          id: true,
          roomId: true,
          resourceType: true,
          permissionLevel: true,
          expiresAt: true,
        },
      })) as DirectPermission[];
      const scopedPermissions = (await tx.permission.findMany({
        where: {
          organizationId: session.organizationId,
          userId,
          granteeType: 'USER',
          resourceType: { in: ['FOLDER', 'DOCUMENT'] },
          isActive: true,
        },
        select: {
          id: true,
          roomId: true,
          resourceType: true,
          permissionLevel: true,
          expiresAt: true,
          folder: { select: { roomId: true } },
          document: { select: { roomId: true } },
        },
      })) as ScopedDirectPermission[];

      const [roomAdminAssignments, groupMemberships] = await Promise.all([
        tx.roleAssignment.findMany({
          where: {
            organizationId: session.organizationId,
            userId,
            scopeType: 'ROOM',
            role: 'ADMIN',
            roomId: { in: roomIds },
          },
          select: { roomId: true },
        }),
        tx.groupMembership.findMany({
          where: {
            userId,
            group: { organizationId: session.organizationId, isActive: true },
          },
          select: { groupId: true },
        }),
      ]);
      const groupIds = groupMemberships.map((membership) => membership.groupId);
      const groupPermissions =
        groupIds.length > 0
          ? ((await tx.permission.findMany({
              where: {
                organizationId: session.organizationId,
                groupId: { in: groupIds },
                granteeType: 'GROUP',
                resourceType: 'ROOM',
                roomId: { in: roomIds },
                isActive: true,
              },
              select: {
                id: true,
                roomId: true,
                resourceType: true,
                permissionLevel: true,
                expiresAt: true,
              },
            })) as DirectPermission[])
          : [];
      const groupScopedPermissions =
        groupIds.length > 0
          ? ((await tx.permission.findMany({
              where: {
                organizationId: session.organizationId,
                groupId: { in: groupIds },
                granteeType: 'GROUP',
                resourceType: { in: ['FOLDER', 'DOCUMENT'] },
                isActive: true,
              },
              select: {
                id: true,
                roomId: true,
                resourceType: true,
                permissionLevel: true,
                expiresAt: true,
                folder: { select: { roomId: true } },
                document: { select: { roomId: true } },
              },
            })) as ScopedDirectPermission[])
          : [];

      const currentRoomIds = new Set(
        permissions
          .filter((permission) => hasCurrentRoomGrant(permission, now))
          .flatMap((permission) => (permission.roomId ? [permission.roomId] : []))
      );
      const currentPermissions = permissions.filter(
        (permission) => permission.expiresAt === null || permission.expiresAt > now
      );
      const directDenyRoomIds = new Set(
        currentPermissions
          .filter((permission) => permission.permissionLevel === 'NONE')
          .flatMap((permission) => (permission.roomId ? [permission.roomId] : []))
      );
      const roomAdminIds = new Set(
        roomAdminAssignments.flatMap((assignment) => (assignment.roomId ? [assignment.roomId] : []))
      );
      const groupAccessRoomIds = new Set(
        groupPermissions
          .filter((permission) => hasCurrentRoomGrant(permission, now))
          .flatMap((permission) => (permission.roomId ? [permission.roomId] : []))
      );
      const currentGroupPermissions = groupPermissions.filter(
        (permission) => permission.expiresAt === null || permission.expiresAt > now
      );
      const groupDenyRoomIds = new Set(
        currentGroupPermissions
          .filter((permission) => permission.permissionLevel === 'NONE')
          .flatMap((permission) => (permission.roomId ? [permission.roomId] : []))
      );
      const scopedCountByRoomId = new Map<string, number>();
      for (const permission of scopedPermissions) {
        const roomId =
          permission.roomId ?? permission.folder?.roomId ?? permission.document?.roomId;
        if (!roomId || !hasCurrentAllow(permission, now)) {
          continue;
        }
        scopedCountByRoomId.set(roomId, (scopedCountByRoomId.get(roomId) ?? 0) + 1);
      }
      const groupScopedCountByRoomId = new Map<string, number>();
      for (const permission of groupScopedPermissions) {
        const roomId =
          permission.roomId ?? permission.folder?.roomId ?? permission.document?.roomId;
        if (!roomId || !hasCurrentAllow(permission, now) || !roomIds.includes(roomId)) {
          continue;
        }
        groupScopedCountByRoomId.set(roomId, (groupScopedCountByRoomId.get(roomId) ?? 0) + 1);
      }

      return {
        member: {
          id: member.user.id,
          email: member.user.email,
          role: member.role,
          isActive: member.isActive && member.user.isActive,
        },
        rooms: rooms.map((room) => ({
          ...room,
          hasDirectAccess: currentRoomIds.has(room.id),
          directRoomGrantLevel: strongestCurrentAllow(permissions, room.id, now),
          directScopedGrantCount: scopedCountByRoomId.get(room.id) ?? 0,
          indirectScopedGrantCount: groupScopedCountByRoomId.get(room.id) ?? 0,
          indirectScopedSources:
            (groupScopedCountByRoomId.get(room.id) ?? 0) > 0 ? (['GROUP'] as const) : [],
          indirectAllowSources: [
            ...(roomAdminIds.has(room.id) ? (['ROOM_ADMIN'] as const) : []),
            ...(groupAccessRoomIds.has(room.id) ? (['GROUP'] as const) : []),
          ],
          indirectDenySources: [
            ...(directDenyRoomIds.has(room.id) ? (['DIRECT'] as const) : []),
            ...(groupDenyRoomIds.has(room.id) ? (['GROUP'] as const) : []),
          ],
          effectiveAccess: roomAdminIds.has(room.id)
            ? 'ADMIN'
            : directDenyRoomIds.has(room.id) || groupDenyRoomIds.has(room.id)
              ? 'NONE'
              : (() => {
                  const directLevel = strongestCurrentAllow(permissions, room.id, now);
                  const groupLevel = strongestCurrentAllow(groupPermissions, room.id, now);
                  if (
                    directLevel &&
                    (!groupLevel || PERMISSION_RANK[directLevel] >= PERMISSION_RANK[groupLevel])
                  ) {
                    return directLevel;
                  }
                  if (groupLevel) {
                    return groupLevel;
                  }
                  return (scopedCountByRoomId.get(room.id) ?? 0) > 0 ||
                    (groupScopedCountByRoomId.get(room.id) ?? 0) > 0
                    ? 'SCOPED'
                    : 'NONE';
                })(),
        })),
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      member: result.member,
      rooms: result.rooms,
      editable: result.member.isActive && result.member.role === 'VIEWER',
      restriction:
        result.member.role === 'ADMIN'
          ? 'Organization administrators already have access to every room.'
          : result.member.isActive
            ? null
            : 'Archived or inactive members cannot be assigned room access.',
    });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[UserRoomAccessAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get room access' }, { status: 500 });
  }
}

/**
 * Replace a Viewer member's direct active-room grants as one transaction.
 * Removing a room also revokes direct folder/document grants in that room so a
 * room removal cannot leave a narrower direct grant behind as an access path.
 */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const authorization = await requireAdmin();
    if (!authorization.ok) {
      return authorization.response;
    }
    const { session } = authorization;
    const { userId } = await context.params;
    const body = await request.json();
    const roomIds = normalizeRoomIds(body?.roomIds);
    if (!roomIds) {
      return NextResponse.json(
        { error: 'roomIds must be an array of at most 100 room IDs' },
        { status: 400 }
      );
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      await lockUserAccessMutation(tx, session.organizationId, userId);
      // Serialize edits to this membership and all of its direct permission
      // rows. This avoids concurrent editors producing a partial reconciliation.
      await tx.$queryRaw`
        SELECT 1 FROM user_organizations
        WHERE "organizationId" = ${session.organizationId} AND "userId" = ${userId}
        FOR UPDATE`;
      await tx.$queryRaw`
        SELECT 1 FROM permissions
        WHERE "organizationId" = ${session.organizationId}
          AND "userId" = ${userId}
          AND "granteeType" = 'USER'
        FOR UPDATE`;

      const member = await tx.userOrganization.findFirst({
        where: { organizationId: session.organizationId, userId },
        include: { user: { select: { email: true, isActive: true } } },
      });
      if (!member) {
        return { error: 'User not found in organization', status: 404 } as const;
      }
      if (!member.isActive || !member.user.isActive) {
        return {
          error: 'Archived or inactive members cannot be assigned room access',
          status: 409,
        } as const;
      }
      if (member.role === 'ADMIN') {
        return {
          error: 'Organization administrators already have access to every room',
          status: 409,
        } as const;
      }

      const organizationRooms = await tx.room.findMany({
        where: { organizationId: session.organizationId },
        select: { id: true, name: true, status: true },
      });
      const activeRooms = organizationRooms.filter((room) => room.status === 'ACTIVE');
      const activeRoomIds = new Set(activeRooms.map((room) => room.id));
      if (roomIds.some((roomId) => !activeRoomIds.has(roomId))) {
        return {
          error: 'Every assigned room must be active and belong to this organization',
          status: 400,
        } as const;
      }

      const directPermissions = (await tx.permission.findMany({
        where: {
          organizationId: session.organizationId,
          userId,
          granteeType: 'USER',
          resourceType: 'ROOM',
          roomId: { not: null },
          isActive: true,
        },
        select: {
          id: true,
          roomId: true,
          resourceType: true,
          permissionLevel: true,
          expiresAt: true,
        },
      })) as DirectPermission[];

      const desiredRoomIds = new Set(roomIds);
      // A standalone narrow folder/document grant is not part of this room-level
      // editor. Descendants are revoked only when an existing direct ROOM grant
      // for that same room is explicitly deselected. This avoids treating every
      // unchecked room as permission to delete unrelated scoped access.
      const removedRoomIds = [
        ...new Set(
          directPermissions.flatMap((permission) =>
            permission.roomId && !desiredRoomIds.has(permission.roomId) ? [permission.roomId] : []
          )
        ),
      ];
      const [removedRoomFolders, removedRoomDocuments] = await Promise.all([
        tx.folder.findMany({
          where: { organizationId: session.organizationId, roomId: { in: removedRoomIds } },
          select: { id: true, roomId: true },
        }),
        tx.document.findMany({
          where: { organizationId: session.organizationId, roomId: { in: removedRoomIds } },
          select: { id: true, roomId: true },
        }),
      ]);
      const removedFolderIds = removedRoomFolders.map((folder) => folder.id);
      const removedDocumentIds = removedRoomDocuments.map((document) => document.id);
      const removedDescendantPermissions = (await tx.permission.findMany({
        where: {
          organizationId: session.organizationId,
          userId,
          granteeType: 'USER',
          isActive: true,
          OR: [
            { resourceType: 'FOLDER', folderId: { in: removedFolderIds } },
            { resourceType: 'DOCUMENT', documentId: { in: removedDocumentIds } },
          ],
        },
        select: {
          id: true,
          roomId: true,
          folderId: true,
          documentId: true,
          resourceType: true,
          permissionLevel: true,
          expiresAt: true,
        },
      })) as DirectPermission[];
      const now = new Date();
      const grantedRoomIds = new Set(
        directPermissions
          .filter((permission) => hasCurrentRoomGrant(permission, now))
          .flatMap((permission) => (permission.roomId ? [permission.roomId] : []))
      );
      const roomIdsToGrant = roomIds.filter((roomId) => !grantedRoomIds.has(roomId));
      const permissionIdsToRevoke = directPermissions
        .filter((permission) => permission.roomId && !desiredRoomIds.has(permission.roomId))
        .map((permission) => permission.id)
        .concat(removedDescendantPermissions.map((permission) => permission.id));
      // An active expired grant or explicit NONE record must not coexist with a
      // newly selected allow grant. Preserve the historical record, but retire
      // it before inserting the fresh direct VIEW grant.
      const permissionIdsToRetireBeforeGrant = directPermissions
        .filter(
          (permission) =>
            permission.roomId &&
            desiredRoomIds.has(permission.roomId) &&
            permission.resourceType === 'ROOM' &&
            !hasCurrentRoomGrant(permission, now)
        )
        .map((permission) => permission.id);

      const permissionIdsToDeactivate = [
        ...new Set([...permissionIdsToRevoke, ...permissionIdsToRetireBeforeGrant]),
      ];
      if (permissionIdsToDeactivate.length > 0) {
        await tx.permission.updateMany({
          where: { id: { in: permissionIdsToDeactivate } },
          data: { isActive: false },
        });
      }
      if (roomIdsToGrant.length > 0) {
        await tx.permission.createMany({
          data: roomIdsToGrant.map((roomId) => ({
            organizationId: session.organizationId,
            resourceType: 'ROOM' as const,
            roomId,
            granteeType: 'USER' as const,
            userId,
            permissionLevel: 'VIEW' as const,
            grantedByUserId: session.userId,
          })),
        });
      }

      const correlationId = `user-room-access-${member.id}-${now.getTime()}`;
      const roomNameById = new Map(organizationRooms.map((room) => [room.id, room.name]));
      const roomIdByFolderId = new Map(
        removedRoomFolders.map((folder) => [folder.id, folder.roomId])
      );
      const roomIdByDocumentId = new Map(
        removedRoomDocuments.map((document) => [document.id, document.roomId])
      );
      for (const roomId of roomIdsToGrant) {
        await tx.event.create({
          data: {
            organizationId: session.organizationId,
            eventType: 'PERMISSION_GRANTED',
            actorType: 'ADMIN',
            actorId: session.userId,
            actorEmail: session.user.email,
            roomId,
            description: `Granted ${member.user.email} direct access to ${roomNameById.get(roomId) ?? 'a room'}`,
            metadata: {
              source: 'USER_ROOM_ACCESS_EDITOR',
              targetUserId: userId,
              targetMembershipId: member.id,
              permissionLevel: 'VIEW',
              correlationId,
            },
          },
        });
      }
      const deactivatedPermissions = [...directPermissions, ...removedDescendantPermissions].filter(
        (permission) => permissionIdsToDeactivate.includes(permission.id)
      );
      for (const permission of deactivatedPermissions) {
        const permissionRoomId =
          permission.roomId ??
          (permission.folderId
            ? roomIdByFolderId.get(permission.folderId)
            : permission.documentId
              ? roomIdByDocumentId.get(permission.documentId)
              : null);
        await tx.event.create({
          data: {
            organizationId: session.organizationId,
            eventType: 'PERMISSION_REVOKED',
            actorType: 'ADMIN',
            actorId: session.userId,
            actorEmail: session.user.email,
            roomId: permissionRoomId,
            description: `Revoked ${member.user.email}'s direct access from ${
              (permissionRoomId && roomNameById.get(permissionRoomId)) ?? 'a room'
            }`,
            metadata: {
              source: 'USER_ROOM_ACCESS_EDITOR',
              targetUserId: userId,
              targetMembershipId: member.id,
              permissionId: permission.id,
              resourceType: permission.resourceType,
              permissionLevel: permission.permissionLevel,
              expiresAt: permission.expiresAt?.toISOString() ?? null,
              resolvedRoomId: permissionRoomId,
              changeReason: permissionIdsToRevoke.includes(permission.id)
                ? 'REMOVED_FROM_ROOM'
                : permission.permissionLevel === 'NONE'
                  ? 'EXPLICIT_DENY_REPLACED'
                  : 'EXPIRED_GRANT_REPLACED',
              correlationId,
            },
          },
        });
      }

      return {
        grantedRoomIds: roomIdsToGrant,
        revokedPermissionCount: permissionIdsToRevoke.length,
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[UserRoomAccessAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update room access' }, { status: 500 });
  }
}
