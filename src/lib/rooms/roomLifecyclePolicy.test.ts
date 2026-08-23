import { describe, expect, it, vi } from 'vitest';

import { isRoomMutable, requireMutableRoom } from './roomLifecyclePolicy';

const room = (status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'CLOSED') =>
  ({ id: 'room-1', organizationId: 'org-1', status }) as never;

describe('roomLifecyclePolicy', () => {
  it.each([
    ['DRAFT', true],
    ['ACTIVE', true],
    ['ARCHIVED', false],
    ['CLOSED', false],
  ] as const)('defines %s mutability as %s', (status, expected) => {
    expect(isRoomMutable(status)).toBe(expected);
  });

  it('returns a non-disclosing not-found result for a missing room', async () => {
    const tx = { room: { findFirst: vi.fn().mockResolvedValue(null) } } as never;

    await expect(requireMutableRoom(tx, 'org-1', 'missing')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Room not found',
    });
  });

  it.each(['ARCHIVED', 'CLOSED'] as const)('rejects %s room mutations', async (status) => {
    const tx = { room: { findFirst: vi.fn().mockResolvedValue(room(status)) } } as never;

    await expect(requireMutableRoom(tx, 'org-1', 'room-1')).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'This room is not available for changes',
      code: 'ROOM_NOT_MUTABLE',
    });
  });

  it.each(['DRAFT', 'ACTIVE'] as const)(
    'permits %s administrator setup mutations',
    async (status) => {
      const tx = { room: { findFirst: vi.fn().mockResolvedValue(room(status)) } } as never;

      await expect(requireMutableRoom(tx, 'org-1', 'room-1')).resolves.toMatchObject({
        ok: true,
        room: { status },
      });
    }
  );
});
