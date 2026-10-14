import type { NotificationType, Prisma } from '@prisma/client';

interface RoomNotificationInput {
  organizationId: string;
  roomId: string;
  sourceEventId: string;
  actorUserId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  actionPath: string;
  documentId?: string | null;
}

/**
 * Writes one deduplicated notification per active room administrator. User
 * content is deliberately omitted from titles and messages so a stale notice
 * cannot reveal a document name or question after access changes.
 */
export async function notifyRoomAdministrators(
  tx: Prisma.TransactionClient,
  input: RoomNotificationInput
): Promise<number> {
  const roomAssignments = await tx.roleAssignment.findMany({
    where: {
      organizationId: input.organizationId,
      roomId: input.roomId,
      scopeType: 'ROOM',
      role: 'ADMIN',
    },
    select: { userId: true },
  });
  const roomAdminUserIds = roomAssignments.map((assignment) => assignment.userId);
  const memberships = await tx.userOrganization.findMany({
    where: {
      organizationId: input.organizationId,
      isActive: true,
      archivedAt: null,
      user: { isActive: true },
      OR: [{ role: 'ADMIN' }, { userId: { in: roomAdminUserIds } }],
    },
    select: { id: true, userId: true },
  });
  const recipients = memberships.filter((member) => member.userId !== input.actorUserId);
  if (recipients.length === 0) return 0;

  const created = await tx.notification.createMany({
    data: recipients.map((member) => ({
      organizationId: input.organizationId,
      userOrganizationId: member.id,
      sourceEventId: input.sourceEventId,
      roomId: input.roomId,
      documentId: input.documentId ?? null,
      type: input.type,
      title: input.title,
      message: input.message,
      actionPath: input.actionPath,
    })),
    skipDuplicates: true,
  });
  return created.count;
}

/** A member who asked a question receives the answer in their current org. */
export async function notifyQuestionAsker(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    roomId: string;
    sourceEventId: string;
    askerUserId: string | null;
    actorUserId: string;
  }
): Promise<number> {
  if (!input.askerUserId || input.askerUserId === input.actorUserId) return 0;
  const membership = await tx.userOrganization.findFirst({
    where: {
      organizationId: input.organizationId,
      userId: input.askerUserId,
      isActive: true,
      archivedAt: null,
      user: { isActive: true },
    },
    select: { id: true },
  });
  if (!membership) return 0;
  const created = await tx.notification.createMany({
    data: [
      {
        organizationId: input.organizationId,
        userOrganizationId: membership.id,
        sourceEventId: input.sourceEventId,
        roomId: input.roomId,
        type: 'QUESTION_ACTIVITY',
        title: 'Your question has a new answer',
        message: 'Open the room Q&A to read the answer.',
        actionPath: `/rooms/${input.roomId}?manage=qa`,
      },
    ],
    skipDuplicates: true,
  });
  return created.count;
}
