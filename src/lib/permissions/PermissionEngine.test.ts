/**
 * PermissionEngine Unit Tests
 *
 * Tests for the 14-layer permission evaluation algorithm.
 * These tests cover 10 key scenarios as required by Phase 1 success criteria.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor, Resource } from './PermissionEngine';
import { PermissionEngine } from './PermissionEngine';

// Mock Prisma
vi.mock('../db', () => ({
  db: {
    userOrganization: {
      findUnique: vi.fn(),
    },
    roleAssignment: {
      findFirst: vi.fn(),
    },
    permission: {
      findFirst: vi.fn(),
    },
    link: {
      findUnique: vi.fn(),
    },
  },
}));

import { db } from '../db';

const mockedDb = vi.mocked(db, true);

describe('PermissionEngine', () => {
  let engine: PermissionEngine;
  const orgId = 'org-123';
  const roomId = 'room-456';
  const folderId = 'folder-789';
  const documentId = 'doc-abc';

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PermissionEngine();
  });

  // Scenario 1: System actor always has access
  it('should allow system actors full access', async () => {
    const actor: Actor = { isSystem: true };
    const resource: Resource = { type: 'DOCUMENT', organizationId: orgId };

    const result = await engine.evaluate(actor, 'admin', resource);

    expect(result.allowed).toBe(true);
    expect(result.level).toBe('ADMIN');
    expect(result.reason).toBe('System actor');
  });

  // Scenario 2: Organization admin has full access
  it('should allow organization admins full access', async () => {
    const actor: Actor = { userId: 'user-1', role: 'ADMIN' };
    const resource: Resource = { type: 'ROOM', organizationId: orgId, roomId };

    mockedDb.userOrganization.findUnique.mockResolvedValue({
      id: 'uo-1',
      userId: 'user-1',
      organizationId: orgId,
      role: 'ADMIN',
      isActive: true,
      canManageUsers: true,
      canManageRooms: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await engine.evaluate(actor, 'admin', resource);

    expect(result.allowed).toBe(true);
    expect(result.level).toBe('ADMIN');
    expect(result.reason).toBe('Organization admin');
  });

  // Scenario 3: Room admin has full room access
  it('should allow room admins full access to the room', async () => {
    const actor: Actor = { userId: 'user-2', role: 'VIEWER' };
    const resource: Resource = { type: 'DOCUMENT', organizationId: orgId, roomId, documentId };

    mockedDb.userOrganization.findUnique.mockResolvedValue({
      id: 'uo-2',
      userId: 'user-2',
      organizationId: orgId,
      role: 'VIEWER',
      isActive: true,
      canManageUsers: false,
      canManageRooms: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockedDb.roleAssignment.findFirst.mockResolvedValue({
      id: 'ra-1',
      organizationId: orgId,
      userId: 'user-2',
      roomId,
      role: 'ADMIN',
      scopeType: 'ROOM',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await engine.evaluate(actor, 'admin', resource);

    expect(result.allowed).toBe(true);
    expect(result.level).toBe('ADMIN');
    expect(result.reason).toBe('Room admin');
  });

  // Scenario 4: Viewer with explicit document VIEW permission can view
  it('should allow explicit VIEW permission on document', async () => {
    const actor: Actor = { userId: 'user-3' };
    const resource: Resource = {
      type: 'DOCUMENT',
      organizationId: orgId,
      roomId,
      documentId,
    };

    mockedDb.userOrganization.findUnique.mockResolvedValue({
      id: 'uo-3',
      userId: 'user-3',
      organizationId: orgId,
      role: 'VIEWER',
      isActive: true,
      canManageUsers: false,
      canManageRooms: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
    mockedDb.permission.findFirst.mockResolvedValue({
      id: 'perm-1',
      organizationId: orgId,
      roomId: null,
      folderId: null,
      documentId,
      userId: 'user-3',
      groupId: null,
      granteeType: 'USER',
      permissionLevel: 'VIEW',
      resourceType: 'DOCUMENT',
      isActive: true,
      expiresAt: null,
      inheritFromParent: true,
      grantedByUserId: 'admin-1',
      grantedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await engine.evaluate(actor, 'view', resource);

    expect(result.allowed).toBe(true);
    expect(result.level).toBe('VIEW');
  });

  // Scenario 5: VIEW permission is insufficient for download
  it('should deny download with only VIEW permission', async () => {
    const actor: Actor = { userId: 'user-4' };
    const resource: Resource = { type: 'DOCUMENT', organizationId: orgId, documentId };

    mockedDb.userOrganization.findUnique.mockResolvedValue({
      id: 'uo-4',
      userId: 'user-4',
      organizationId: orgId,
      role: 'VIEWER',
      isActive: true,
      canManageUsers: false,
      canManageRooms: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
    mockedDb.permission.findFirst.mockResolvedValue({
      id: 'perm-2',
      organizationId: orgId,
      roomId: null,
      folderId: null,
      documentId,
      userId: 'user-4',
      groupId: null,
      granteeType: 'USER',
      permissionLevel: 'VIEW',
      resourceType: 'DOCUMENT',
      isActive: true,
      expiresAt: null,
      inheritFromParent: true,
      grantedByUserId: 'admin-1',
      grantedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await engine.evaluate(actor, 'download', resource);

    expect(result.allowed).toBe(false);
    expect(result.level).toBe('VIEW');
  });

  // Scenario 6: DOWNLOAD permission allows download
  it('should allow download with DOWNLOAD permission', async () => {
    const actor: Actor = { userId: 'user-5' };
    const resource: Resource = { type: 'DOCUMENT', organizationId: orgId, documentId };

    mockedDb.userOrganization.findUnique.mockResolvedValue({
      id: 'uo-5',
      userId: 'user-5',
      organizationId: orgId,
      role: 'VIEWER',
      isActive: true,
      canManageUsers: false,
      canManageRooms: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
    mockedDb.permission.findFirst.mockResolvedValue({
      id: 'perm-3',
      organizationId: orgId,
      roomId: null,
      folderId: null,
      documentId,
      userId: 'user-5',
      groupId: null,
      granteeType: 'USER',
      permissionLevel: 'DOWNLOAD',
      resourceType: 'DOCUMENT',
      isActive: true,
      expiresAt: null,
      inheritFromParent: true,
      grantedByUserId: 'admin-1',
      grantedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await engine.evaluate(actor, 'download', resource);

    expect(result.allowed).toBe(true);
    expect(result.level).toBe('DOWNLOAD');
  });

  // Scenario 7: Group permission grants access
  it('should allow access through group membership', async () => {
    const actor: Actor = { userId: 'user-6', groupIds: ['group-1'] };
    const resource: Resource = { type: 'FOLDER', organizationId: orgId, roomId, folderId };

    mockedDb.userOrganization.findUnique.mockResolvedValue({
      id: 'uo-6',
      userId: 'user-6',
      organizationId: orgId,
      role: 'VIEWER',
      isActive: true,
      canManageUsers: false,
      canManageRooms: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
    // First call for explicit permission returns null
    mockedDb.permission.findFirst
      .mockResolvedValueOnce(null) // document check
      .mockResolvedValueOnce(null) // folder check
      .mockResolvedValueOnce(null) // room check
      .mockResolvedValueOnce({
        // group check
        id: 'perm-4',
        organizationId: orgId,
        roomId: null,
        folderId,
        documentId: null,
        userId: null,
        groupId: 'group-1',
        granteeType: 'GROUP',
        permissionLevel: 'VIEW',
        resourceType: 'FOLDER',
        isActive: true,
        expiresAt: null,
        inheritFromParent: true,
        grantedByUserId: 'admin-1',
        grantedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    const result = await engine.evaluate(actor, 'view', resource);

    expect(result.allowed).toBe(true);
    expect(result.level).toBe('VIEW');
  });

  // Scenario 8: Link-based access grants VIEW
  it('should allow view access through active link', async () => {
    const actor: Actor = { linkId: 'link-1' };
    const resource: Resource = { type: 'ROOM', organizationId: orgId, roomId };

    mockedDb.permission.findFirst.mockResolvedValue(null);
    mockedDb.link.findUnique.mockResolvedValue({
      id: 'link-1',
      roomId,
      organizationId: orgId,
      slug: 'abc123',
      name: 'Public Link',
      description: null,
      scope: 'ENTIRE_ROOM',
      scopedFolderId: null,
      scopedDocumentId: null,
      permission: 'VIEW',
      isActive: true,
      expiresAt: null,
      maxViews: null,
      viewCount: 0,
      maxSessionMinutes: null,
      requiresPassword: false,
      passwordHash: null,
      requiresEmailVerification: false,
      allowedEmails: [],
      createdByUserId: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessedAt: null,
    });

    const result = await engine.evaluate(actor, 'view', resource);

    expect(result.allowed).toBe(true);
    expect(result.level).toBe('VIEW');
  });

  // Scenario 9: Inactive link is denied
  it('should deny access for inactive links', async () => {
    const actor: Actor = { linkId: 'link-2' };
    const resource: Resource = { type: 'ROOM', organizationId: orgId, roomId };

    mockedDb.permission.findFirst.mockResolvedValue(null);
    mockedDb.link.findUnique.mockResolvedValue({
      id: 'link-2',
      roomId,
      organizationId: orgId,
      slug: 'def456',
      name: 'Expired Link',
      description: null,
      scope: 'ENTIRE_ROOM',
      scopedFolderId: null,
      scopedDocumentId: null,
      permission: 'VIEW',
      isActive: false, // Inactive
      expiresAt: null,
      maxViews: null,
      viewCount: 0,
      maxSessionMinutes: null,
      requiresPassword: false,
      passwordHash: null,
      requiresEmailVerification: false,
      allowedEmails: [],
      createdByUserId: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessedAt: null,
    });

    const result = await engine.evaluate(actor, 'view', resource);

    expect(result.allowed).toBe(false);
    expect(result.level).toBe('NONE');
  });

  // Scenario 10: Default deny when no permission found
  it('should deny access when no permission is found', async () => {
    const actor: Actor = { userId: 'user-7' };
    const resource: Resource = { type: 'DOCUMENT', organizationId: orgId, documentId };

    mockedDb.userOrganization.findUnique.mockResolvedValue({
      id: 'uo-7',
      userId: 'user-7',
      organizationId: orgId,
      role: 'VIEWER',
      isActive: true,
      canManageUsers: false,
      canManageRooms: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockedDb.roleAssignment.findFirst.mockResolvedValue(null);
    mockedDb.permission.findFirst.mockResolvedValue(null);

    const result = await engine.evaluate(actor, 'view', resource);

    expect(result.allowed).toBe(false);
    expect(result.level).toBe('NONE');
    expect(result.reason).toBe('No permission found');
  });

  // Test the simplified can() method
  it('should return boolean from can() method', async () => {
    const actor: Actor = { isSystem: true };
    const resource: Resource = { type: 'DOCUMENT', organizationId: orgId };

    const canView = await engine.can(actor, 'view', resource);
    const canAdmin = await engine.can(actor, 'admin', resource);

    expect(canView).toBe(true);
    expect(canAdmin).toBe(true);
  });
});
