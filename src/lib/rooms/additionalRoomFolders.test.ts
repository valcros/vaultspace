import { describe, expect, it } from 'vitest';

import { resolveAdditionalRoomFolders } from './additionalRoomFolders';

const template = [
  { name: 'Financials', path: '/financials' },
  { name: 'Historical Financials', path: '/financials/historical-financials' },
];

describe('room-specific folder resolution', () => {
  it('combines template, root, and nested room-only folders without changing the template', () => {
    const result = resolveAdditionalRoomFolders(template, [
      { name: '2026 Plans', parentPath: '/financials' },
      { name: 'Board Drafts', parentPath: '/financials/2026 Plans' },
      { name: 'Private Notes', parentPath: null },
    ]);

    expect(result).toEqual({
      ok: true,
      folders: [
        ...template,
        { name: '2026 Plans', path: '/financials/2026 Plans' },
        { name: 'Board Drafts', path: '/financials/2026 Plans/Board Drafts' },
        { name: 'Private Notes', path: '/Private Notes' },
      ],
    });
    expect(template).toHaveLength(2);
  });

  it.each([
    [{ name: 'financials', parentPath: null }, 'already exists'],
    [{ name: 'HISTORICAL FINANCIALS', parentPath: '/financials' }, 'already exists'],
    [{ name: 'Unknown Child', parentPath: '/missing' }, 'not selected'],
    [{ name: 'Too Deep', parentPath: '/financials/historical-financials/leaf' }, 'not selected'],
    [{ name: 'Bad/Name', parentPath: null }, 'invalid'],
  ])('rejects invalid addition %j', (addition, message) => {
    const result = resolveAdditionalRoomFolders(template, [addition]);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain(message);
    }
  });

  it('rejects a fourth level and a tree over the folder cap', () => {
    const tooDeep = resolveAdditionalRoomFolders(template, [
      { name: 'Third', parentPath: '/financials/historical-financials' },
      { name: 'Fourth', parentPath: '/financials/historical-financials/Third' },
    ]);
    expect(tooDeep).toMatchObject({ ok: false, error: expect.stringContaining('3 levels') });

    const tooMany = resolveAdditionalRoomFolders(
      Array.from({ length: 100 }, (_, index) => ({
        name: `Folder ${index}`,
        path: `/folder-${index}`,
      })),
      [{ name: 'One More', parentPath: null }]
    );
    expect(tooMany).toMatchObject({ ok: false, error: expect.stringContaining('at most 100') });
  });

  it('keeps generated paths within the database column limit', () => {
    const longParent = `/${'a'.repeat(900)}`;
    const result = resolveAdditionalRoomFolders(
      [{ name: 'Long parent', path: longParent }],
      [{ name: 'b'.repeat(120), parentPath: longParent }]
    );
    expect(result).toMatchObject({ ok: false, error: 'Custom folder path is too long' });
  });
});
