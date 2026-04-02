/**
 * Document Version Rollback API Tests
 *
 * Validates rollback logic: success, version-not-found, already-current, scan status, and permission checks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth
const mockSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
  user: { email: 'admin@example.com' },
};
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(() => Promise.resolve(mockSession)),
}));

// Mock providers
vi.mock('@/providers', () => ({
  getProviders: () => ({
    storage: { exists: vi.fn(), get: vi.fn() },
    job: { addJob: vi.fn(() => Promise.resolve()) },
  }),
}));

// Mock DB transaction
const mockTx = {
  room: { findFirst: vi.fn() },
  document: { findFirst: vi.fn(), update: vi.fn() },
  documentVersion: { findFirst: vi.fn() },
  event: { create: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { POST } from './route';

function makeRequest(): NextRequest {
  return new NextRequest(
    new URL('http://localhost:3000/api/rooms/room-1/documents/doc-1/versions/ver-1/rollback'),
    { method: 'POST' }
  );
}

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1', documentId: 'doc-1', versionId: 'ver-1' }) };
}

const mockRoom = { id: 'room-1', organizationId: 'org-1' };
const mockDocument = { id: 'doc-1', currentVersionId: 'ver-old', roomId: 'room-1' };
const mockVersion = {
  id: 'ver-1',
  versionNumber: 2,
  scanStatus: 'CLEAN',
  mimeType: 'application/pdf',
  fileSize: 1024,
  uploadedByUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@b.com' },
};

describe('POST /api/rooms/:roomId/documents/:documentId/versions/:versionId/rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
    mockTx.room.findFirst.mockResolvedValue(mockRoom);
    mockTx.document.findFirst.mockResolvedValue(mockDocument);
    mockTx.documentVersion.findFirst.mockResolvedValue(mockVersion);
    mockTx.document.update.mockResolvedValue({ ...mockDocument, currentVersionId: 'ver-1' });
    mockTx.event.create.mockResolvedValue({});
  });

  it('returns 200 with updated document on successful rollback', async () => {
    const res = await POST(makeRequest(), makeContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.currentVersionId).toBe('ver-1');
    expect(body.version.id).toBe('ver-1');
    expect(mockTx.document.update).toHaveBeenCalled();
    expect(mockTx.event.create).toHaveBeenCalled();
  });

  it('returns 404 if version not found', async () => {
    mockTx.documentVersion.findFirst.mockResolvedValue(null);
    const res = await POST(makeRequest(), makeContext());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Version not found');
  });

  it('returns 400 if version is already current', async () => {
    mockTx.document.findFirst.mockResolvedValue({ ...mockDocument, currentVersionId: 'ver-1' });
    const res = await POST(makeRequest(), makeContext());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already the current version/);
  });

  it('returns 400 if version scanStatus is not CLEAN', async () => {
    mockTx.documentVersion.findFirst.mockResolvedValue({ ...mockVersion, scanStatus: 'INFECTED' });
    const res = await POST(makeRequest(), makeContext());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/virus scanning/);
  });

  it('returns 403 for non-admin users', async () => {
    mockSession.organization.role = 'MEMBER';
    const res = await POST(makeRequest(), makeContext());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Admin access required');
  });
});
