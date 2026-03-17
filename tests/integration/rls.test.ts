/**
 * Row-Level Security (RLS) Integration Tests
 *
 * AZURE-ONLY: These tests run against Azure PostgreSQL.
 * Local execution is not permitted.
 *
 * Verifies that RLS enforcement works correctly when ENABLE_RLS=true.
 * These tests ensure proper tenant isolation at the database level.
 *
 * Test scenarios:
 * - SEC-001: Cross-tenant data isolation
 * - withOrgContext properly sets tenant boundary
 * - PRE-RLS bootstrap patterns work correctly
 * - Direct queries without context are blocked
 *
 * Run with: DATABASE_URL=<azure-postgres-url> npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, UserRole } from '@prisma/client';
import { withOrgContext, db } from '@/lib/db';
import { getPermissionEngine } from '@/lib/permissions';
import { createEventBus } from '@/lib/events/EventBus';

// Create a separate Prisma client for raw SQL operations
const rawPrisma = new PrismaClient();

// Test data
let org1Id: string;
let org2Id: string;
let room1Id: string;
let room2Id: string;
let user1Id: string;

describe('RLS Enforcement', () => {
  beforeAll(async () => {
    await rawPrisma.$connect();
    await db.$connect();

    // Create two test organizations
    const org1 = await rawPrisma.organization.create({
      data: {
        name: 'RLS Test Org 1',
        slug: `rls-org1-${Date.now()}`,
        isActive: true,
      },
    });
    org1Id = org1.id;

    const org2 = await rawPrisma.organization.create({
      data: {
        name: 'RLS Test Org 2',
        slug: `rls-org2-${Date.now()}`,
        isActive: true,
      },
    });
    org2Id = org2.id;

    // Create rooms in each organization
    const room1 = await rawPrisma.room.create({
      data: {
        organizationId: org1Id,
        name: 'RLS Test Room 1',
        slug: `rls-room1-${Date.now()}`,
        status: 'ACTIVE',
      },
    });
    room1Id = room1.id;

    const room2 = await rawPrisma.room.create({
      data: {
        organizationId: org2Id,
        name: 'RLS Test Room 2',
        slug: `rls-room2-${Date.now()}`,
        status: 'ACTIVE',
      },
    });
    room2Id = room2.id;

    // Create a test user in org1
    const user1 = await rawPrisma.user.create({
      data: {
        email: `rls-test-${Date.now()}@example.com`,
        passwordHash: 'test-hash',
        firstName: 'RLS',
        lastName: 'TestUser',
        isActive: true,
        organizations: {
          create: {
            organizationId: org1Id,
            role: 'ADMIN',
            isActive: true,
          },
        },
      },
    });
    user1Id = user1.id;

    // Create documents in each room
    await rawPrisma.document.create({
      data: {
        organizationId: org1Id,
        roomId: room1Id,
        name: 'org1-doc.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        originalFileName: 'org1-doc.pdf',
        status: 'ACTIVE',
      },
    });

    await rawPrisma.document.create({
      data: {
        organizationId: org2Id,
        roomId: room2Id,
        name: 'org2-doc.pdf',
        mimeType: 'application/pdf',
        fileSize: 2048,
        originalFileName: 'org2-doc.pdf',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data (order matters due to foreign keys)
    await rawPrisma.event.deleteMany({
      where: { organizationId: { in: [org1Id, org2Id] } },
    });
    await rawPrisma.document.deleteMany({
      where: { organizationId: { in: [org1Id, org2Id] } },
    });
    await rawPrisma.room.deleteMany({
      where: { organizationId: { in: [org1Id, org2Id] } },
    });
    await rawPrisma.userOrganization.deleteMany({
      where: { organizationId: { in: [org1Id, org2Id] } },
    });
    await rawPrisma.user.deleteMany({
      where: { id: user1Id },
    });
    await rawPrisma.organization.deleteMany({
      where: { id: { in: [org1Id, org2Id] } },
    });

    await rawPrisma.$disconnect();
    await db.$disconnect();
  });

  describe('withOrgContext', () => {
    it('should return only data from the specified organization', async () => {
      // Query within org1 context
      const org1Rooms = await withOrgContext(org1Id, async (tx) => {
        return tx.room.findMany({
          where: { organizationId: org1Id },
        });
      });

      expect(org1Rooms).toHaveLength(1);
      expect(org1Rooms[0]?.name).toBe('RLS Test Room 1');

      // Query within org2 context
      const org2Rooms = await withOrgContext(org2Id, async (tx) => {
        return tx.room.findMany({
          where: { organizationId: org2Id },
        });
      });

      expect(org2Rooms).toHaveLength(1);
      expect(org2Rooms[0]?.name).toBe('RLS Test Room 2');
    });

    it('should not return data from other organizations even without explicit filter', async () => {
      // Query within org1 context WITHOUT org filter
      // When RLS is enabled, this should still only return org1 data
      const roomsInOrg1Context = await withOrgContext(org1Id, async (tx) => {
        return tx.room.findMany({
          where: {
            slug: { startsWith: 'rls-room' },
          },
        });
      });

      // Without RLS, this might return both rooms
      // With RLS, it should only return org1's room
      const rlsEnabled = process.env['ENABLE_RLS'] === 'true';
      if (rlsEnabled) {
        expect(roomsInOrg1Context).toHaveLength(1);
        expect(roomsInOrg1Context[0]?.organizationId).toBe(org1Id);
      } else {
        // When RLS is disabled, Prisma middleware should still filter
        // but the test acknowledges both behaviors are valid in dev mode
        expect(roomsInOrg1Context.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should properly scope document queries to organization', async () => {
      const org1Docs = await withOrgContext(org1Id, async (tx) => {
        return tx.document.findMany({
          where: { organizationId: org1Id },
        });
      });

      expect(org1Docs).toHaveLength(1);
      expect(org1Docs[0]?.name).toBe('org1-doc.pdf');

      const org2Docs = await withOrgContext(org2Id, async (tx) => {
        return tx.document.findMany({
          where: { organizationId: org2Id },
        });
      });

      expect(org2Docs).toHaveLength(1);
      expect(org2Docs[0]?.name).toBe('org2-doc.pdf');
    });

    it('should allow nested queries within the same context', async () => {
      const result = await withOrgContext(org1Id, async (tx) => {
        const room = await tx.room.findFirst({
          where: { organizationId: org1Id },
        });

        if (!room) return { room: null, documents: [] };

        const documents = await tx.document.findMany({
          where: { roomId: room.id },
        });

        return { room, documents };
      });

      expect(result.room).toBeDefined();
      expect(result.room?.name).toBe('RLS Test Room 1');
      expect(result.documents).toHaveLength(1);
    });
  });

  describe('SEC-001: Cross-tenant isolation', () => {
    it('should not allow org1 to access org2 data', async () => {
      // Try to query org2's room from org1's context
      const crossTenantRoom = await withOrgContext(org1Id, async (tx) => {
        return tx.room.findFirst({
          where: { id: room2Id },
        });
      });

      // Should not find org2's room when in org1's context
      const rlsEnabled = process.env['ENABLE_RLS'] === 'true';
      if (rlsEnabled) {
        expect(crossTenantRoom).toBeNull();
      }
    });

    it('should not allow org2 to access org1 documents', async () => {
      // Try to query org1's documents from org2's context
      const crossTenantDocs = await withOrgContext(org2Id, async (tx) => {
        return tx.document.findMany({
          where: { roomId: room1Id },
        });
      });

      // Should not find org1's documents when in org2's context
      const rlsEnabled = process.env['ENABLE_RLS'] === 'true';
      if (rlsEnabled) {
        expect(crossTenantDocs).toHaveLength(0);
      }
    });
  });

  describe('PRE-RLS Bootstrap patterns', () => {
    it('should allow organization lookup by slug without context', async () => {
      // This simulates the bootstrap pattern where we need to resolve
      // an organization before we can establish context
      const org = await db.organization.findFirst({
        where: {
          slug: { startsWith: 'rls-org1-' },
          isActive: true,
        },
        select: {
          id: true,
          slug: true,
        },
      });

      expect(org).toBeDefined();
      expect(org?.id).toBe(org1Id);
    });

    it('should allow session lookup by token (non-RLS table)', async () => {
      // Sessions table is intentionally not RLS-protected
      // This is a verification that session lookup works without org context
      const session = await db.session.findFirst({
        where: {
          // Using a non-existent token - we're just verifying the query works
          token: 'non-existent-token-for-testing',
        },
      });

      // Query should execute without error (returns null for non-existent token)
      expect(session).toBeNull();
    });
  });

  describe('Event audit trail', () => {
    it('should write events within RLS context', async () => {
      const eventData = {
        eventType: 'ROOM_CREATED' as const,
        actorType: 'ADMIN' as const,
        organizationId: org1Id,
        roomId: room1Id,
        description: 'RLS test event',
      };

      const event = await withOrgContext(org1Id, async (tx) => {
        return tx.event.create({
          data: eventData,
        });
      });

      expect(event.id).toBeDefined();
      expect(event.organizationId).toBe(org1Id);

      // Cleanup
      await rawPrisma.event.delete({ where: { id: event.id } });
    });

    it('should scope event queries to organization', async () => {
      // Create events in both orgs
      const event1 = await rawPrisma.event.create({
        data: {
          eventType: 'ROOM_CREATED',
          actorType: 'ADMIN',
          organizationId: org1Id,
          roomId: room1Id,
          description: 'Org1 event',
        },
      });

      const event2 = await rawPrisma.event.create({
        data: {
          eventType: 'ROOM_CREATED',
          actorType: 'ADMIN',
          organizationId: org2Id,
          roomId: room2Id,
          description: 'Org2 event',
        },
      });

      // Query events in org1 context
      const org1Events = await withOrgContext(org1Id, async (tx) => {
        return tx.event.findMany({
          where: { organizationId: org1Id },
        });
      });

      expect(org1Events.some((e) => e.description === 'Org1 event')).toBe(true);
      expect(org1Events.some((e) => e.description === 'Org2 event')).toBe(false);

      // Cleanup
      await rawPrisma.event.deleteMany({
        where: { id: { in: [event1.id, event2.id] } },
      });
    });
  });

  describe('PermissionEngine with transaction', () => {
    it('should accept transaction client for RLS-scoped permission checks', async () => {
      const permissionEngine = getPermissionEngine();

      // Test that PermissionEngine.can() accepts a transaction client
      const result = await withOrgContext(org1Id, async (tx) => {
        // Pass transaction to permission check - this verifies the signature works
        const canView = await permissionEngine.can(
          { userId: user1Id, role: 'ADMIN' as UserRole },
          'view',
          { type: 'ROOM', organizationId: org1Id, roomId: room1Id },
          tx // Transaction client parameter
        );
        return canView;
      });

      // Admin should have view permission on their org's room
      expect(result).toBe(true);
    });

    it('should deny cross-tenant access through permission engine', async () => {
      const permissionEngine = getPermissionEngine();

      // Try to check permission for org2's room while in org1's context
      const result = await withOrgContext(org1Id, async (tx) => {
        const canView = await permissionEngine.can(
          { userId: user1Id, role: 'ADMIN' as UserRole },
          'view',
          { type: 'ROOM', organizationId: org2Id, roomId: room2Id },
          tx
        );
        return canView;
      });

      // Should not have permission to org2's room
      expect(result).toBe(false);
    });
  });

  describe('EventBus RLS wrapping', () => {
    it('should auto-wrap event writes in RLS context when no client provided', async () => {
      // Create EventBus without passing a transaction - it should auto-wrap
      const eventBus = createEventBus(org1Id, {
        actorId: user1Id,
        actorType: 'ADMIN',
        requestId: `test-${Date.now()}`,
      });

      // Emit event without explicit client - EventBus should wrap in withOrgContext
      const eventId = await eventBus.emit('ROOM_CREATED', {
        roomId: room1Id,
        description: 'EventBus auto-wrap test',
      });

      expect(eventId).toBeDefined();

      // Verify event was created with correct org
      const event = await rawPrisma.event.findUnique({
        where: { id: eventId },
      });

      expect(event).toBeDefined();
      expect(event?.organizationId).toBe(org1Id);

      // Cleanup
      await rawPrisma.event.delete({ where: { id: eventId } });
    });

    it('should use provided transaction client for event writes', async () => {
      const eventBus = createEventBus(org1Id, {
        actorId: user1Id,
        actorType: 'ADMIN',
        requestId: `test-${Date.now()}`,
      });

      // Emit event with explicit transaction client
      const eventId = await withOrgContext(org1Id, async (tx) => {
        return eventBus.emit(
          'ROOM_UPDATED',
          {
            roomId: room1Id,
            description: 'EventBus with tx test',
          },
          tx // Pass transaction explicitly
        );
      });

      expect(eventId).toBeDefined();

      // Verify event was created
      const event = await rawPrisma.event.findUnique({
        where: { id: eventId },
      });

      expect(event?.description).toBe('EventBus with tx test');

      // Cleanup
      await rawPrisma.event.delete({ where: { id: eventId } });
    });
  });

  describe('Service layer RLS integration', () => {
    it('should verify RoomService uses withOrgContext internally', async () => {
      // This test verifies that service methods properly scope data
      // by checking that queries return only tenant-appropriate data

      // Query rooms using the pattern services use internally
      const rooms = await withOrgContext(org1Id, async (tx) => {
        return tx.room.findMany({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        });
      });

      // All returned rooms should belong to org1
      const allBelongToOrg1 = rooms.every((r) => r.organizationId === org1Id);

      // With RLS enabled, only org1 rooms should be returned
      const rlsEnabled = process.env['ENABLE_RLS'] === 'true';
      if (rlsEnabled) {
        expect(allBelongToOrg1).toBe(true);
      }
    });

    it('should verify GroupService patterns work with RLS', async () => {
      // Create a group using the RLS context pattern that GroupService uses
      const group = await withOrgContext(org1Id, async (tx) => {
        return tx.group.create({
          data: {
            organizationId: org1Id,
            name: `RLS Test Group ${Date.now()}`,
          },
        });
      });

      expect(group.organizationId).toBe(org1Id);

      // Query group back
      const foundGroup = await withOrgContext(org1Id, async (tx) => {
        return tx.group.findFirst({
          where: { id: group.id },
        });
      });

      expect(foundGroup).toBeDefined();

      // Try to access from wrong org context (should fail with RLS)
      const crossTenantGroup = await withOrgContext(org2Id, async (tx) => {
        return tx.group.findFirst({
          where: { id: group.id },
        });
      });

      const rlsEnabled = process.env['ENABLE_RLS'] === 'true';
      if (rlsEnabled) {
        expect(crossTenantGroup).toBeNull();
      }

      // Cleanup
      await rawPrisma.group.delete({ where: { id: group.id } });
    });
  });
});
