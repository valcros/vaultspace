import { describe, expect, it } from 'vitest';

import { validateImportPaths } from './folderImport';

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
