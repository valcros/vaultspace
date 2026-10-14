import { randomUUID } from 'node:crypto';
import type { Prisma, RoomTemplate } from '@prisma/client';

import { withOrgContext } from '@/lib/db';
import { legacyTemplateProjection } from '@/lib/rooms/templateCatalog';
import {
  SystemRoomTemplateError,
  assertTemplateRevision,
  systemRoomTemplateInputSchema,
  type SystemRoomTemplateInput,
} from '@/services/SystemRoomTemplateService';

export interface OrganizationRoomTemplateActor {
  organizationId: string;
  userId: string;
  userEmail: string;
  requestId: string;
}

async function assertActiveAdmin(
  tx: Prisma.TransactionClient,
  actor: OrganizationRoomTemplateActor
) {
  const membership = await tx.userOrganization.findUnique({
    where: {
      organizationId_userId: { organizationId: actor.organizationId, userId: actor.userId },
    },
    select: { role: true, isActive: true, archivedAt: true },
  });
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { isActive: true },
  });
  if (
    !membership ||
    membership.role !== 'ADMIN' ||
    !membership.isActive ||
    membership.archivedAt ||
    !user?.isActive
  ) {
    throw new SystemRoomTemplateError(403, 'An active organization administrator is required');
  }
  if (!actor.requestId) {
    throw new SystemRoomTemplateError(400, 'A request ID is required');
  }
}

async function audit(
  tx: Prisma.TransactionClient,
  row: RoomTemplate,
  actor: OrganizationRoomTemplateActor,
  eventType: 'ROOM_TEMPLATE_CREATED' | 'ROOM_TEMPLATE_UPDATED',
  priorRevision: string | null
) {
  const template = legacyTemplateProjection(row);
  await tx.event.create({
    data: {
      organizationId: actor.organizationId,
      eventType,
      actorType: 'ADMIN',
      actorId: actor.userId,
      actorEmail: actor.userEmail,
      requestId: actor.requestId,
      description: `${eventType === 'ROOM_TEMPLATE_CREATED' ? 'Created' : 'Updated'} organization folder template "${row.name}"`,
      metadata: {
        templateId: row.id,
        revision: row.revision,
        priorRevision,
        snapshot: template,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  return template;
}

function parseInput(input: SystemRoomTemplateInput) {
  const parsed = systemRoomTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new SystemRoomTemplateError(400, parsed.error.issues[0]?.message ?? 'Invalid template');
  }
  return parsed.data;
}

export class OrganizationRoomTemplateService {
  async list(organizationId: string, includeDisabled = false) {
    return withOrgContext(organizationId, async (tx) => {
      const rows = await tx.roomTemplate.findMany({
        where: { organizationId, ...(includeDisabled ? {} : { enabled: true }) },
        orderBy: { name: 'asc' },
      });
      return rows.map(legacyTemplateProjection);
    });
  }

  async create(input: SystemRoomTemplateInput, actor: OrganizationRoomTemplateActor) {
    const data = parseInput(input);
    return withOrgContext(actor.organizationId, async (tx) => {
      await assertActiveAdmin(tx, actor);
      const row = await tx.roomTemplate.create({
        data: {
          id: `org-${randomUUID()}`,
          organizationId: actor.organizationId,
          name: data.name,
          description: data.description,
          category: data.category,
          folderStructure: { folders: data.folders },
          enabled: data.enabled,
          isSystemTemplate: false,
          isPublic: false,
        },
      });
      return audit(tx, row, actor, 'ROOM_TEMPLATE_CREATED', null);
    });
  }

  async update(
    id: string,
    input: SystemRoomTemplateInput,
    expectedRevision: string | undefined,
    actor: OrganizationRoomTemplateActor
  ) {
    const data = parseInput(input);
    return withOrgContext(actor.organizationId, async (tx) => {
      await assertActiveAdmin(tx, actor);
      const row = await tx.roomTemplate.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!row) {
        throw new SystemRoomTemplateError(404, 'Organization template not found');
      }
      const current = legacyTemplateProjection(row);
      assertTemplateRevision(current, expectedRevision);
      const updated = await tx.roomTemplate.updateMany({
        where: { id, organizationId: actor.organizationId, revision: row.revision },
        data: {
          name: data.name,
          description: data.description,
          category: data.category,
          folderStructure: { folders: data.folders },
          enabled: data.enabled,
          isSystemTemplate: false,
          isPublic: false,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new SystemRoomTemplateError(
          409,
          'The folder template changed. Refresh and try again.'
        );
      }
      return audit(
        tx,
        {
          ...row,
          name: data.name,
          description: data.description,
          category: data.category,
          folderStructure: { folders: data.folders },
          enabled: data.enabled,
          isSystemTemplate: false,
          isPublic: false,
          revision: row.revision + 1,
        },
        actor,
        'ROOM_TEMPLATE_UPDATED',
        current.revision
      );
    });
  }
}

export const organizationRoomTemplateService = new OrganizationRoomTemplateService();
