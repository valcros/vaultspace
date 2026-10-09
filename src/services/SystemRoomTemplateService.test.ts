import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => {
  const tx = {
    user: { findUnique: vi.fn() },
    systemRoomTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    systemRoomTemplateRevision: { create: vi.fn() },
  };
  return { tx, transaction: vi.fn() };
});
vi.mock('@/lib/db', () => ({ db: { ...mocks.tx, $transaction: mocks.transaction } }));

import {
  assertTemplateRevision,
  systemRoomTemplateInputSchema,
  systemRoomTemplateService,
  templateRevision,
} from './SystemRoomTemplateService';

const input = {
  name: 'Operations',
  description: '',
  category: 'operations',
  enabled: true,
  folders: [{ name: 'Legal', path: '/legal' }],
};
const actor = { actorUserId: 'operator-1', requestId: 'request-1' };
const row = {
  ...input,
  id: 'sys-existing',
  revision: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mocks.tx));
  mocks.tx.user.findUnique.mockResolvedValue({ isActive: true, isPlatformOperator: true });
  mocks.tx.systemRoomTemplate.findMany.mockResolvedValue([]);
  mocks.tx.systemRoomTemplate.findUnique.mockResolvedValue(null);
  mocks.tx.systemRoomTemplate.create.mockImplementation(({ data }) =>
    Promise.resolve({ ...row, ...data })
  );
  mocks.tx.systemRoomTemplateRevision.create.mockResolvedValue({ id: 'audit-1' });
  mocks.tx.systemRoomTemplate.updateMany.mockResolvedValue({ count: 1 });
});

