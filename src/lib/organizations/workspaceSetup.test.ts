import { describe, expect, it } from 'vitest';

import {
  isClaimableWorkspaceSlug,
  isProvisionalWorkspaceSlug,
  suggestWorkspaceSlug,
} from './workspaceSetup';

describe('workspace setup slug contract', () => {
  it('recognizes only the internal self-service provisional slug format', () => {
    expect(isProvisionalWorkspaceSlug('org-1756789012345-abc12')).toBe(true);
    expect(isProvisionalWorkspaceSlug('acme-holdings')).toBe(false);
    expect(isProvisionalWorkspaceSlug('org-not-a-timestamp-abc12')).toBe(false);
  });

  it('accepts DNS-safe customer workspace labels and rejects reserved or malformed labels', () => {
    expect(isClaimableWorkspaceSlug('acme-holdings')).toBe(true);
    expect(isClaimableWorkspaceSlug('api')).toBe(false);
    expect(isClaimableWorkspaceSlug('-acme')).toBe(false);
    expect(isClaimableWorkspaceSlug('acme-')).toBe(false);
    expect(isClaimableWorkspaceSlug('Acme')).toBe(false);
  });

  it('suggests a normalized URL label from the organization name', () => {
    expect(suggestWorkspaceSlug('Acme Holdings, Inc.')).toBe('acme-holdings-inc');
    expect(suggestWorkspaceSlug('API')).toBe('api-workspace');
    expect(suggestWorkspaceSlug('!!')).toBe('my-workspace');
  });

  it('keeps a truncated suggestion claimable when truncation would end in a hyphen', () => {
    const suggestion = suggestWorkspaceSlug(`${'a'.repeat(62)}-b`);

    expect(suggestion).toBe('a'.repeat(62));
    expect(isClaimableWorkspaceSlug(suggestion)).toBe(true);
  });
});
