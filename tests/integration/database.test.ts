/**
 * Database Integration Tests
 *
 * Tests database operations with real PostgreSQL.
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Database Integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  describe('Organization', () => {
    it('should create and retrieve an organization', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Test Organization',
          slug: 'test-org-' + Date.now(),
          isActive: true,
        },
      });

      expect(org.id).toBeDefined();
      expect(org.name).toBe('Test Organization');
      expect(org.isActive).toBe(true);

      const found = await prisma.organization.findUnique({
        where: { id: org.id },
      });

      expect(found).toBeDefined();
      expect(found?.name).toBe('Test Organization');
    });

    it('should enforce unique slug constraint', async () => {
      const slug = 'unique-slug-' + Date.now();

      await prisma.organization.create({
        data: {
          name: 'First Org',
          slug,
          isActive: true,
        },
      });

      await expect(
        prisma.organization.create({
          data: {
            name: 'Second Org',
            slug, // Same slug
            isActive: true,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('User', () => {
    it('should create a user with organization membership', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'User Test Org',
          slug: 'user-test-org-' + Date.now(),
          isActive: true,
        },
      });

      const user = await prisma.user.create({
        data: {
          email: `test-${Date.now()}@example.com`,
          passwordHash: 'hashed-password',
          firstName: 'Test',
          lastName: 'User',
          isActive: true,
          organizations: {
            create: {
              organizationId: org.id,
              role: 'ADMIN',
              isActive: true,
            },
          },
        },
        include: {
          organizations: true,
        },
      });

      expect(user.id).toBeDefined();
      expect(user.organizations).toHaveLength(1);
      expect(user.organizations[0]?.role).toBe('ADMIN');
    });
  });

  describe('Room', () => {
    it('should create a room with documents', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Room Test Org',
          slug: 'room-test-org-' + Date.now(),
          isActive: true,
        },
      });

      const room = await prisma.room.create({
        data: {
          organizationId: org.id,
          name: 'Test Room',
          slug: 'test-room-' + Date.now(),
          status: 'ACTIVE',
        },
      });

      expect(room.id).toBeDefined();
      expect(room.status).toBe('ACTIVE');

      // Create a document in the room
      const doc = await prisma.document.create({
        data: {
          organizationId: org.id,
          roomId: room.id,
          name: 'test-document.pdf',
          mimeType: 'application/pdf',
          fileSize: 1024,
          originalFileName: 'test-document.pdf',
          status: 'ACTIVE',
        },
      });

      expect(doc.id).toBeDefined();
      expect(doc.roomId).toBe(room.id);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should isolate data between organizations', async () => {
      const org1 = await prisma.organization.create({
        data: {
          name: 'Org 1',
          slug: 'org1-' + Date.now(),
          isActive: true,
        },
      });

      const org2 = await prisma.organization.create({
        data: {
          name: 'Org 2',
          slug: 'org2-' + Date.now(),
          isActive: true,
        },
      });

      await prisma.room.create({
        data: {
          organizationId: org1.id,
          name: 'Org1 Room',
          slug: 'org1-room',
          status: 'ACTIVE',
        },
      });

      await prisma.room.create({
        data: {
          organizationId: org2.id,
          name: 'Org2 Room',
          slug: 'org2-room',
          status: 'ACTIVE',
        },
      });

      // Query with org1 scope
      const org1Rooms = await prisma.room.findMany({
        where: { organizationId: org1.id },
      });

      expect(org1Rooms).toHaveLength(1);
      expect(org1Rooms[0]?.name).toBe('Org1 Room');

      // Query with org2 scope
      const org2Rooms = await prisma.room.findMany({
        where: { organizationId: org2.id },
      });

      expect(org2Rooms).toHaveLength(1);
      expect(org2Rooms[0]?.name).toBe('Org2 Room');
    });
  });
});
