import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '@/lib/errors';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), org: vi.fn(), legacy: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/middleware', () => ({ requireAuth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: {}, withOrgContext: mocks.org }));
import { systemRoomTemplateService } from '@/services/SystemRoomTemplateService';
import { GET, POST } from './route';
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ organizationId: 'org-a', organization: { role: 'ADMIN' } });
  mocks.org.mockImplementation((_org, fn) => fn({ roomTemplate: { findMany: mocks.legacy } }));
  vi.spyOn(systemRoomTemplateService, 'list').mockImplementation(mocks.list);
});
describe('organization template consumption', () => {
  it('rejects organization authoring without reading or writing the database', async () => {
    expect((await POST()).status).toBe(403);
    expect(mocks.org).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    mocks.auth.mockRejectedValue(new AuthenticationError());
    expect((await GET()).status).toBe(401);
    expect((await POST()).status).toBe(401);
  });
  it('suppresses disabled globals and legacy ID shadowing', async () => {
    mocks.list.mockResolvedValue([
      { id: 'builtin', enabled: false },
      { id: 'sys-enabled', enabled: true },
    ]);
    mocks.legacy.mockResolvedValue([
      { id: 'builtin' },
      {
        id: 'own',
        name: 'Own',
        description: null,
        category: 'old',
        folderStructure: { folders: [] },
      },
    ]);
    const response = await GET();
    const data = await response.json();
    expect(data.templates.map((t: { id: string }) => t.id)).toEqual(['sys-enabled', 'own']);
    expect(mocks.legacy).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
      orderBy: { name: 'asc' },
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('does not return bundled defaults during a catalog outage', async () => {
    mocks.list.mockRejectedValue(new Error('database unavailable'));
    expect((await GET()).status).toBe(500);
  });
});
