/**
 * Admin Activity Log API (F040)
 *
 * GET /api/organization/activity - Get organization-wide activity log
 */

import { NextRequest, NextResponse } from 'next/server';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

const EVENT_TYPE_GROUPS: Record<string, string[]> = {
  document: [
    'DOCUMENT_UPLOADED',
    'DOCUMENT_VERSION_CREATED',
    'DOCUMENT_UPDATED',
    'DOCUMENT_METADATA_UPDATED',
    'DOCUMENT_MOVED',
    'DOCUMENT_TAGGED',
    'DOCUMENT_ARCHIVED',
    'DOCUMENT_DELETED',
    'DOCUMENT_RESTORED',
    'DOCUMENT_SCANNED',
    'DOCUMENT_VIEWED',
    'DOCUMENT_DOWNLOADED',
    'DOCUMENT_PRINTED',
    'PAGE_VIEWED',
  ],
  room: [
    'ROOM_CREATED',
    'ROOM_UPDATED',
    'ROOM_STATUS_CHANGED',
    'ROOM_ARCHIVED',
    'ROOM_CLOSED',
    'ROOM_DUPLICATED',
    'ROOM_DELETED',
  ],
  member: [
    'USER_CREATED',
    'USER_INVITED',
    'USER_ACCEPTED_INVITATION',
    'USER_UPDATED',
    'USER_DELETED',
    'PERMISSION_GRANTED',
    'PERMISSION_REVOKED',
    'PERMISSION_UPDATED',
  ],
  link: ['LINK_CREATED', 'LINK_REVOKED', 'LINK_ACCESSED', 'LINK_PASSWORD_VERIFIED'],
  auth: [
    'USER_LOGIN',
    'USER_LOGOUT',
    'USER_2FA_ENABLED',
    'USER_2FA_DISABLED',
    'USER_PASSWORD_CHANGED',
    'USER_PASSWORD_RESET',
  ],
};

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/organization/activity
 * Get organization-wide activity log with filtering
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const userId = searchParams.get('userId');
    const eventType = searchParams.get('eventType');
    const roomId = searchParams.get('roomId');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const exportCsv = searchParams.get('export') === 'csv';

    // Build where clause
    const where: Record<string, unknown> = {
      organizationId: session.organizationId,
    };

    if (userId) {
      where['actorId'] = userId;
    }
    if (eventType) {
      const group = EVENT_TYPE_GROUPS[eventType];
      where['eventType'] = group ? { in: group } : eventType;
    }
    if (roomId) {
      where['roomId'] = roomId;
    }
    if (from) {
      where['createdAt'] = { ...((where['createdAt'] as object) || {}), gte: new Date(from) };
    }
    if (to) {
      where['createdAt'] = { ...((where['createdAt'] as object) || {}), lte: new Date(to) };
    }

    // Use RLS context for org-scoped queries
    const { events, total, folderByDocId } = await withOrgContext(
      session.organizationId,
      async (tx) => {
        const [events, total] = await Promise.all([
          tx.event.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              actor: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
              room: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          }),
          tx.event.count({ where }),
        ]);

        // Secondary lookup: resolve folder names for document events
        const docIds = events.flatMap((e) => (e.documentId ? [e.documentId] : []));
        const folderByDocId = new Map<string, string | null>();
        if (docIds.length > 0) {
          const docs = await tx.document.findMany({
            where: { id: { in: docIds }, organizationId: session.organizationId },
            select: { id: true, folder: { select: { name: true } } },
          });
          for (const doc of docs) {
            folderByDocId.set(doc.id, doc.folder?.name ?? null);
          }
        }

        return { events, total, folderByDocId };
      }
    );

    // Export as CSV if requested
    if (exportCsv) {
      const csvRows = [
        [
          'Timestamp',
          'Event Type',
          'Actor',
          'Actor Email',
          'Room',
          'Description',
          'IP Address',
        ].join(','),
      ];

      for (const event of events) {
        const actorName = event.actor
          ? (event.actor.firstName + ' ' + event.actor.lastName).trim()
          : event.actorEmail || 'System';
        const roomName = event.room?.name || '';

        csvRows.push(
          [
            event.createdAt.toISOString(),
            event.eventType,
            '"' + actorName.replace(/"/g, '""') + '"',
            event.actor?.email || event.actorEmail || '',
            '"' + roomName.replace(/"/g, '""') + '"',
            '"' + (event.description || '').replace(/"/g, '""') + '"',
            event.ipAddress || '',
          ].join(',')
        );
      }

      const csv = csvRows.join('\n');

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="activity-log.csv"',
        },
      });
    }

    // Return JSON response
    return NextResponse.json({
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        actorType: event.actorType,
        actor: event.actor
          ? {
              id: event.actor.id,
              name: (event.actor.firstName + ' ' + event.actor.lastName).trim(),
              email: event.actor.email,
            }
          : event.actorEmail
            ? { email: event.actorEmail }
            : null,
        room: event.room ? { id: event.room.id, name: event.room.name } : null,
        description: event.description,
        ipAddress: event.ipAddress,
        createdAt: event.createdAt,
        folderName: event.documentId ? (folderByDocId.get(event.documentId) ?? null) : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[ActivityAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get activity log' }, { status: 500 });
  }
}
