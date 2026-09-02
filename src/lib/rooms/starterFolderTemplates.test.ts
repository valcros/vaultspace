import { describe, expect, it } from 'vitest';

import { getBuiltInRoomTemplate, resolveStarterFolderSelection } from './starterFolderTemplates';

describe('starter folder selection', () => {
  const investorFolders = getBuiltInRoomTemplate('investor-data-room')!.structure.folders;

  it('adds required parents when a user selects only a child folder', () => {
    const result = resolveStarterFolderSelection(investorFolders, [
      '/financials/historical-financials',
    ]);

    expect(result).toEqual({
      ok: true,
      folders: [
        { name: 'Financials', path: '/financials' },
        { name: 'Historical Financials', path: '/financials/historical-financials' },
      ],
    });
  });

  it('allows an intentionally empty selection', () => {
    expect(resolveStarterFolderSelection(investorFolders, [])).toEqual({ ok: true, folders: [] });
  });

  it('rejects a client-injected folder path', () => {
    expect(
      resolveStarterFolderSelection(investorFolders, ['/financials', '/private-records'])
    ).toEqual({
      ok: false,
      error: 'The selected folders do not belong to this template',
    });
  });

  it('rejects malformed or too-deep custom templates before any folder is created', () => {
    expect(
      resolveStarterFolderSelection(
        [
          { name: 'A', path: '/a' },
          { name: 'B', path: '/a/b' },
          { name: 'C', path: '/a/b/c' },
          { name: 'D', path: '/a/b/c/d' },
        ],
        ['/a']
      )
    ).toEqual({ ok: false, error: 'The selected folder template has an invalid structure' });
  });
});
