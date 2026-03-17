/**
 * Document Indexing API (F010)
 *
 * POST /api/rooms/:roomId/documents/:documentId/index - Set document index number
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db, withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

/**
 * POST /api/rooms/:roomId/documents/:documentId/index
 * Set document Bates-style index number
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { batesNumber, displayOrder } = body;

    // Validate Bates number format (if provided)
    if (batesNumber !== undefined && batesNumber !== null) {
      if (typeof batesNumber !== 'string' || batesNumber.length > 20) {
        return NextResponse.json(
          { error: 'Bates number must be a string up to 20 characters' },
          { status: 400 }
        );
      }
    }

    // Validate display order
    if (displayOrder !== undefined && (typeof displayOrder !== 'number' || displayOrder < 0)) {
      return NextResponse.json(
        { error: 'Display order must be a non-negative number' },
        { status: 400 }
      );
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

      // Get current document
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      // Check for duplicate Bates numbers in the same room (if provided)
      if (batesNumber !== undefined && batesNumber !== null) {
        const existing = await tx.document.findFirst({
          where: {
            roomId,
            organizationId: session.organizationId,
            batesNumber,
            id: { not: documentId },
          },
        });

        if (existing) {
          return { error: 'Bates number already in use in this room', status: 400 };
        }
      }

      // Update document
      const updatedDocument = await tx.document.update({
        where: { id: documentId },
        data: {
          ...(batesNumber !== undefined && { batesNumber }),
          ...(displayOrder !== undefined && { displayOrder }),
        },
      });

      return { document: updatedDocument };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ document: result.document });
  } catch (error) {
    console.error('[DocumentIndexAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to update document index' }, { status: 500 });
  }
}

/**
 * GET /api/rooms/:roomId/documents/:documentId/index
 * Get next available Bates number for the room
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

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

      // Get the highest Bates start number in the room
      const maxDoc = await tx.document.findFirst({
        where: {
          roomId,
          organizationId: session.organizationId,
          batesStartNumber: { not: null },
        },
        orderBy: { batesStartNumber: 'desc' },
        select: { batesStartNumber: true },
      });

      const nextNumber = (maxDoc?.batesStartNumber ?? 0) + 1;

      // Get the highest display order
      const maxOrderDoc = await tx.document.findFirst({
        where: {
          roomId,
          organizationId: session.organizationId,
        },
        orderBy: { displayOrder: 'desc' },
        select: { displayOrder: true },
      });

      const nextDisplayOrder = (maxOrderDoc?.displayOrder ?? 0) + 1;

      return { nextNumber, nextDisplayOrder };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      nextBatesNumber: result.nextNumber,
      suggestedBatesFormat: String(result.nextNumber).padStart(4, '0'),
      nextDisplayOrder: result.nextDisplayOrder,
    });
  } catch (error) {
    console.error('[DocumentIndexAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get next index' }, { status: 500 });
  }
}
