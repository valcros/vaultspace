import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockTx = {
  room: { findFirst: vi.fn() },
  document: { findFirst: vi.fn() },
};

vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'ADMIN' },
  })),
}));

vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(async (_orgId: string, callback: (tx: typeof mockTx) => unknown) =>
    callback(mockTx)
  ),
}));

import { GET } from './route';

function makeContext() {
  return { params: Promise.resolve({ roomId: 'room-1', documentId: 'doc-1' }) };
}

describe('GET /api/rooms/:roomId/documents/:documentId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.room.findFirst.mockResolvedValue({ id: 'room-1' });
  });

  it('serializes BigInt columns instead of throwing (regression: ?doc= deep links)', async () => {
    // Raw Prisma document rows carry BigInt fields; JSON.stringify throws on
    // BigInt, which made this route 500 and silently killed deep links.
    mockTx.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      name: 'Pitch Deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: BigInt(5242880),
      versions: [
        {
          id: 'ver-1',
          versionNumber: 1,
          fileSizeBytes: BigInt(5242880),
          previewAssets: [],
        },
      ],
      folder: null,
    });

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/documents/doc-1');
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.document.id).toBe('doc-1');
    expect(body.document.fileSize).toBe(5242880);
    expect(body.document.versions[0].fileSizeBytes).toBe(5242880);
  });

  it('returns 404 when the document does not exist in the room', async () => {
    mockTx.document.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/rooms/room-1/documents/doc-x');
    const res = await GET(req, makeContext());

    expect(res.status).toBe(404);
  });
});
