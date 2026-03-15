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
import { db } from '@/lib/db';

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

    // Get link
    const link = await db.link.findFirst({
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
      return NextResponse.json(
        { error: 'Link not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ link });
  } catch (error) {
    console.error('[LinkAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get link' },
      { status: 500 }
    );
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

    // Get existing link
    const existingLink = await db.link.findFirst({
      where: {
        id: linkId,
        roomId,
        organizationId: session.organizationId,
      },
    });

    if (!existingLink) {
      return NextResponse.json(
        { error: 'Link not found' },
        { status: 404 }
      );
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
    let passwordData = {};
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

    // Update link
    const updatedLink = await db.link.update({
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

    return NextResponse.json({ link: updatedLink });
  } catch (error) {
    console.error('[LinkAPI] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update link' },
      { status: 500 }
    );
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

    // Get existing link
    const existingLink = await db.link.findFirst({
      where: {
        id: linkId,
        roomId,
        organizationId: session.organizationId,
      },
    });

    if (!existingLink) {
      return NextResponse.json(
        { error: 'Link not found' },
        { status: 404 }
      );
    }

    // Deactivate rather than hard delete
    await db.link.update({
      where: { id: linkId },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LinkAPI] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to revoke link' },
      { status: 500 }
    );
  }
}
