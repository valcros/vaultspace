import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  canLinkAccessResource,
  evaluateLinkAdmission,
  evaluateLinkServe,
  evaluateLinkState,
  getViewerLinkScopedDocumentIds,
  type LinkPolicyRecord,
  type LinkServeSession,
} from './LinkPolicy';

const NOW = new Date('2026-08-11T16:00:00.000Z');

function link(overrides: Partial<LinkPolicyRecord> = {}): LinkPolicyRecord {
  return {
    id: 'link-1',
    updatedAt: new Date('2026-08-11T15:00:00.000Z'),
    organizationId: 'org-1',
    roomId: 'room-1',
    slug: 'share-token',
    name: 'Synthetic Link',
    permission: 'VIEW',
    scope: 'ENTIRE_ROOM',
    scopedFolderId: null,
    scopedDocumentId: null,
    isActive: true,
    expiresAt: new Date('2026-08-12T16:00:00.000Z'),
    maxViews: null,
    viewCount: 0,
    maxSessionMinutes: 30,
    requiresPassword: false,
    passwordHash: null,
    requiresEmailVerification: false,
    allowedEmails: [],
    room: {
      id: 'room-1',
      organizationId: 'org-1',
      name: 'Synthetic Room',
      status: 'ACTIVE',
      requiresNda: false,
      ndaContent: null,
      ipAllowlist: [],
      brandColor: null,
      brandLogoUrl: null,
    },
    organization: {
      id: 'org-1',
      name: 'Synthetic Organization',
      logoUrl: null,
      primaryColor: '#2563eb',
    },
    ...overrides,
  };
}

function session(overrides: Partial<LinkServeSession> = {}): LinkServeSession {
  const baseLink = link();
  return {
    id: 'session-1',
    createdAt: new Date('2026-08-11T15:45:00.000Z'),
    isActive: true,
    organizationId: 'org-1',
    roomId: 'room-1',
    linkId: 'link-1',
    link: {
      id: baseLink.id,
      slug: baseLink.slug,
      isActive: baseLink.isActive,
      organizationId: baseLink.organizationId,
      roomId: baseLink.roomId,
      expiresAt: baseLink.expiresAt,
      maxSessionMinutes: baseLink.maxSessionMinutes,
      permission: baseLink.permission,
      scope: baseLink.scope,
      scopedFolderId: baseLink.scopedFolderId,
      scopedDocumentId: baseLink.scopedDocumentId,
      room: {
        id: baseLink.room.id,
        organizationId: baseLink.room.organizationId,
        status: baseLink.room.status,
      },
    },
    ...overrides,
  };
}

function txWithFolderParents(parents: Record<string, string | null>) {
  return {
    folder: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; roomId: string } }) => {
        if (where.roomId !== 'room-1' || !(where.id in parents)) {
          return null;
        }
        return { parentId: parents[where.id] ?? null };
      }),
    },
  } as unknown as Prisma.TransactionClient;
}

