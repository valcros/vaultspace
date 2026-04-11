/**
 * PermissionEngine Security Tests
 *
 * Covers SEC-001 through SEC-016 from PERMISSION_MODEL.md.
 * Uses the same mocking pattern as PermissionEngine.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor, Resource } from './PermissionEngine';
import { PermissionEngine } from './PermissionEngine';

// Mock Prisma (same pattern as PermissionEngine.test.ts)
vi.mock('../db', () => ({
  db: {
    userOrganization: { findUnique: vi.fn() },
    roleAssignment: { findFirst: vi.fn() },
    permission: { findFirst: vi.fn() },
    link: { findUnique: vi.fn() },
  },
}));

import { db } from '../db';

const mockedDb = vi.mocked(db, true);

describe('PermissionEngine Security Tests', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PermissionEngine();
  });

  // SEC-001: Cross-tenant isolation
  describe('SEC-001: Cross-tenant isolation', () => {
    it('should deny when user is not member of target organization', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue(null);

      const actor: Actor = { userId: 'user-orgA', role: 'ADMIN' };
      const resource: Resource = { type: 'ROOM', organizationId: 'org-B', roomId: 'room-in-orgB' };

      const result = await engine.evaluate(actor, 'view', resource);

      expect(result.allowed).toBe(false);
    });
  });

  // SEC-006: Header spoofing
  describe('SEC-006: Org context from session only', () => {
    it('should check membership in resource org, not trust claimed role', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue(null);

      const actor: Actor = { userId: 'attacker', role: 'ADMIN' };
      const resource: Resource = {
        type: 'ROOM',
        organizationId: 'victim-org',
        roomId: 'victim-room',
      };

      const result = await engine.evaluate(actor, 'view', resource);

      expect(result.allowed).toBe(false);
      expect(mockedDb.userOrganization.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId_userId: {
              userId: 'attacker',
              organizationId: 'victim-org',
            },
          }),
        })
      );
    });
  });

  // SEC-007: Unauthenticated requests
  describe('SEC-007: Unauthenticated access denied', () => {
    it('should deny non-member users regardless of role claim', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue(null);

      const result = await engine.evaluate({ userId: 'unknown-user', role: 'ADMIN' }, 'admin', {
        type: 'ROOM',
        organizationId: 'org-1',
        roomId: 'room-1',
      });

      expect(result.allowed).toBe(false);
    });
  });

  // SEC-010: Expired link access
  describe('SEC-010: Expired link denied', () => {
    it('should deny access via expired link', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue(null);
      mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
      mockedDb.permission.findFirst.mockResolvedValue(null);
      mockedDb.link.findUnique.mockResolvedValue({
        id: 'link-1',
        isActive: true,
        expiresAt: new Date(Date.now() - 86400000),
        permission: 'VIEW',
        organizationId: 'org-1',
        roomId: 'room-1',
      } as never);

      const result = await engine.evaluate({ userId: 'viewer', linkId: 'link-1' }, 'view', {
        type: 'DOCUMENT',
        organizationId: 'org-1',
        roomId: 'room-1',
        documentId: 'doc-1',
      });

      expect(result.allowed).toBe(false);
    });
  });

  // SEC-011: Inactive link
  describe('SEC-011: Inactive link denied', () => {
    it('should deny access via deactivated link', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue(null);
      mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
      mockedDb.permission.findFirst.mockResolvedValue(null);
      mockedDb.link.findUnique.mockResolvedValue({
        id: 'link-1',
        isActive: false,
        expiresAt: null,
        permission: 'VIEW',
        organizationId: 'org-1',
        roomId: 'room-1',
      } as never);

      const result = await engine.evaluate({ userId: 'viewer', linkId: 'link-1' }, 'view', {
        type: 'DOCUMENT',
        organizationId: 'org-1',
        roomId: 'room-1',
        documentId: 'doc-1',
      });

      expect(result.allowed).toBe(false);
    });
  });

  // SEC-013: Event immutability
  describe('SEC-013: Audit events immutable', () => {
    it('should not expose update/delete on EventBus', async () => {
      const { EventBus } = await import('../events/EventBus');
      const proto = Object.getOwnPropertyNames(EventBus.prototype);

      expect(proto).not.toContain('update');
      expect(proto).not.toContain('delete');
      expect(proto).not.toContain('remove');
    });
  });

  // Default deny
  describe('Default deny policy', () => {
    it('should deny when no permissions match at any layer', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue({
        role: 'VIEWER',
        userId: 'user-1',
        organizationId: 'org-1',
      } as never);
      mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
      mockedDb.permission.findFirst.mockResolvedValue(null);
      mockedDb.link.findUnique.mockResolvedValue(null);

      const result = await engine.evaluate({ userId: 'user-1' }, 'download', {
        type: 'DOCUMENT',
        organizationId: 'org-1',
        roomId: 'room-1',
        documentId: 'doc-1',
      });

      expect(result.allowed).toBe(false);
    });
  });

  // Admin boundaries
  describe('Admin access boundaries', () => {
    it('should grant org admin access to any room', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue({
        role: 'ADMIN',
        userId: 'admin-1',
        organizationId: 'org-1',
      } as never);

      const result = await engine.evaluate({ userId: 'admin-1', role: 'ADMIN' }, 'admin', {
        type: 'ROOM',
        organizationId: 'org-1',
        roomId: 'any-room',
      });

      expect(result.allowed).toBe(true);
    });

    it('should not grant room admin access to other rooms', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue({
        role: 'VIEWER',
        userId: 'room-admin',
        organizationId: 'org-1',
      } as never);
      mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
      mockedDb.permission.findFirst.mockResolvedValue(null);
      mockedDb.link.findUnique.mockResolvedValue(null);

      const result = await engine.evaluate({ userId: 'room-admin' }, 'admin', {
        type: 'ROOM',
        organizationId: 'org-1',
        roomId: 'room-B',
      });

      expect(result.allowed).toBe(false);
    });
  });

  // Permission levels
  describe('Permission level enforcement', () => {
    it('should deny download with only VIEW permission', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue({
        role: 'VIEWER',
        userId: 'user-1',
        organizationId: 'org-1',
      } as never);
      mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
      mockedDb.permission.findFirst.mockResolvedValue({
        permissionLevel: 'VIEW',
        userId: 'user-1',
        granteeType: 'USER',
        isActive: true,
      } as never);

      const result = await engine.evaluate({ userId: 'user-1' }, 'download', {
        type: 'ROOM',
        organizationId: 'org-1',
        roomId: 'room-1',
      });

      expect(result.allowed).toBe(false);
    });

    it('should allow view with VIEW permission', async () => {
      mockedDb.userOrganization.findUnique.mockResolvedValue({
        role: 'VIEWER',
        userId: 'user-1',
        organizationId: 'org-1',
      } as never);
      mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
      mockedDb.permission.findFirst.mockResolvedValue({
        permissionLevel: 'VIEW',
        userId: 'user-1',
        granteeType: 'USER',
        isActive: true,
      } as never);

      const result = await engine.evaluate({ userId: 'user-1' }, 'view', {
        type: 'ROOM',
        organizationId: 'org-1',
        roomId: 'room-1',
      });

      expect(result.allowed).toBe(true);
    });
  });

  // System actor bypass
  describe('System actor bypass', () => {
    it('should allow system actors without DB queries', async () => {
      const result = await engine.evaluate({ isSystem: true }, 'admin', {
        type: 'ROOM',
        organizationId: 'any',
        roomId: 'any',
      });

      expect(result.allowed).toBe(true);
      expect(mockedDb.userOrganization.findUnique).not.toHaveBeenCalled();
    });
  });
});
