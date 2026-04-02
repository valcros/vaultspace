/**
 * Bookmarks API
 *
 * GET    /api/bookmarks - List user's bookmarks (with document & room info)
 * POST   /api/bookmarks - Create/upsert a bookmark
 * DELETE /api/bookmarks - Remove a bookmark
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();
    const orgId = session.organizationId;
    const userId = session.userId;

    const bookmarks = await withOrgContext(orgId, async (tx) => {
      return tx.bookmark.findMany({
        where: {
          organizationId: orgId,
          userId,
        },
        include: {
          document: {
            select: {
              id: true,
              name: true,
              mimeType: true,
            },
          },
          room: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    return NextResponse.json({ bookmarks });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }
    console.error('Failed to fetch bookmarks:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch bookmarks' } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const orgId = session.organizationId;
    const userId = session.userId;
    const body = await request.json();

    const { documentId, roomId } = body as { documentId: string; roomId: string };

    if (!documentId || !roomId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'documentId and roomId are required' },
        },
        { status: 400 }
      );
    }

    const bookmark = await withOrgContext(orgId, async (tx) => {
      return tx.bookmark.upsert({
        where: {
          userId_documentId: {
            userId,
            documentId,
          },
        },
        update: {},
        create: {
          organizationId: orgId,
          userId,
          documentId,
          roomId,
        },
      });
    });

    return NextResponse.json({ bookmark }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }
    console.error('Failed to create bookmark:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create bookmark' } },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();
    const orgId = session.organizationId;
    const userId = session.userId;
    const body = await request.json();

    const { documentId } = body as { documentId: string };

    if (!documentId) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'documentId is required' } },
        { status: 400 }
      );
    }

    await withOrgContext(orgId, async (tx) => {
      await tx.bookmark.deleteMany({
        where: {
          organizationId: orgId,
          userId,
          documentId,
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }
    console.error('Failed to delete bookmark:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete bookmark' } },
      { status: 500 }
    );
  }
}
