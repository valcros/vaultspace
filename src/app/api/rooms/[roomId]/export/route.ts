/**
 * Room Export API (F113)
 *
 * POST /api/rooms/:roomId/export - Start export job
 * GET  /api/rooms/:roomId/export/:jobId - Check export status
 */

import { NextRequest, NextResponse } from 'next/server';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getProviders } from '@/providers';
import { QUEUE_NAMES } from '@/workers/types';
import { hasCapability, createCapabilityUnavailableResponse } from '@/lib/deployment-capabilities';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

/**
 * POST /api/rooms/:roomId/export
 * Start a room export job
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // Check if bulk export capability is available (requires Redis)
    if (!hasCapability('canRunBulkExport')) {
      return createCapabilityUnavailableResponse('canRunBulkExport', 'Room export');
    }

    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use RLS context for org-scoped queries
    const room = await withOrgContext(session.organizationId, async (tx) => {
      return tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });
    });

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const body = await request.json();
    const {
      includeOriginals = true,
      includePreviews = true,
      includeMetadata = true,
      documentIds,
      folderId,
    } = body;

    // Create export job on the QUEUE_NAMES.LOW queue (consumed by report worker type)
    const providers = getProviders();
    const jobId = await providers.job.addJob(
      QUEUE_NAMES.LOW,
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
      { priority: QUEUE_NAMES.LOW }
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
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[ExportAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to start export' }, { status: 500 });
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
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

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

      if (jobId) {
        // Return early with room valid indicator to check job status outside tx
        return { roomValid: true, checkJob: true };
      }

      // List recent export events for this room
      const exportEvents = await tx.event.findMany({
        where: {
          organizationId: session.organizationId,
          roomId,
          eventType: 'ADMIN_EXPORT_INITIATED',
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      return { exportEvents };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if ('checkJob' in result && result.checkJob && jobId) {
      // Get status of specific job from QUEUE_NAMES.LOW queue
      const providers = getProviders();
      const status = await providers.job.getJobStatus(QUEUE_NAMES.LOW, jobId);

      return NextResponse.json({ jobId, status });
    }

    return NextResponse.json({ exports: result.exportEvents });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[ExportAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get export status' }, { status: 500 });
  }
}