describe('SystemRoomTemplateService', () => {
  it('resolves builtins only when no override exists, including within a supplied transaction', async () => {
    const template = await systemRoomTemplateService.get(
      'investor-data-room',
      mocks.tx as unknown as Prisma.TransactionClient
    );
    expect(template).toMatchObject({
      id: 'investor-data-room',
      enabled: true,
      isGlobal: true,
      isCustom: false,
    });
    expect(template?.revision).toHaveLength(64);
    expect(await systemRoomTemplateService.get('unknown')).toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('keeps archived builtin overrides disabled without resurrecting fallback', async () => {
    const archived = { ...row, id: 'investor-data-room', enabled: false };
    mocks.tx.systemRoomTemplate.findMany.mockResolvedValue([archived]);
    mocks.tx.systemRoomTemplate.findUnique.mockResolvedValue(archived);
    expect((await systemRoomTemplateService.list()).some((t) => t.id === archived.id)).toBe(false);
    expect(
      (await systemRoomTemplateService.list(true)).find((t) => t.id === archived.id)
    ).toMatchObject({ enabled: false, name: input.name });
    expect(await systemRoomTemplateService.get(archived.id)).toMatchObject({ enabled: false });
  });

  it('propagates database failures instead of returning builtin fallback', async () => {
    const failure = new Error('database unavailable');
    mocks.tx.systemRoomTemplate.findUnique.mockRejectedValue(failure);
    mocks.tx.systemRoomTemplate.findMany.mockRejectedValue(failure);
    await expect(systemRoomTemplateService.get('investor-data-room')).rejects.toBe(failure);
    await expect(systemRoomTemplateService.list()).rejects.toBe(failure);
  });

  it.each([
    { ...input, name: ' ' },
    { ...input, description: 'x'.repeat(2001) },
    { ...input, category: '' },
    { ...input, folders: [] },
    {
      ...input,
      folders: Array.from({ length: 101 }, (_, n) => ({ name: String(n), path: `/folder-${n}` })),
    },
    { ...input, folders: [{ name: 'Bad', path: '/bad/path' }] },
    { ...input, folders: [{ name: 'Bad', path: '/Bad' }] },
    { ...input, folders: [input.folders[0]!, input.folders[0]!] },
    {
      ...input,
      folders: [
        { name: 'Legal', path: '/legal' },
        { name: 'legal', path: '/law' },
      ],
    },
    {
      ...input,
      folders: Array.from({ length: 6 }, (_, n) => ({
        name: String(n),
        path:
          '/' +
          Array(n + 1)
            .fill('folder')
            .join('/'),
      })),
    },
  ])('rejects invalid complete structures before mutation', async (invalid) => {
    expect(systemRoomTemplateInputSchema.safeParse(invalid).success).toBe(false);
    await expect(systemRoomTemplateService.create(invalid, actor)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('allows repeated folder names under different parents', () => {
    expect(
      systemRoomTemplateInputSchema.safeParse({
        ...input,
        folders: [
          { name: 'A', path: '/a' },
          { name: 'B', path: '/b' },
          { name: 'Evidence', path: '/a/evidence' },
          { name: 'Evidence', path: '/b/evidence' },
        ],
      }).success
    ).toBe(true);
  });

  it('creates server generated IDs and records an atomic snapshot with attribution', async () => {
    const created = await systemRoomTemplateService.create(input, actor);
    expect(created.id).toMatch(/^sys-/);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.systemRoomTemplateRevision.create).toHaveBeenCalledWith({
      data: {
        templateId: created.id,
        revision: 1,
        ...actor,
        snapshot: { ...created, priorRevision: null },
      },
    });
  });

  it.each([
    { isActive: false, isPlatformOperator: true },
    { isActive: true, isPlatformOperator: false },
    null,
  ])('rejects revoked or inactive operators before writes', async (user) => {
    mocks.tx.user.findUnique.mockResolvedValue(user);
    await expect(systemRoomTemplateService.create(input, actor)).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.tx.systemRoomTemplate.create).not.toHaveBeenCalled();
  });

  it('requires a matching revision for every update', async () => {
    await expect(
      systemRoomTemplateService.update('investor-data-room', input, undefined, actor)
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      systemRoomTemplateService.update('investor-data-room', input, 'stale', actor)
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.tx.systemRoomTemplate.create).not.toHaveBeenCalled();
  });

  it('rejects a lost CAS and records no audit revision', async () => {
    mocks.tx.systemRoomTemplate.findUnique.mockResolvedValue(row);
    const template = await systemRoomTemplateService.get(row.id);
    mocks.tx.systemRoomTemplate.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      systemRoomTemplateService.update(row.id, input, template!.revision, actor)
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.tx.systemRoomTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, revision: 1 },
      data: { ...input, revision: { increment: 1 } },
    });
    expect(mocks.tx.systemRoomTemplateRevision.create).not.toHaveBeenCalled();
  });

  it('maps concurrent first builtin override insert to conflict', async () => {
    const template = await systemRoomTemplateService.get('investor-data-room');
    mocks.tx.systemRoomTemplate.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      systemRoomTemplateService.update('investor-data-room', input, template!.revision, actor)
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.tx.systemRoomTemplateRevision.create).not.toHaveBeenCalled();
  });

  it('writes changed content with the previous revision in the same transaction', async () => {
    mocks.tx.systemRoomTemplate.findUnique.mockResolvedValue(row);
    const previous = await systemRoomTemplateService.get(row.id);
    const changed = await systemRoomTemplateService.update(
      row.id,
      { ...input, enabled: false },
      previous!.revision,
      actor
    );
    expect(changed.revision).not.toBe(previous!.revision);
    expect(mocks.tx.systemRoomTemplateRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revision: 2,
        snapshot: { ...changed, priorRevision: previous!.revision },
      }),
    });
  });

  it('propagates audit failure out of the transaction so Prisma rolls back mutation', async () => {
    const failure = new Error('audit failed');
    mocks.tx.systemRoomTemplateRevision.create.mockRejectedValue(failure);
    await expect(systemRoomTemplateService.create(input, actor)).rejects.toBe(failure);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.systemRoomTemplate.create).toHaveBeenCalledTimes(1);
  });

  it('hashes content deterministically and rejects stale selections', () => {
    expect(templateRevision({ a: 1, b: 2 })).toBe(templateRevision({ b: 2, a: 1 }));
    expect(templateRevision({ folders: input.folders })).not.toBe(
      templateRevision({ folders: [] })
    );
    expect(() => assertTemplateRevision({ revision: 'current' }, undefined)).toThrow();
    expect(() => assertTemplateRevision({ revision: 'current' }, 'old')).toThrow();
    expect(() => assertTemplateRevision({ revision: 'current' }, 'current')).not.toThrow();
  });
});
