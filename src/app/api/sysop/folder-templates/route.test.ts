import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/lib/middleware', () => ({
  requirePlatformOperator: mocks.guard,
  getRequestContext: () => ({ requestId: 'req-test' }),
}));
vi.mock('@/lib/db', () => ({ db: {} }));
import {
  systemRoomTemplateService,
  SystemRoomTemplateError,
} from '@/services/SystemRoomTemplateService';
import { GET, POST } from './route';
import { PATCH } from './[id]/route';
const input = {
  name: 'Shared',
  category: 'custom',
  enabled: true,
  structure: { folders: [{ name: 'Legal', path: '/legal' }] },
};
const context = { params: Promise.resolve({ id: 'sys-test' }) };
function request(body: unknown) {
  return new NextRequest('https://example.test/api/sysop/folder-templates', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: 'operator' });
  vi.spyOn(systemRoomTemplateService, 'list').mockImplementation(mocks.list);
  vi.spyOn(systemRoomTemplateService, 'create').mockImplementation(mocks.create);
  vi.spyOn(systemRoomTemplateService, 'update').mockImplementation(mocks.update);
});
describe('system folder template routes', () => {
  it.each([
    ['anonymous', 401],
    ['org-admin', 403],
    ['viewer', 403],
    ['revoked', 403],
    ['blocked-ip', 403],
  ])('rejects %s on every endpoint before catalog access', async (role, status) => {
    mocks.guard.mockRejectedValue(
      status === 401 ? new AuthenticationError() : new AuthorizationError(String(role))
    );
    expect((await GET()).status).toBe(status);
    expect((await POST(request(input))).status).toBe(status);
    expect((await PATCH(request({ ...input, expectedRevision: 'r' }), context)).status).toBe(
      status
    );
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('includes disabled templates for operators and forbids caching', async () => {
    mocks.list.mockResolvedValue([]);
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(mocks.list).toHaveBeenCalledWith(true);
  });
  it('passes validated input and actor to the mutation service', async () => {
    mocks.create.mockResolvedValue({ id: 'sys-new' });
    expect((await POST(request(input))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      {
        name: 'Shared',
        category: 'custom',
        enabled: true,
        description: '',
        folders: input.structure.folders,
      },
      { actorUserId: 'operator', requestId: 'req-test' }
    );
  });
  it('rejects oversized and unknown-field input without mutation', async () => {
    expect((await POST(request({ ...input, description: 'x'.repeat(132000) }))).status).toBe(413);
    expect((await POST(request({ ...input, organizationId: 'evil' }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('requires the reviewed revision to update', async () => {
    expect((await PATCH(request(input), context)).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('surfaces a conflict without pretending the save succeeded', async () => {
    mocks.update.mockRejectedValue(new SystemRoomTemplateError(409, 'Reload'));
    const r = await PATCH(request({ ...input, expectedRevision: 'old' }), context);
    expect(r.status).toBe(409);
  });
});
