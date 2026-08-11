import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  admitLinkViewer,
  evaluateLinkServe,
  getLinkPolicyRecord,
  type LinkServeSession,
} from '@/lib/permissions/LinkPolicy';

import { prisma } from '../../vitest.integration.setup';

describe('W1-1 link admission policy with the runtime database role', () => {
  it('admits only one of two concurrent final requests and keeps that session servable', async () => {
    const suffix = randomUUID().slice(0, 12);
    const organization = await prisma.organization.create({
      data: { name: 'Synthetic Link Organization', slug: `synthetic-link-${suffix}` },
    });
    const room = await prisma.room.create({
      data: {
        organizationId: organization.id,
        name: 'Synthetic Link Room',
        slug: `synthetic-link-room-${suffix}`,
        status: 'ACTIVE',
      },
    });
    const link = await prisma.link.create({
      data: {
        organizationId: organization.id,
        roomId: room.id,
        slug: `synthetic-share-${suffix}`,
        permission: 'VIEW',
        scope: 'ENTIRE_ROOM',
        maxViews: 1,
      },
    });
    const policyRecord = await getLinkPolicyRecord(link.slug);
    expect(policyRecord).not.toBeNull();

    const attempts = await Promise.all([
      admitLinkViewer(policyRecord!, {
        email: 'viewer-one@example.test',
        sourceIp: '192.0.2.10',
        userAgent: 'synthetic-link-policy-test',
      }),
      admitLinkViewer(policyRecord!, {
        email: 'viewer-two@example.test',
        sourceIp: '192.0.2.11',
        userAgent: 'synthetic-link-policy-test',
      }),
    ]);

    const admitted = attempts.filter((attempt) => attempt.allowed);
    const denied = attempts.filter((attempt) => !attempt.allowed);
    expect(admitted).toHaveLength(1);
    expect(denied).toEqual([
      expect.objectContaining({ allowed: false, code: 'MAX_VIEWS_REACHED' }),
    ]);

    const persistedLink = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(persistedLink.viewCount).toBe(1);
    await expect(prisma.viewSession.count({ where: { linkId: link.id } })).resolves.toBe(1);
    await expect(prisma.linkVisit.count({ where: { linkId: link.id } })).resolves.toBe(1);

    const admittedResult = admitted[0]!;
    if (!admittedResult.allowed) {
      throw new Error('Expected one successful admission');
    }
    const storedSession = await prisma.viewSession.findUniqueOrThrow({
      where: { id: admittedResult.session.id },
      include: { link: { include: { room: true } } },
    });
    expect(
      evaluateLinkServe(link.slug, storedSession as LinkServeSession, 'view', new Date())
    ).toEqual({ allowed: true });

    await prisma.link.update({ where: { id: link.id }, data: { isActive: false } });
    const revokedSession = await prisma.viewSession.findUniqueOrThrow({
      where: { id: admittedResult.session.id },
      include: { link: { include: { room: true } } },
    });
    expect(
      evaluateLinkServe(link.slug, revokedSession as LinkServeSession, 'view', new Date())
    ).toEqual(expect.objectContaining({ allowed: false, code: 'LINK_INACTIVE' }));
  });
});
