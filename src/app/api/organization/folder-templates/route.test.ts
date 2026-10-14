import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthenticationError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/lib/middleware', () => ({
  requireAuth: mocks.auth,
  getRequestContext: () => ({ requestId: 'request-1' }),
}));
vi.mock('@/lib/db', () => ({ db: {} }));

import { organizationRoomTemplateService } from '@/services/OrganizationRoomTemplateService';
import { SystemRoomTemplateError } from '@/services/SystemRoomTemplateService';
import { GET, POST } from './route';
import { PATCH } from './[id]/route';

const input = {
  name: 'Operations',
  category: 'operations',
  enabled: true,
  structure: { folders: [{ name: 'Legal', path: '/legal' }] },
};
function request(body: unknown) {
  return new NextRequest('https://example.test/api/organization/folder-templates', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
const context = { params: Promise.resolve({ id: 'org-template-1' }) };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    organizationId: 'org-a',
    organization: { role: 'ADMIN' },
    userId: 'admin-1',
    user: { email: 'admin@example.test' },
  });
  vi.spyOn(organizationRoomTemplateService, 'list').mockImplementation(mocks.list);
  vi.spyOn(organizationRoomTemplateService, 'create').mockImplementation(mocks.create);
  vi.spyOn(organizationRoomTemplateService, 'update').mockImplementation(mocks.update);
});

describe('organization folder template routes', () => {
  it('rejects anonymous and viewer requests before service access', async () => {
    mocks.auth.mockRejectedValueOnce(new AuthenticationError());
    expect((await GET()).status).toBe(401);
    mocks.auth.mockResolvedValue({ organization: { role: 'VIEWER' } });
    expect((await GET()).status).toBe(403);
    expect((await POST(request(input))).status).toBe(403);
    expect((await PATCH(request({ ...input, expectedRevision: 'old' }), context)).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('lists disabled templates only within the active organization and disables caching', async () => {
    mocks.list.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.list).toHaveBeenCalledWith('org-a', true);
  });

  it('passes validated input and actor attribution', async () => {
    mocks.create.mockResolvedValue({ id: 'org-new' });
    expect((await POST(request(input))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      {
        name: 'Operations',
        category: 'operations',
        enabled: true,
        description: '',
        folders: input.structure.folders,
      },
      {
        organizationId: 'org-a',
        userId: 'admin-1',
        userEmail: 'admin@example.test',
        requestId: 'request-1',
      }
    );
  });

  it('requires reviewed revision and maps foreign IDs and stale edits', async () => {
    expect((await PATCH(request(input), context)).status).toBe(409);
    mocks.update.mockRejectedValueOnce(new SystemRoomTemplateError(404, 'not found'));
    expect((await PATCH(request({ ...input, expectedRevision: 'r1' }), context)).status).toBe(404);
    expect(mocks.update).toHaveBeenCalledWith(
      'org-template-1',
      expect.objectContaining({ name: input.name }),
      'r1',
      expect.objectContaining({ organizationId: 'org-a' })
    );
  });

  it('rejects invalid structures before mutation', async () => {
    const response = await POST(
      request({ ...input, structure: { folders: [{ name: 'Bad', path: '/bad/child' }] } })
    );
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
