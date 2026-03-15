/**
 * Document Indexing API (F010)
 *
 * POST /api/rooms/:roomId/documents/:documentId/index - Set document index number
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

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

    // Get current document
    const document = await db.document.findFirst({
      where: {
        id: documentId,
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

      // Check for duplicate Bates numbers in the same room
      const existing = await db.document.findFirst({
        where: {
          roomId,
          organizationId: session.organizationId,
          batesNumber,
          id: { not: documentId },
        },
      });

      if (existing) {
        return NextResponse.json(
          { error: 'Bates number already in use in this room' },
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

    // Update document
    const updatedDocument = await db.document.update({
      where: { id: documentId },
      data: {
        ...(batesNumber !== undefined && { batesNumber }),
        ...(displayOrder !== undefined && { displayOrder }),
      },
    });

    return NextResponse.json({ document: updatedDocument });
  } catch (error) {
    console.error('[DocumentIndexAPI] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to update document index' },
      { status: 500 }
    );
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

    // Get the highest Bates start number in the room
    const maxDoc = await db.document.findFirst({
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
    const maxOrderDoc = await db.document.findFirst({
      where: {
        roomId,
        organizationId: session.organizationId,
      },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    });

    const nextDisplayOrder = (maxOrderDoc?.displayOrder ?? 0) + 1;

    return NextResponse.json({
      nextBatesNumber: nextNumber,
      suggestedBatesFormat: String(nextNumber).padStart(4, '0'),
      nextDisplayOrder,
    });
  } catch (error) {
    console.error('[DocumentIndexAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get next index' },
      { status: 500 }
    );
  }
}