describe('W1-1 central link admission policy', () => {
  it.each([
    ['LINK_INACTIVE', link({ isActive: false })],
    ['LINK_EXPIRED', link({ expiresAt: new Date(NOW.getTime() - 1) })],
    ['ROOM_NOT_ACTIVE', link({ room: { ...link().room, status: 'CLOSED' } })],
    ['ORGANIZATION_MISMATCH', link({ room: { ...link().room, organizationId: 'org-other' } })],
    ['ROOM_MISMATCH', link({ room: { ...link().room, id: 'room-other' } })],
    ['LINK_SCOPE_INVALID', link({ scope: 'DOCUMENT', scopedDocumentId: null })],
    ['MAX_VIEWS_REACHED', link({ maxViews: 1, viewCount: 1 })],
  ])('denies %s before admission', (code, candidate) => {
    expect(evaluateLinkState(candidate, { admission: true, now: NOW })).toEqual(
      expect.objectContaining({ allowed: false, code })
    );
  });

  it('accepts an active link with a future expiry and one remaining admission', () => {
    expect(
      evaluateLinkState(link({ maxViews: 2, viewCount: 1 }), { admission: true, now: NOW })
    ).toEqual({ allowed: true });
  });

  it('enforces required and allowed asserted email', async () => {
    const restricted = link({
      requiresEmailVerification: true,
      allowedEmails: ['Allowed@Example.Test'],
    });

    await expect(
      evaluateLinkAdmission(
        restricted,
        {
          sourceIp: '127.0.0.1',
          userAgent: null,
        },
        NOW
      )
    ).resolves.toEqual(
      expect.objectContaining({ allowed: false, code: 'ASSERTED_EMAIL_REQUIRED' })
    );
    await expect(
      evaluateLinkAdmission(
        restricted,
        { email: 'denied@example.test', sourceIp: '127.0.0.1', userAgent: null },
        NOW
      )
    ).resolves.toEqual(
      expect.objectContaining({ allowed: false, code: 'ASSERTED_EMAIL_NOT_ALLOWED' })
    );
    await expect(
      evaluateLinkAdmission(
        restricted,
        { email: ' allowed@example.test ', sourceIp: '127.0.0.1', userAgent: null },
        NOW
      )
    ).resolves.toEqual({ allowed: true });
  });

  it('uses a same-organization authenticated member email for restricted links', async () => {
    const restricted = link({
      requiresEmailVerification: true,
      allowedEmails: ['member@example.test'],
    });

    await expect(
      evaluateLinkAdmission(
        restricted,
        {
          // A browser-supplied allowlisted email cannot stand in for the
          // authenticated member's verified identity.
          email: 'member@example.test',
          sourceIp: '127.0.0.1',
          userAgent: null,
          authenticatedMember: {
            userId: 'member-1',
            organizationId: 'org-1',
            email: 'different-member@example.test',
            ndaOnFile: true,
          },
        },
        NOW
      )
    ).resolves.toEqual(expect.objectContaining({ allowed: false, code: 'ASSERTED_EMAIL_NOT_ALLOWED' }));
  });

  it('enforces password, NDA, and source-IP gates without exposing the password', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const gated = link({
      requiresPassword: true,
      passwordHash,
      room: {
        ...link().room,
        requiresNda: true,
        ipAllowlist: ['192.0.2.0/24'],
      },
    });

    await expect(
      evaluateLinkAdmission(
        gated,
        {
          password: 'correct-password',
          ndaAccepted: true,
          sourceIp: '198.51.100.1',
          userAgent: null,
        },
        NOW
      )
    ).resolves.toEqual(expect.objectContaining({ allowed: false, code: 'IP_NOT_ALLOWED' }));
    await expect(
      evaluateLinkAdmission(
        gated,
        { password: 'incorrect', ndaAccepted: true, sourceIp: '192.0.2.10', userAgent: null },
        NOW
      )
    ).resolves.toEqual(expect.objectContaining({ allowed: false, code: 'PASSWORD_INVALID' }));
    await expect(
      evaluateLinkAdmission(
        gated,
        { password: 'correct-password', sourceIp: '192.0.2.10', userAgent: null },
        NOW
      )
    ).resolves.toEqual(
      expect.objectContaining({ allowed: false, code: 'NDA_ACCEPTANCE_REQUIRED' })
    );
    await expect(
      evaluateLinkAdmission(
        gated,
        {
          password: 'correct-password',
          ndaAccepted: true,
          sourceIp: '192.0.2.10',
          userAgent: null,
        },
        NOW
      )
    ).resolves.toEqual({ allowed: true });
  });

  it('allows an NDA-on-file bypass only for a trusted same-organization member', async () => {
    const ndaLink = link({ room: { ...link().room, requiresNda: true } });
    const assertedEmailOnly = {
      email: 'member@example.test',
      sourceIp: '127.0.0.1',
      userAgent: null,
    };
    await expect(evaluateLinkAdmission(ndaLink, assertedEmailOnly, NOW)).resolves.toEqual(
      expect.objectContaining({ allowed: false, code: 'NDA_ACCEPTANCE_REQUIRED' })
    );
    await expect(
      evaluateLinkAdmission(
        ndaLink,
        {
          ...assertedEmailOnly,
          authenticatedMember: {
            userId: 'member-1',
            organizationId: 'org-other',
            email: 'member@example.test',
            ndaOnFile: true,
          },
        },
        NOW
      )
    ).resolves.toEqual(expect.objectContaining({ allowed: false, code: 'NDA_ACCEPTANCE_REQUIRED' }));
    await expect(
      evaluateLinkAdmission(
        ndaLink,
        {
          ...assertedEmailOnly,
          authenticatedMember: {
            userId: 'member-1',
            organizationId: 'org-1',
            email: 'member@example.test',
            ndaOnFile: true,
          },
        },
        NOW
      )
    ).resolves.toEqual({ allowed: true });
  });
});

