/**
 * Admin Document Download API — scan-gate coverage.
 *
 * The admin download route selects the latest version and 403s if it is not
 * servable (never silently falling back). These tests assert that an INFECTED /
 * still-scanning latest version yields 403, no bytes are read, and the download
 * is not counted -- and that CLEAN / SKIPPED are served.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSession = { userId: 'user-1', organizationId: 'org-1' };
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(() => Promise.resolve(mockSession)),
}));

const mockStorage = { exists: vi.fn(), get: vi.fn() };
vi.mock('@/providers', () => ({
  getProviders: () => ({ storage: mockStorage }),
}));

const mockTx = {
  room: { findFirst: vi.fn() },
  document: { findFirst: vi.fn(), update: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET } from './route';

function makeRequest(): NextRequest {
  return new NextRequest(
    new URL('http://localhost:3000/api/rooms/room-1/documents/doc-1/download')
  );
}
function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1', documentId: 'doc-1' }) };
}

function makeDocument(scanStatus: string) {
  return {
    id: 'doc-1',
    name: 'file.pdf',
    mimeType: 'application/pdf',
    versions: [
      {
        scanStatus,
        fileBlob: { storageKey: 'documents/org-1/file.pdf', storageBucket: 'documents' },
      },
    ],
  };
}

describe('GET /api/rooms/:roomId/documents/:documentId/download — scan gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.room.findFirst.mockResolvedValue({ id: 'room-1', organizationId: 'org-1' });
    mockTx.document.update.mockResolvedValue({});
    mockStorage.exists.mockResolvedValue(true);
    mockStorage.get.mockResolvedValue(Buffer.from('original-bytes'));
  });

  it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
    'returns 403, reads no bytes, and does not count the download for a %s latest version',
    async (scanStatus) => {
      mockTx.document.findFirst.mockResolvedValue(makeDocument(scanStatus));

      const res = await GET(makeRequest(), makeContext());

      expect(res.status).toBe(403);
      expect(mockStorage.get).not.toHaveBeenCalled();
      expect(mockTx.document.update).not.toHaveBeenCalled();
    }
  );

  it('serves a CLEAN latest version (200, bytes read, download counted)', async () => {
    mockTx.document.findFirst.mockResolvedValue(makeDocument('CLEAN'));

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorage.get).toHaveBeenCalledWith('documents', 'documents/org-1/file.pdf');
    expect(mockTx.document.update).toHaveBeenCalled();
  });

  it('serves a SKIPPED (allowed-but-unscanned) latest version (200)', async () => {
    mockTx.document.findFirst.mockResolvedValue(makeDocument('SKIPPED'));

    const res = await GET(makeRequest(), makeContext());

    expect(res.status).toBe(200);
    expect(mockStorage.get).toHaveBeenCalled();
  });
});
