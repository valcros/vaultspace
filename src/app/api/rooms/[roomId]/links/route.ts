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

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

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
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Verify room access
    const room = await db.room.findFirst({
      where: {
        id: roomId,
        organizationId: session.organizationId,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    // Get all links for the room
    const links = await db.link.findMany({
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

    return NextResponse.json({ links });
  } catch (error) {
    console.error('[LinksAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to list links' },
      { status: 500 }
    );
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
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Verify room access
    const room = await db.room.findFirst({
      where: {
        id: roomId,
        organizationId: session.organizationId,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
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
      scope = 'ENTIRE_ROOM',
      scopedFolderId,
      scopedDocumentId,
    } = body;

    // Validate permission
    const validPermissions: LinkPermission[] = ['VIEW', 'DOWNLOAD'];
    if (!validPermissions.includes(permission)) {
      return NextResponse.json(
        { error: 'Invalid permission level' },
        { status: 400 }
      );
    }

    // Validate scope
    const validScopes: LinkScope[] = ['ENTIRE_ROOM', 'FOLDER', 'DOCUMENT'];
    if (!validScopes.includes(scope)) {
      return NextResponse.json(
        { error: 'Invalid scope' },
        { status: 400 }
      );
    }

    // Validate scoped resources
    if (scope === 'FOLDER' && scopedFolderId) {
      const folder = await db.folder.findFirst({
        where: {
          id: scopedFolderId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!folder) {
        return NextResponse.json(
          { error: 'Folder not found' },
          { status: 404 }
        );
      }
    }

    if (scope === 'DOCUMENT' && scopedDocumentId) {
      const document = await db.document.findFirst({
        where: {
          id: scopedDocumentId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!document) {
        return NextResponse.json(
          { error: 'Document not found' },
          { status: 404 }
        );
      }
    }

    // Generate unique slug
    let slug = generateLinkSlug();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await db.link.findFirst({
        where: { slug },
      });
      if (!existing) {
        break;
      }
      slug = generateLinkSlug();
      attempts++;
    }

    // Hash password if provided
    let passwordHash: string | null = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 12);
    }

    // Create link
    const link = await db.link.create({
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
        scope,
        scopedFolderId: scope === 'FOLDER' ? scopedFolderId : null,
        scopedDocumentId: scope === 'DOCUMENT' ? scopedDocumentId : null,
      },
    });

    // Generate full URL
    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';
    const linkUrl = `${baseUrl}/r/${link.slug}`;

    return NextResponse.json(
      {
        link: {
          ...link,
          url: linkUrl,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[LinksAPI] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create link' },
      { status: 500 }
    );
  }
}