describe('W1-1 central link serve policy', () => {
  it.each([
    ['SESSION_INVALID', session({ isActive: false })],
    ['SESSION_INVALID', session({ link: { ...session().link!, slug: 'different-share-token' } })],
    ['LINK_INACTIVE', session({ link: { ...session().link!, isActive: false } })],
    [
      'LINK_EXPIRED',
      session({ link: { ...session().link!, expiresAt: new Date(NOW.getTime() - 1) } }),
    ],
    [
      'ROOM_NOT_ACTIVE',
      session({
        link: {
          ...session().link!,
          room: { ...session().link!.room, status: 'CLOSED' },
        },
      }),
    ],
    ['ORGANIZATION_MISMATCH', session({ organizationId: 'org-other' })],
    ['SESSION_TIME_LIMIT_EXCEEDED', session({ createdAt: new Date(NOW.getTime() - 30 * 60_000) })],
  ])('denies %s on the next serve request', (code, candidate) => {
    expect(evaluateLinkServe('share-token', candidate, 'view', NOW)).toEqual(
      expect.objectContaining({ allowed: false, code })
    );
  });

  it('denies DOWNLOAD for a VIEW link and allows it for a DOWNLOAD link', () => {
    expect(evaluateLinkServe('share-token', session(), 'download', NOW)).toEqual(
      expect.objectContaining({ allowed: false, code: 'LINK_PERMISSION_INSUFFICIENT' })
    );
    expect(
      evaluateLinkServe(
        'share-token',
        session({ link: { ...session().link!, permission: 'DOWNLOAD' } }),
        'download',
        NOW
      )
    ).toEqual({ allowed: true });
  });

  it('does not use maxViews as a serve-phase revocation gate', () => {
    expect(evaluateLinkServe('share-token', session(), 'view', NOW)).toEqual({ allowed: true });
  });
});

describe('W1-1 central link resource scope', () => {
  it('allows only the configured document for a document-scoped link', async () => {
    const tx = txWithFolderParents({});
    const documentLink = {
      organizationId: 'org-1',
      roomId: 'room-1',
      permission: 'VIEW' as const,
      scope: 'DOCUMENT' as const,
      scopedFolderId: null,
      scopedDocumentId: 'doc-1',
      isActive: true,
      expiresAt: null,
      room: { id: 'room-1', organizationId: 'org-1', status: 'ACTIVE' },
    };

    await expect(
      canLinkAccessResource(tx, documentLink, 'view', {
        organizationId: 'org-1',
        roomId: 'room-1',
        documentId: 'doc-1',
      })
    ).resolves.toBe(true);
    await expect(
      canLinkAccessResource(tx, documentLink, 'view', {
        organizationId: 'org-1',
        roomId: 'room-1',
        documentId: 'doc-2',
      })
    ).resolves.toBe(false);
  });

  it('allows a folder and descendants but denies siblings and cross-organization targets', async () => {
    const tx = txWithFolderParents({ scope: null, child: 'scope', sibling: null });
    const folderLink = {
      organizationId: 'org-1',
      roomId: 'room-1',
      permission: 'DOWNLOAD' as const,
      scope: 'FOLDER' as const,
      scopedFolderId: 'scope',
      scopedDocumentId: null,
      isActive: true,
      expiresAt: null,
      room: { id: 'room-1', organizationId: 'org-1', status: 'ACTIVE' },
    };

    await expect(
      canLinkAccessResource(tx, folderLink, 'download', {
        organizationId: 'org-1',
        roomId: 'room-1',
        folderId: 'child',
        documentId: 'doc-child',
      })
    ).resolves.toBe(true);
    await expect(
      canLinkAccessResource(tx, folderLink, 'view', {
        organizationId: 'org-1',
        roomId: 'room-1',
        folderId: 'sibling',
      })
    ).resolves.toBe(false);
    await expect(
      canLinkAccessResource(tx, folderLink, 'view', {
        organizationId: 'org-other',
        roomId: 'room-1',
        folderId: 'child',
      })
    ).resolves.toBe(false);
  });

  it('derives folder-scoped document IDs without escaping the folder subtree', async () => {
    const folderFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'child' }])
      .mockResolvedValueOnce([]);
    const documentFindMany = vi.fn().mockResolvedValue([{ id: 'doc-root' }, { id: 'doc-child' }]);
    const tx = {
      folder: { findFirst: vi.fn().mockResolvedValue({ id: 'scope' }), findMany: folderFindMany },
      document: { findMany: documentFindMany },
    } as unknown as Prisma.TransactionClient;

    await expect(
      getViewerLinkScopedDocumentIds(
        tx,
        { scope: 'FOLDER', scopedFolderId: 'scope', scopedDocumentId: null },
        'room-1'
      )
    ).resolves.toEqual(new Set(['doc-root', 'doc-child']));
    expect(documentFindMany).toHaveBeenCalledWith({
      where: {
        roomId: 'room-1',
        folderId: { in: ['scope', 'child'] },
        status: 'ACTIVE',
        withdrawnAt: null,
      },
      select: { id: true },
    });
  });
});
