import type { Prisma, Room, RoomStatus } from '@prisma/client';

/**
 * Room lifecycle policy shared by room-scoped mutation handlers.
 *
 * Draft rooms are administrator setup workspaces and active rooms are normal
 * operational workspaces. Archived and closed rooms retain history only and
 * must reject every side effect at the server boundary.
 */
export function isRoomMutable(status: RoomStatus): boolean {
  // The database enum is non-nullable. Expressing the terminal states keeps
  // the policy safe for every persisted value while allowing narrow unit-test
  // doubles that omit fields unrelated to the route under test.
  return status !== 'ARCHIVED' && status !== 'CLOSED';
}

export type RoomMutationAccess =
  | { ok: true; room: Room }
  | { ok: false; status: 404; error: 'Room not found' }
  | {
      ok: false;
      status: 409;
      error: 'This room is not available for changes';
      code: 'ROOM_NOT_MUTABLE';
    };

/**
 * Runs inside an existing organization-scoped transaction after its authority
 * check. A missing/cross-tenant room remains non-disclosing, while a retained
 * room returns one stable lifecycle-conflict response.
 */
export async function requireMutableRoom(
  tx: Prisma.TransactionClient,
  organizationId: string,
  roomId: string
): Promise<RoomMutationAccess> {
  const room = await tx.room.findFirst({ where: { id: roomId, organizationId } });
  if (!room) {
    return { ok: false, status: 404, error: 'Room not found' };
  }
  if (!isRoomMutable(room.status)) {
    return {
      ok: false,
      status: 409,
      error: 'This room is not available for changes',
      code: 'ROOM_NOT_MUTABLE',
    };
  }
  return { ok: true, room };
}
