import { describe, expect, it } from 'vitest';

import {
  FolderDepthExceededError,
  MAX_FOLDER_DEPTH,
  getFolderDepth,
  getImportFolderDepth,
  getProposedChildDepth,
  normalizeImportPath,
  validateFolderCreateDepth,
  validateFolderMoveDepth,
  validateImportDepth,
} from './folderDepth';

describe('getFolderDepth', () => {
  it('returns 0 for empty or root paths', () => {
    expect(getFolderDepth('')).toBe(0);
    expect(getFolderDepth('/')).toBe(0);
  });

  it('returns 1 for top-level folders', () => {
    expect(getFolderDepth('/Financials')).toBe(1);
  });

  it('returns 2 for mid-level folders', () => {
    expect(getFolderDepth('/Financials/2025')).toBe(2);
  });

  it('returns 3 for leaf-level folders', () => {
    expect(getFolderDepth('/Financials/2025/Q3')).toBe(3);
  });

  it('ignores trailing slashes', () => {
    expect(getFolderDepth('/Financials/2025/')).toBe(2);
  });
});

describe('getProposedChildDepth', () => {
  it('returns 1 when parent is null', () => {
    expect(getProposedChildDepth(null)).toBe(1);
    expect(getProposedChildDepth(undefined)).toBe(1);
    expect(getProposedChildDepth('')).toBe(1);
  });

  it('returns parent depth + 1', () => {
    expect(getProposedChildDepth('/Financials')).toBe(2);
    expect(getProposedChildDepth('/Financials/2025')).toBe(3);
    expect(getProposedChildDepth('/Financials/2025/Q3')).toBe(4);
  });
});

describe('validateFolderCreateDepth', () => {
  it('allows creation at depth 1, 2, and 3', () => {
    expect(() => validateFolderCreateDepth(null, null)).not.toThrow();
    expect(() => validateFolderCreateDepth('/Financials', 'fld_1')).not.toThrow();
    expect(() => validateFolderCreateDepth('/Financials/2025', 'fld_2')).not.toThrow();
  });

  it('rejects creation at depth 4 with FolderDepthExceededError', () => {
    let caught: FolderDepthExceededError | null = null;
    try {
      validateFolderCreateDepth('/Financials/2025/Q3', 'fld_3');
    } catch (err) {
      caught = err as FolderDepthExceededError;
    }
    expect(caught).toBeInstanceOf(FolderDepthExceededError);
    expect(caught?.code).toBe('FOLDER_DEPTH_EXCEEDED');
    expect(caught?.maxDepth).toBe(MAX_FOLDER_DEPTH);
    expect(caught?.attemptedDepth).toBe(4);
    expect(caught?.operation).toBe('create');
    expect(caught?.parentFolderId).toBe('fld_3');
  });
});

describe('validateFolderMoveDepth', () => {
  it('allows a depth-1 folder to move under a depth-2 parent', () => {
    expect(() => validateFolderMoveDepth('/HR', '/Financials/2025', [])).not.toThrow();
  });

  it('rejects when the moved node would land at depth 4', () => {
    let caught: FolderDepthExceededError | null = null;
    try {
      validateFolderMoveDepth('/HR', '/Financials/2025/Q3', []);
    } catch (err) {
      caught = err as FolderDepthExceededError;
    }
    expect(caught).toBeInstanceOf(FolderDepthExceededError);
    expect(caught?.attemptedDepth).toBe(4);
    expect(caught?.operation).toBe('move');
  });

  it('rejects when descendants would be pushed past the cap', () => {
    expect(() =>
      validateFolderMoveDepth('/Financials', '/Legal', ['/Financials/2025', '/Financials/2025/Q3'])
    ).toThrow(FolderDepthExceededError);
  });

  it('allows moves where the deepest descendant lands exactly at depth 3', () => {
    expect(() =>
      validateFolderMoveDepth('/Financials', null, ['/Financials/2025', '/Financials/2025/Q3'])
    ).not.toThrow();
  });
});

describe('normalizeImportPath', () => {
  it('trims and removes leading/trailing slashes', () => {
    expect(normalizeImportPath('/Financials/2025/cash.pdf')).toBe('Financials/2025/cash.pdf');
    expect(normalizeImportPath('Financials/2025/cash.pdf/')).toBe('Financials/2025/cash.pdf');
  });

  it('collapses repeated separators', () => {
    expect(normalizeImportPath('Financials///2025/cash.pdf')).toBe('Financials/2025/cash.pdf');
  });

  it('translates backslashes to forward slashes', () => {
    expect(normalizeImportPath('Financials\\2025\\cash.pdf')).toBe('Financials/2025/cash.pdf');
  });

  it('rejects traversal segments', () => {
    expect(() => normalizeImportPath('Financials/../etc/passwd')).toThrow();
    expect(() => normalizeImportPath('Financials/./inner')).toThrow();
  });
});

describe('getImportFolderDepth', () => {
  it('returns 0 for a single file at room root', () => {
    expect(getImportFolderDepth('cash.pdf')).toBe(0);
  });

  it('returns 1 for a file directly under one folder', () => {
    expect(getImportFolderDepth('Financials/cash.pdf')).toBe(1);
  });

  it('returns 3 for a file three levels deep', () => {
    expect(getImportFolderDepth('Financials/2025/Q3/cash.pdf')).toBe(3);
  });
});

describe('validateImportDepth', () => {
  it('accepts paths within the depth cap', () => {
    expect(() =>
      validateImportDepth(['Financials/2025/Q3/cash.pdf', 'Legal/Contracts/Customer/msa.pdf'])
    ).not.toThrow();
  });

  it('rejects atomically when any path exceeds the cap', () => {
    let caught: FolderDepthExceededError | null = null;
    try {
      validateImportDepth([
        'Financials/2025/Q3/cash.pdf',
        'Legal/Contracts/Customer/Enterprise/NDA.pdf',
        'HR/Employees/Departed/Vested/severance.pdf',
      ]);
    } catch (err) {
      caught = err as FolderDepthExceededError;
    }
    expect(caught).toBeInstanceOf(FolderDepthExceededError);
    expect(caught?.operation).toBe('import');
    expect(caught?.rejections).toHaveLength(2);
    expect(caught?.rejections?.[0]?.sourcePath).toContain('Enterprise');
    expect(caught?.rejections?.[1]?.sourcePath).toContain('Vested');
  });

  it('flags traversal attempts as invalid', () => {
    expect(() => validateImportDepth(['Financials/../secret/cash.pdf'])).toThrow(
      FolderDepthExceededError
    );
  });
});
