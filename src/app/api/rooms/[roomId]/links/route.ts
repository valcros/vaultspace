/**
 * Share Links API (F116)
 *
 * GET  /api/rooms/:roomId/links - List share links
 * POST /api/rooms/:roomId/links - Create share link
 */

import { NextRequest, NextResponse } from 'next/server';
import { LinkScope, LinkPermission } from '@prisma/client';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * Generate a unique link slug
 */
function generateLinkSlug(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * GET /api/rooms/:roomId/links
 * List all share links for a room
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Get all links for the room
      const links = await tx.link.findMany({
        where: {
          roomId,
          organizationId: session.organizationId,
        },
        include: {
          createdByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          _count: {
            select: {
              visits: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { links };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ links: result.links });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[LinksAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list links' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/:roomId/links
 * Create a new share link
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      description,
      permission = 'VIEW',
      password,
      requiresEmailVerification,
      allowedEmails,
      expiresAt,
      maxViews,
      maxSessionMinutes,
      scope = 'ENTIRE_ROOM',
      scopedFolderId,
      scopedDocumentId,
    } = body;

    // Validate permission
    const validPermissions: LinkPermission[] = ['VIEW', 'DOWNLOAD'];
    if (!validPermissions.includes(permission)) {
      return NextResponse.json({ error: 'Invalid permission level' }, { status: 400 });
    }

    // Validate scope
    const validScopes: LinkScope[] = ['ENTIRE_ROOM', 'FOLDER', 'DOCUMENT'];
    if (!validScopes.includes(scope)) {
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
    }

    // Hash password if provided (can be done outside transaction)
    let passwordHash: string | null = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 12);
    }

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Validate scoped resources
      if (scope === 'FOLDER' && scopedFolderId) {
        const folder = await tx.folder.findFirst({
          where: {
            id: scopedFolderId,
            roomId,
            organizationId: session.organizationId,
          },
        });

        if (!folder) {
          return { error: 'Folder not found', status: 404 };
        }
      }

      if (scope === 'DOCUMENT' && scopedDocumentId) {
        const document = await tx.document.findFirst({
          where: {
            id: scopedDocumentId,
            roomId,
            organizationId: session.organizationId,
          },
        });

        if (!document) {
          return { error: 'Document not found', status: 404 };
        }
      }

      // Generate unique slug
      let slug = generateLinkSlug();
      let attempts = 0;
      while (attempts < 5) {
        const existing = await tx.link.findFirst({
          where: { slug },
        });
        if (!existing) {
          break;
        }
        slug = generateLinkSlug();
        attempts++;
      }

      // Create link
      const link = await tx.link.create({
        data: {
          organizationId: session.organizationId,
          roomId,
          createdByUserId: session.userId,
          slug,
          name: name?.trim() ?? null,
          description: description?.trim() ?? null,
          permission,
          requiresPassword: !!password,
          passwordHash,
          requiresEmailVerification: requiresEmailVerification ?? false,
          allowedEmails: allowedEmails ?? [],
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          maxViews: maxViews ?? null,
          maxSessionMinutes: maxSessionMinutes ?? null,
          scope,
          scopedFolderId: scope === 'FOLDER' ? scopedFolderId : null,
          scopedDocumentId: scope === 'DOCUMENT' ? scopedDocumentId : null,
        },
      });

      return { link };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Generate full URL - APP_URL is required
    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] || process.env['APP_URL'];
    if (!baseUrl) {
      console.error('[LinksAPI] NEXT_PUBLIC_APP_URL or APP_URL environment variable is required');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    const linkUrl = `${baseUrl}/r/${result.link.slug}`;

    return NextResponse.json(
      {
        link: {
          ...result.link,
          url: linkUrl,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[LinksAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create link' }, { status: 500 });
  }
}
