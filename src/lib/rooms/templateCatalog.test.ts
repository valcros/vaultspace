import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {} }));
import { systemRoomTemplateService, templateRevision } from '@/services/SystemRoomTemplateService';
import { legacyTemplateProjection, resolveRoomTemplate } from './templateCatalog';
const tenantTemplate = {
  id: 'legacy',
  name: 'Legacy',
  description: null,
  category: 'custom',
  folderStructure: { folders: [{ name: 'Legal', path: '/legal' }] },
};
const findFirst = vi.fn();
const tx = { roomTemplate: { findFirst } } as unknown as Prisma.TransactionClient;
beforeEach(() => {
  vi.restoreAllMocks();
  mocks.get.mockReset();
  findFirst.mockReset();
  vi.spyOn(systemRoomTemplateService, 'get').mockImplementation(mocks.get);
});
describe('room template catalog boundary', () => {
  it('preserves authorized legacy templates with an exact tenant filter', async () => {
    mocks.get.mockResolvedValue(null);
    findFirst.mockResolvedValue(tenantTemplate);
    const value = legacyTemplateProjection(tenantTemplate);
    expect(await resolveRoomTemplate(tx, 'org-a', 'legacy', value.revision)).toEqual(value);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'legacy', organizationId: 'org-a' } });
  });
  it('rejects foreign legacy IDs rather than considering public/system flags', async () => {
    mocks.get.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
    await expect(resolveRoomTemplate(tx, 'org-a', 'foreign', 'rev')).rejects.toMatchObject({
      status: 404,
    });
  });
  it('never resurrects a disabled system template through tenant fallback', async () => {
    mocks.get.mockResolvedValue({ id: 'builtin', enabled: false, revision: 'r' });
    await expect(resolveRoomTemplate(tx, 'org-a', 'builtin', 'r')).rejects.toMatchObject({
      status: 409,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('fails closed on a catalog outage', async () => {
    mocks.get.mockRejectedValue(new Error('unavailable'));
    await expect(resolveRoomTemplate(tx, 'org-a', 'builtin', 'r')).rejects.toThrow('unavailable');
    expect(findFirst).not.toHaveBeenCalled();
  });
  it.each([undefined, 'old'])(
    'rejects missing or stale selection revision %s',
    async (revision) => {
      mocks.get.mockResolvedValue({ id: 'builtin', enabled: true, revision: 'current' });
      await expect(resolveRoomTemplate(tx, 'org-a', 'builtin', revision)).rejects.toMatchObject({
        status: 409,
      });
    }
  );
  it('detects a rename at an unchanged path in legacy content', () => {
    expect(legacyTemplateProjection(tenantTemplate).revision).not.toBe(
      legacyTemplateProjection({
        ...tenantTemplate,
        folderStructure: { folders: [{ name: 'Legal files', path: '/legal' }] },
      }).revision
    );
    expect(templateRevision({ b: 1, a: 2 })).toBe(templateRevision({ a: 2, b: 1 }));
  });
});
