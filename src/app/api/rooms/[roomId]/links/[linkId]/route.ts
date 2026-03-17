/**
 * Single Link Management API (F116)
 *
 * GET    /api/rooms/:roomId/links/:linkId - Get link details
 * PATCH  /api/rooms/:roomId/links/:linkId - Update link
 * DELETE /api/rooms/:roomId/links/:linkId - Revoke link
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; linkId: string }>;
}

/**
 * GET /api/rooms/:roomId/links/:linkId
 * Get link details
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, linkId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for org-scoped queries
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

      // Get link
      const link = await tx.link.findFirst({
        where: {
          id: linkId,
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
          visits: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          _count: {
            select: {
              visits: true,
            },
          },
        },
      });

      if (!link) {
        return { error: 'Link not found', status: 404 };
      }

      return { link };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ link: result.link });
  } catch (error) {
    console.error('[LinkAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get link' }, { status: 500 });
  }
}

/**
 * PATCH /api/rooms/:roomId/links/:linkId
 * Update link settings
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, linkId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      description,
      permission,
      password,
      removePassword,
      requiresEmailVerification,
      allowedEmails,
      expiresAt,
      maxViews,
      isActive,
    } = body;

    // Handle password update
    let passwordData: { requiresPassword?: boolean; passwordHash?: string | null } = {};
    if (removePassword) {
      passwordData = {
        requiresPassword: false,
        passwordHash: null,
      };
    } else if (password) {
      passwordData = {
        requiresPassword: true,
        passwordHash: await bcrypt.hash(password, 12),
      };
    }

    // Use RLS context for org-scoped queries
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

      // Get existing link
      const existingLink = await tx.link.findFirst({
        where: {
          id: linkId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!existingLink) {
        return { error: 'Link not found', status: 404 };
      }

      // Update link
      const updatedLink = await tx.link.update({
        where: { id: linkId },
        data: {
          ...(name !== undefined && { name: name?.trim() ?? null }),
          ...(description !== undefined && { description: description?.trim() ?? null }),
          ...(permission && { permission }),
          ...passwordData,
          ...(requiresEmailVerification !== undefined && { requiresEmailVerification }),
          ...(allowedEmails !== undefined && { allowedEmails }),
          ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
          ...(maxViews !== undefined && { maxViews }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      return { link: updatedLink };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ link: result.link });
  } catch (error) {
    console.error('[LinkAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update link' }, { status: 500 });
  }
}

/**
 * DELETE /api/rooms/:roomId/links/:linkId
 * Revoke (deactivate) a link
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, linkId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for org-scoped queries
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

      // Get existing link
      const existingLink = await tx.link.findFirst({
        where: {
          id: linkId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!existingLink) {
        return { error: 'Link not found', status: 404 };
      }

      // Deactivate rather than hard delete
      await tx.link.update({
        where: { id: linkId },
        data: { isActive: false },
      });

      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LinkAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to revoke link' }, { status: 500 });
  }
}
