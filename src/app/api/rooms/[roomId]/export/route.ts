/**
 * Room Export API (F113)
 *
 * POST /api/rooms/:roomId/export - Start export job
 * GET  /api/rooms/:roomId/export/:jobId - Check export status
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';
import { getProviders } from '@/providers';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * POST /api/rooms/:roomId/export
 * Start a room export job
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
      includeOriginals = true,
      includePreviews = true,
      includeMetadata = true,
      documentIds,
      folderId,
    } = body;

    // Create export job
    const providers = getProviders();
    const jobId = await providers.job.addJob(
      'report',
      'room.export',
      {
        roomId,
        organizationId: session.organizationId,
        requestedByUserId: session.userId,
        options: {
          includeOriginals,
          includePreviews,
          includeMetadata,
          documentIds,
          folderId,
        },
      },
      { priority: 'normal' }
    );

    return NextResponse.json(
      {
        jobId,
        message: 'Export job started',
        status: 'pending',
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[ExportAPI] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to start export' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/rooms/:roomId/export
 * Get export status or list recent exports
 */
export async function GET(request: NextRequest, context: RouteContext) {
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

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (jobId) {
      // Get status of specific job
      const providers = getProviders();
      const status = await providers.job.getJobStatus('report', jobId);

      return NextResponse.json({ jobId, status });
    }

    // List recent export events for this room
    const exportEvents = await db.event.findMany({
      where: {
        organizationId: session.organizationId,
        roomId,
        eventType: 'ADMIN_EXPORT_INITIATED',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return NextResponse.json({ exports: exportEvents });
  } catch (error) {
    console.error('[ExportAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get export status' },
      { status: 500 }
    );
  }
}
