/**
 * Admin Activity Log API (F040)
 *
 * GET /api/organization/activity - Get organization-wide activity log
 */

import { NextRequest, NextResponse } from 'next/server';
import { EventType, type Prisma } from '@prisma/client';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { csvCell, redactIpAddress } from '@/lib/audit/exportSanitization';

const EVENT_TYPE_GROUPS: Record<string, EventType[]> = {
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
  link: [
    'LINK_CREATED',
    'LINK_REVOKED',
    'LINK_ACCESSED',
    'LINK_ACCESS_DENIED',
    'LINK_PASSWORD_VERIFIED',
  ],
  auth: [
    'USER_LOGIN',
    'USER_LOGOUT',
    'USER_2FA_ENABLED',
    'USER_2FA_DISABLED',
    'USER_PASSWORD_CHANGED',
    'USER_PASSWORD_RESET',
  ],
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const EXPORT_ROW_LIMIT = 10_000;

type ActivityProvenance = 'native' | 'legacy' | 'inferred';
type ActivityAuditStatus = 'authoritative' | 'shadow' | 'inferred';

interface ActivityRecord {
  id: string;
  eventType: string;
  actorType: string;
  actor: { id?: string; name?: string; email: string; identityLabel: string } | null;
  room: { id: string; name: string } | null;
  description: string | null;
  ipAddress: string | null;
  createdAt: Date;
  documentId: string | null;
  provenance: ActivityProvenance;
  auditStatus: ActivityAuditStatus;
  sourceMetadata: { source: string; sourceId: string };
}

function parsePositiveInteger(value: string | null, fallback: number, maximum?: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return maximum ? Math.min(parsed, maximum) : parsed;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNativeEventType(value: string): value is EventType {
  return Object.values(EventType).includes(value as EventType);
}

function readsMetadata(metadata: Prisma.JsonValue | null, key: string): string | boolean | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Prisma.JsonObject)[key];
  return typeof value === 'string' || typeof value === 'boolean' ? value : null;
}

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
    const page = parsePositiveInteger(searchParams.get('page'), 1);
    const limit = parsePositiveInteger(searchParams.get('limit'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const userId = searchParams.get('userId');
    const eventType = searchParams.get('eventType');
    const roomId = searchParams.get('roomId');
    const search = searchParams.get('search')?.trim().slice(0, 200) || null;
    const fromValue = searchParams.get('from');
    const toValue = searchParams.get('to');
    const from = parseDate(fromValue);
    const to = parseDate(toValue);
    const exportCsv = searchParams.get('export') === 'csv';

    if ((fromValue && !from) || (toValue && !to)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }
    if (from && to && from > to) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
    }
    if (eventType && !EVENT_TYPE_GROUPS[eventType] && !isNativeEventType(eventType)) {
      return NextResponse.json({ error: 'Invalid event type' }, { status: 400 });
    }

    // Build where clause
    const eventWhere: Prisma.EventWhereInput = {
      organizationId: session.organizationId,
    };

    if (userId) {
      eventWhere.actorId = userId;
    }
    if (eventType) {
      const group = EVENT_TYPE_GROUPS[eventType];
      eventWhere.eventType = group ? { in: group } : (eventType as EventType);
    }
    if (roomId) {
      eventWhere.roomId = roomId;
    }
    if (from) {
      eventWhere.createdAt = { ...(eventWhere.createdAt as object), gte: from };
    }
    if (to) {
      eventWhere.createdAt = { ...(eventWhere.createdAt as object), lte: to };
    }

    // Use RLS context for org-scoped queries. Historical share sessions that
    // lack a linked native LINK_ACCESSED event are merged as explicitly inferred
    // rows. They are never represented as authoritative audit events.
    const { records, total, folderByDocId, auditCaptureMode, exportTruncated } =
      await withOrgContext(session.organizationId, async (tx) => {
        if (search) {
          const [matchingRooms, matchingDocuments] = await Promise.all([
            tx.room.findMany({
              where: {
                organizationId: session.organizationId,
                name: { contains: search, mode: 'insensitive' },
              },
              select: { id: true },
            }),
            tx.document.findMany({
              where: {
                organizationId: session.organizationId,
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { folder: { is: { name: { contains: search, mode: 'insensitive' } } } },
                ],
              },
              select: { id: true },
            }),
          ]);
          eventWhere.OR = [
            { description: { contains: search, mode: 'insensitive' } },
            { actorEmail: { contains: search, mode: 'insensitive' } },
            { actor: { is: { email: { contains: search, mode: 'insensitive' } } } },
            { actor: { is: { firstName: { contains: search, mode: 'insensitive' } } } },
            { actor: { is: { lastName: { contains: search, mode: 'insensitive' } } } },
            { roomId: { in: matchingRooms.map((item) => item.id) } },
            { documentId: { in: matchingDocuments.map((item) => item.id) } },
          ];
        }

        const includeInferred = !eventType || eventType === 'link' || eventType === 'LINK_ACCESSED';
        const sessionWhere: Prisma.ViewSessionWhereInput = {
          organizationId: session.organizationId,
          events: { none: { eventType: 'LINK_ACCESSED' } },
          ...(userId ? { userId } : {}),
          ...(roomId ? { roomId } : {}),
          ...((from || to) && {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }),
          ...(search && {
            OR: [
              { visitorEmail: { contains: search, mode: 'insensitive' } },
              { visitorName: { contains: search, mode: 'insensitive' } },
              { user: { is: { email: { contains: search, mode: 'insensitive' } } } },
              { user: { is: { firstName: { contains: search, mode: 'insensitive' } } } },
              { user: { is: { lastName: { contains: search, mode: 'insensitive' } } } },
              { room: { is: { name: { contains: search, mode: 'insensitive' } } } },
            ],
          }),
        };

        const candidateLimit = exportCsv ? EXPORT_ROW_LIMIT + 1 : page * limit;
        const [events, eventTotal, inferredSessions, inferredTotal, organization] =
          await Promise.all([
            tx.event.findMany({
              where: eventWhere,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: candidateLimit,
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
            tx.event.count({ where: eventWhere }),
            includeInferred
              ? tx.viewSession.findMany({
                  where: sessionWhere,
                  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  take: candidateLimit,
                  select: {
                    id: true,
                    createdAt: true,
                    visitorEmail: true,
                    visitorName: true,
                    ipAddress: true,
                    user: {
                      select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                      },
                    },
                    room: { select: { id: true, name: true } },
                  },
                })
              : Promise.resolve([]),
            includeInferred ? tx.viewSession.count({ where: sessionWhere }) : Promise.resolve(0),
            tx.organization.findUnique({
              where: { id: session.organizationId },
              select: { auditCaptureMode: true },
            }),
          ]);

        const nativeRecords: ActivityRecord[] = events.map((event) => {
          const metadataSource = readsMetadata(event.metadata, 'source');
          const authoritative = readsMetadata(event.metadata, 'authoritative');
          const provenance: ActivityProvenance = metadataSource === 'native' ? 'native' : 'legacy';
          const auditStatus: ActivityAuditStatus =
            authoritative === false ? 'shadow' : 'authoritative';
          return {
            id: event.id,
            eventType: event.eventType,
            actorType: event.actorType,
            actor: event.actor
              ? {
                  id: event.actor.id,
                  name: `${event.actor.firstName} ${event.actor.lastName}`.trim(),
                  email: event.actor.email,
                  identityLabel: 'Account identity',
                }
              : event.actorEmail
                ? { email: event.actorEmail, identityLabel: 'Asserted email' }
                : null,
            room: event.room,
            description: event.description,
            ipAddress: redactIpAddress(event.ipAddress),
            createdAt: event.createdAt,
            documentId: event.documentId,
            provenance,
            auditStatus,
            sourceMetadata: {
              source: provenance === 'native' ? 'event' : 'legacy_event',
              sourceId: event.id,
            },
          };
        });

        const inferredRecords: ActivityRecord[] = inferredSessions.map((viewerSession) => ({
          id: `inferred-view-session-${viewerSession.id}`,
          eventType: 'LINK_ACCESSED',
          actorType: 'VIEWER',
          actor: viewerSession.user
            ? {
                id: viewerSession.user.id,
                name: `${viewerSession.user.firstName} ${viewerSession.user.lastName}`.trim(),
                email: viewerSession.user.email,
                identityLabel: 'Account identity',
              }
            : viewerSession.visitorEmail
              ? {
                  name: viewerSession.visitorName ?? undefined,
                  email: viewerSession.visitorEmail,
                  identityLabel: 'Asserted email',
                }
              : null,
          room: viewerSession.room,
          description: 'Share-link access inferred from a viewer session',
          ipAddress: redactIpAddress(viewerSession.ipAddress),
          createdAt: viewerSession.createdAt,
          documentId: null,
          provenance: 'inferred',
          auditStatus: 'inferred',
          sourceMetadata: { source: 'view_session', sourceId: viewerSession.id },
        }));

        const merged = [...nativeRecords, ...inferredRecords].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)
        );
        const exportTruncated = exportCsv && merged.length > EXPORT_ROW_LIMIT;
        const selected = exportCsv
          ? merged.slice(0, EXPORT_ROW_LIMIT)
          : merged.slice((page - 1) * limit, page * limit);

        // Secondary lookup: resolve folder names for document events
        const docIds = selected.flatMap((record) => (record.documentId ? [record.documentId] : []));
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

        return {
          records: selected,
          total: eventTotal + inferredTotal,
          folderByDocId,
          auditCaptureMode: organization?.auditCaptureMode ?? 'OFF',
          exportTruncated,
        };
      });

    // Export as CSV if requested
    if (exportCsv) {
      const csvRows = [
        [
          'Timestamp',
          'Event Type',
          'Actor',
          'Actor Email',
          'Identity Basis',
          'Room',
          'Description',
          'IP Address (Redacted)',
          'Provenance',
          'Audit Status',
          'Source',
        ]
          .map(csvCell)
          .join(','),
      ];

      for (const event of records) {
        csvRows.push(
          [
            event.createdAt.toISOString(),
            event.eventType,
            event.actor?.name || event.actor?.email || 'System',
            event.actor?.email || '',
            event.actor?.identityLabel || 'System',
            event.room?.name || '',
            event.description || '',
            event.ipAddress || '',
            event.provenance,
            event.auditStatus,
            event.sourceMetadata.source,
          ]
            .map(csvCell)
            .join(',')
        );
      }

      const csv = csvRows.join('\n');

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="activity-log.csv"',
          'Cache-Control': 'private, no-store',
          'X-Activity-Export-Limit': String(EXPORT_ROW_LIMIT),
          'X-Activity-Export-Truncated': String(exportTruncated),
        },
      });
    }

    // Return JSON response
    return NextResponse.json({
      events: records.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
        folderName: event.documentId ? (folderByDocId.get(event.documentId) ?? null) : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      coverage: {
        auditCaptureMode,
        historicalInferenceIncluded: true,
        identityNotice: 'External viewer email addresses are asserted, not verified.',
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
