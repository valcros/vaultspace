import { describe, expect, it } from 'vitest';

import { prepareImportPaths, validateImportPaths } from './folderImport';

describe('validateImportPaths (Path B contract scaffold)', () => {
  it('returns ok for a batch of valid paths', () => {
    const result = validateImportPaths([
      'Financials/2025/Q3/cash.pdf',
      'Legal/Contracts/Customer/msa.pdf',
    ]);
    expect(result.ok).toBe(true);
  });

  it('returns the documented FOLDER_DEPTH_EXCEEDED envelope on violation', () => {
    const result = validateImportPaths(['Legal/Contracts/Customer/Enterprise/NDA.pdf']);
    if (result.ok) {
      throw new Error('expected validation to fail');
    }
    expect(result.response.error.code).toBe('FOLDER_DEPTH_EXCEEDED');
    expect(result.response.error.status).toBe(400);
    expect(result.response.error.details.operation).toBe('import');
    expect(result.response.error.details.maxDepth).toBe(3);
    expect(result.response.error.details.rejections).toHaveLength(1);
    expect(result.response.error.details.rejections[0]?.attemptedDepth).toBe(4);
  });

  it('reports every offending path so the import dialog can surface them inline', () => {
    const result = validateImportPaths([
      'Financials/2025/Q3/cash.pdf',
      'Legal/Contracts/Customer/Enterprise/NDA.pdf',
      'HR/Employees/Departed/Vested/severance.pdf',
    ]);
    if (result.ok) {
      throw new Error('expected validation to fail');
    }
    expect(result.response.error.details.rejections).toHaveLength(2);
  });
});

describe('folder import manifest', () => {
  it('counts the destination folder depth and reports the original source path', () => {
    const result = validateImportPaths(['Q3/Reports/cash.pdf'], 2);
    if (result.ok) {
      throw new Error('expected validation to fail');
    }
    expect(result.response.error.details.rejections).toEqual([
      {
        sourcePath: 'Q3/Reports/cash.pdf',
        attemptedDepth: 4,
        reason: 'Folder path exceeds maximum depth',
      },
    ]);
    expect(result.response.error.message).toContain('depth of 3');
  });

  it('rejects duplicate and mismatched file paths before writing anything', () => {
    const result = prepareImportPaths(
      ['Financials/a.pdf', 'Financials/a.pdf', 'Legal/other.pdf'],
      ['a.pdf', 'a.pdf', 'wrong.pdf']
    );
    expect(result.issues).toEqual([
      { sourcePath: 'Financials/a.pdf', reason: 'The selection contains this path more than once' },
      {
        sourcePath: 'Legal/other.pdf',
        reason: 'Path must end with the selected file name (max 255 characters)',
      },
    ]);
  });

  it('rejects traversal and invalid folder characters', () => {
    const result = prepareImportPaths(['../private/a.pdf', 'Bad?Name/b.pdf'], ['a.pdf', 'b.pdf']);
    expect(result.depthError?.error.code).toBe('FOLDER_DEPTH_EXCEEDED');
    expect(result.issues).toHaveLength(2);
  });
});
