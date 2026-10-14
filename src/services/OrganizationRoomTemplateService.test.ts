import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    userOrganization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    roomTemplate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    event: { create: vi.fn() },
  };
  return { tx, withOrgContext: vi.fn() };
});
vi.mock('@/lib/db', () => ({
  db: {},
  withOrgContext: mocks.withOrgContext,
}));

import { organizationRoomTemplateService } from './OrganizationRoomTemplateService';

const input = {
  name: 'Operations',
  description: '',
  category: 'operations',
  enabled: true,
  folders: [{ name: 'Legal', path: '/legal' }],
};
const actor = {
  organizationId: 'org-a',
  userId: 'admin-1',
  userEmail: 'admin@example.test',
  requestId: 'request-1',
};
const row = {
  id: 'org-template-1',
  organizationId: 'org-a',
  name: input.name,
  description: input.description,
  category: input.category,
  folderStructure: { folders: input.folders },
  enabled: true,
  revision: 1,
  isSystemTemplate: false,
  isPublic: false,
  defaultPermissions: null,
  defaultSettings: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.withOrgContext.mockImplementation((_org, fn) => fn(mocks.tx));
  mocks.tx.userOrganization.findUnique.mockResolvedValue({
    role: 'ADMIN',
    isActive: true,
    archivedAt: null,
  });
  mocks.tx.user.findUnique.mockResolvedValue({ isActive: true });
  mocks.tx.roomTemplate.findMany.mockResolvedValue([row]);
  mocks.tx.roomTemplate.findFirst.mockResolvedValue(row);
  mocks.tx.roomTemplate.create.mockImplementation(({ data }) =>
    Promise.resolve({ ...row, ...data })
  );
  mocks.tx.roomTemplate.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.event.create.mockResolvedValue({ id: 'event-1' });
});

describe('organization folder templates', () => {
  it('lists only the requested organization and hides disabled templates from selection', async () => {
    await organizationRoomTemplateService.list('org-a');
    expect(mocks.withOrgContext).toHaveBeenCalledWith('org-a', expect.any(Function));
    expect(mocks.tx.roomTemplate.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', enabled: true },
      orderBy: { name: 'asc' },
    });
  });

  it('creates tenant-owned records without global flags and audits in the same transaction', async () => {
    const created = await organizationRoomTemplateService.create(input, actor);
    expect(created.id).toMatch(/^org-/);
    expect(mocks.tx.roomTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        isPublic: false,
        isSystemTemplate: false,
        folderStructure: { folders: input.folders },
      }),
    });
    expect(mocks.tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        eventType: 'ROOM_TEMPLATE_CREATED',
        actorId: 'admin-1',
        requestId: 'request-1',
        metadata: expect.objectContaining({ templateId: created.id, revision: 1 }),
      }),
    });
  });

  it.each([
    { role: 'VIEWER', isActive: true, archivedAt: null },
    { role: 'ADMIN', isActive: false, archivedAt: null },
    { role: 'ADMIN', isActive: true, archivedAt: new Date() },
    null,
  ])('rejects revoked or non-admin members before a write', async (membership) => {
    mocks.tx.userOrganization.findUnique.mockResolvedValue(membership);
    await expect(organizationRoomTemplateService.create(input, actor)).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.tx.roomTemplate.create).not.toHaveBeenCalled();
  });

  it('does not update a foreign template ID', async () => {
    mocks.tx.roomTemplate.findFirst.mockResolvedValue(null);
    await expect(
      organizationRoomTemplateService.update('foreign', input, 'revision', actor)
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.tx.roomTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', organizationId: 'org-a' },
    });
    expect(mocks.tx.roomTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('requires the current revision and rejects a lost compare-and-swap', async () => {
    const [current] = await organizationRoomTemplateService.list('org-a', true);
    await expect(
      organizationRoomTemplateService.update(row.id, input, 'stale', actor)
    ).rejects.toMatchObject({ status: 409 });
    mocks.tx.roomTemplate.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      organizationRoomTemplateService.update(row.id, input, current!.revision, actor)
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.tx.roomTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, organizationId: 'org-a', revision: 1 },
      data: expect.objectContaining({ revision: { increment: 1 } }),
    });
    expect(mocks.tx.event.create).not.toHaveBeenCalled();
  });

  it('increments revision and records a disabled snapshot', async () => {
    const [current] = await organizationRoomTemplateService.list('org-a', true);
    const saved = await organizationRoomTemplateService.update(
      row.id,
      { ...input, enabled: false },
      current!.revision,
      actor
    );
    expect(saved.enabled).toBe(false);
    expect(saved.revision).not.toBe(current!.revision);
    expect(mocks.tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'ROOM_TEMPLATE_UPDATED',
        metadata: expect.objectContaining({
          templateId: row.id,
          revision: 2,
          priorRevision: current!.revision,
        }),
      }),
    });
  });

  it('surfaces audit failure so the transaction can roll back', async () => {
    mocks.tx.event.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(organizationRoomTemplateService.create(input, actor)).rejects.toThrow(
      'audit unavailable'
    );
    expect(mocks.withOrgContext).toHaveBeenCalledTimes(1);
  });
});
