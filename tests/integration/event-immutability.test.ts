/**
 * Event immutability integration tests.
 *
 * These tests validate SEC-013 and SEC-014 at the PostgreSQL layer.
 * Events are created inside transactions that intentionally roll back, so
 * cleanup does not require deleting immutable audit rows.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

class RollbackTestTransaction extends Error {
  constructor() {
    super('rollback event immutability test transaction');
  }
}

async function withRollbackTransaction(
  callback: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<void> {
  await expect(
    prisma.$transaction(async (tx) => {
      await callback(tx);
      throw new RollbackTestTransaction();
    })
  ).rejects.toBeInstanceOf(RollbackTestTransaction);
}

async function createAuditEvent(tx: Prisma.TransactionClient): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await tx.organization.create({
    data: {
      name: `Event Immutability Test ${suffix}`,
      slug: `event-immutability-${suffix}`,
      isActive: true,
    },
  });

  const event = await tx.event.create({
    data: {
      organizationId: organization.id,
      eventType: 'ROOM_CREATED',
      actorType: 'SYSTEM',
      description: 'immutable audit event',
      metadata: { test: 'event-immutability' },
    },
  });

  return event.id;
}

describe('SEC-013/014: event immutability trigger', () => {
  it('rejects direct SQL updates to events', async () => {
    await withRollbackTransaction(async (tx) => {
      const eventId = await createAuditEvent(tx);

      await expect(
        tx.$executeRaw`UPDATE "events" SET "description" = 'tampered' WHERE "id" = ${eventId}`
      ).rejects.toThrow(/events are immutable/);
    });
  });

  it('rejects direct SQL deletes from events', async () => {
    await withRollbackTransaction(async (tx) => {
      const eventId = await createAuditEvent(tx);

      await expect(tx.$executeRaw`DELETE FROM "events" WHERE "id" = ${eventId}`).rejects.toThrow(
        /events are immutable/
      );
    });
  });

  it('soft-invalidates an audited viewer session without changing its event', async () => {
    await withRollbackTransaction(async (tx) => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const organization = await tx.organization.create({
        data: {
          name: `Viewer Logout Test ${suffix}`,
          slug: `viewer-logout-${suffix}`,
          isActive: true,
        },
      });
      const room = await tx.room.create({
        data: {
          organizationId: organization.id,
          name: 'Audited Viewer Room',
          slug: `viewer-room-${suffix}`,
          status: 'ACTIVE',
        },
      });
      const link = await tx.link.create({
        data: {
          organizationId: organization.id,
          roomId: room.id,
          slug: `viewer-link-${suffix}`,
          isActive: true,
        },
      });
      const viewSession = await tx.viewSession.create({
        data: {
          organizationId: organization.id,
          roomId: room.id,
          linkId: link.id,
          sessionToken: `viewer-session-${suffix}`,
          isActive: true,
        },
      });
      const event = await tx.event.create({
        data: {
          organizationId: organization.id,
          roomId: room.id,
          sessionId: viewSession.id,
          eventType: 'LINK_ACCESSED',
          actorType: 'VIEWER',
          description: 'audited viewer activity',
        },
      });

      const result = await tx.viewSession.updateMany({
        where: {
          id: viewSession.id,
          organizationId: organization.id,
          isActive: true,
        },
        data: { isActive: false },
      });

      expect(result.count).toBe(1);
      await expect(
        tx.viewSession.findFirst({
          where: {
            sessionToken: viewSession.sessionToken,
            isActive: true,
          },
        })
      ).resolves.toBeNull();
      await expect(tx.event.findUnique({ where: { id: event.id } })).resolves.toMatchObject({
        id: event.id,
        sessionId: viewSession.id,
        description: 'audited viewer activity',
      });
    });
  });
});
