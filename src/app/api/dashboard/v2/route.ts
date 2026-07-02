/**
 * Dashboard API v2
 *
 * GET /api/dashboard/v2 - Get role-aware dashboard data with layout
 * PUT /api/dashboard/v2 - Save dashboard layout
 *
 * Returns different data based on user role:
 * - Org Owner/Admin: Full organization overview
 * - Room Admin: Scoped to their assigned rooms
 * - Member: Basic room access
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import {
  CURRENT_DASHBOARD_LAYOUT_VERSION,
  getDefaultLayout,
  normalizeLayout,
} from '@/lib/dashboard-defaults';
import type { WidgetPosition, DashboardLayoutResponse } from '@/types/dashboard';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionItem {
  id: string;
  type: 'question' | 'access_request' | 'review';
  title: string;
  description: string;
  roomId: string;
  roomName: string;
  createdAt: string;
  priority: 'high' | 'normal';
}

interface RoomSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  /** The caller's effective role in this room (org role plus room-scoped elevation). */
  myRole: 'ADMIN' | 'VIEWER';
  documentCount: number;
  viewerCount: number;
  questionCount: number;
  /** Documents added since the caller's previous login. */
  newDocumentCount: number;
  /** Root folders (up to 4) as a contents peek for the landing card. */
  topFolders: { id: string; name: string; documentCount: number }[];
  lastActivity?: string;
}

interface BookmarkItem {
  id: string;
  documentId: string;
  documentName: string;
  roomId: string;
  roomName: string;
  folderPath?: string;
  createdAt: string;
}

interface QuestionSummary {
  id: string;
  question: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  roomId: string;
  roomName: string;
  documentName?: string;
  createdAt: string;
  answeredAt?: string;
}

interface ContinueReadingItem {
  documentId: string;
  documentName: string;
  roomId: string;
  roomName: string;
  lastPage?: number;
  totalPages?: number;
  lastViewedAt: string;
  thumbnailUrl?: string;
}

interface Announcement {
  id: string;
  content: string;
  authorName: string;
  roomName: string;
  createdAt: string;
}

interface DashboardV2Response {
  user: {
    id: string;
    name: string;
    email: string;
    role: 'ADMIN' | 'VIEWER';
    lastLoginAt: string | null;
  };

  // Dashboard layout configuration
  layout: DashboardLayoutResponse;

  // Admin-focused widgets
  actionRequired?: {
    totalCount: number;
    unansweredQuestions: number;
    pendingAccessRequests: number;
    /** Room to open for reviewing access requests (most recent pending). */
    latestAccessRequestRoomId?: string;
    items: ActionItem[];
  };

  messages?: {
    unreadCount: number;
  };

  myRooms?: RoomSummary[];

  // Viewer-focused widgets (also useful for admins)
  continueReading?: ContinueReadingItem[];

  bookmarks?: BookmarkItem[];

  myQuestions?: QuestionSummary[];

  announcements?: Announcement[];
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function getActorName(
  actor: { firstName: string | null; lastName: string | null; email: string } | null,
  fallbackEmail?: string | null
): string {
  if (actor) {
    const name = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim();
    return name || actor.email;
  }
  return fallbackEmail || 'Unknown';
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await requireAuth();
    const orgId = session.organizationId;
    const userId = session.userId;

    const data = await withOrgContext(orgId, async (tx) => {
      // Get user info and role
      const userOrg = await tx.userOrganization.findUnique({
        where: {
          organizationId_userId: { organizationId: orgId, userId },
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              lastLoginAt: true,
            },
          },
        },
      });

      if (!userOrg) {
        throw new Error('User not found in organization');
      }

      const user = userOrg.user;
      const userRole = userOrg.role;
      const isAdmin = userRole === 'ADMIN';
      const lastLoginAt = user.lastLoginAt;

      // Get user's dashboard layout
      const savedLayout = await tx.userDashboardLayout.findUnique({
        where: {
          organizationId_userId_role: {
            organizationId: orgId,
            userId,
            role: userRole,
          },
        },
      });

      const defaultLayout = getDefaultLayout(userRole);
      const layoutNeedsMigration =
        !!savedLayout && savedLayout.version < CURRENT_DASHBOARD_LAYOUT_VERSION;
      const savedDesktopLayout = savedLayout?.desktopLayout as unknown as
        | WidgetPosition[]
        | undefined;
      const normalizedSavedLayout = savedDesktopLayout ? normalizeLayout(savedDesktopLayout) : null;

      if (savedLayout && layoutNeedsMigration) {
        await tx.userDashboardLayout.update({
          where: { id: savedLayout.id },
          data: {
            version: CURRENT_DASHBOARD_LAYOUT_VERSION,
            desktopLayout: JSON.parse(JSON.stringify(defaultLayout)),
            collapsedWidgets: [],
          },
        });
      }

      const layoutResponse: DashboardLayoutResponse =
        savedLayout && normalizedSavedLayout && !layoutNeedsMigration
          ? {
              desktopLayout: normalizedSavedLayout,
              collapsedWidgets: savedLayout.collapsedWidgets,
              densityMode: savedLayout.densityMode as 'compact' | 'cozy',
              welcomeBannerDismissed: savedLayout.welcomeBannerDismissed,
              isDefault: false,
            }
          : {
              desktopLayout: defaultLayout,
              collapsedWidgets: [],
              densityMode: (savedLayout?.densityMode as 'compact' | 'cozy' | undefined) ?? 'cozy',
              welcomeBannerDismissed: savedLayout?.welcomeBannerDismissed ?? false,
              isDefault: true,
            };

      // Build response based on role
      const response: DashboardV2Response = {
        user: {
          id: user.id,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email,
          email: user.email,
          role: userRole,
          lastLoginAt: lastLoginAt?.toISOString() || null,
        },
        layout: layoutResponse,
      };

      // Run queries in parallel for efficiency
      const [
        // Action items (admin only)
        unansweredQuestions,
        pendingAccessRequests,
        latestAccessRequest,
        // Messages
        unreadMessages,
        // Rooms
        userRooms,
        roomAdminElevations,
        newDocCountsByRoom,
        // Bookmarks
        userBookmarks,
        // Questions (user's own)
        userQuestions,
        // Continue reading
        recentPageViews,
        // Announcements
        announcements,
      ] = await Promise.all([
        // Unanswered questions (admins see all, viewers see none for action items)
        isAdmin
          ? tx.question.findMany({
              where: {
                organizationId: orgId,
                status: 'OPEN',
              },
              include: {
                room: { select: { id: true, name: true } },
                document: { select: { name: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 10,
            })
          : Promise.resolve([]),

        // Pending access requests
        isAdmin
          ? tx.accessRequest.count({
              where: { organizationId: orgId, status: 'PENDING' },
            })
          : Promise.resolve(0),

        // Most recent pending access request (destination for review actions)
        isAdmin
          ? tx.accessRequest.findFirst({
              where: { organizationId: orgId, status: 'PENDING' },
              select: { roomId: true },
              orderBy: { createdAt: 'desc' },
            })
          : Promise.resolve(null),

        // Unread messages count
        tx.message.count({
          where: {
            organizationId: orgId,
            recipientUserId: userId,
            isRead: false,
          },
        }),

        // User's rooms. Same visibility rule as GET /api/rooms: admins see all
        // non-closed rooms, non-admins see ACTIVE rooms only.
        tx.room.findMany({
          where: {
            organizationId: orgId,
            ...(isAdmin ? { status: { not: 'CLOSED' as const } } : { status: 'ACTIVE' as const }),
          },
          select: {
            id: true,
            name: true,
            description: true,
            status: true,
            updatedAt: true,
            _count: {
              select: {
                documents: { where: { status: 'ACTIVE' } },
                links: { where: { isActive: true } },
                questions: { where: { status: 'OPEN' } },
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        }),

        // Room-scoped admin elevations for the caller (CANONICAL_CONTRACTS §2)
        tx.roleAssignment.findMany({
          where: {
            organizationId: orgId,
            userId,
            scopeType: 'ROOM',
            role: 'ADMIN',
            roomId: { not: null },
          },
          select: { roomId: true },
        }),

        // Per-room count of documents added since the caller's previous login
        lastLoginAt
          ? tx.document.groupBy({
              by: ['roomId'],
              where: {
                organizationId: orgId,
                status: 'ACTIVE',
                createdAt: { gt: lastLoginAt },
              },
              _count: { _all: true },
            })
          : Promise.resolve([]),

        // User's bookmarks
        tx.bookmark.findMany({
          where: {
            organizationId: orgId,
            userId,
          },
          include: {
            document: {
              select: {
                id: true,
                name: true,
                folder: { select: { name: true } },
              },
            },
            room: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),

        // User's questions
        tx.question.findMany({
          where: {
            organizationId: orgId,
            askedByUserId: userId,
          },
          include: {
            room: { select: { id: true, name: true } },
            document: { select: { name: true } },
            answers: { select: { createdAt: true }, take: 1, orderBy: { createdAt: 'desc' } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),

        // Recent page views for "continue reading"
        tx.pageView.findMany({
          where: {
            organizationId: orgId,
            userId,
          },
          include: {
            document: {
              select: {
                id: true,
                name: true,
              },
            },
            room: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          distinct: ['documentId'],
        }),

        // Room announcements (messages marked as announcements)
        tx.message.findMany({
          where: {
            organizationId: orgId,
            isAnnouncement: true,
          },
          include: {
            sender: { select: { firstName: true, lastName: true, email: true } },
            room: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);

      // Root folders for the listed rooms (landing card contents peek)
      const rootFolders = await tx.folder.findMany({
        where: {
          organizationId: orgId,
          roomId: { in: userRooms.map((r) => r.id) },
          parentId: null,
        },
        select: {
          id: true,
          name: true,
          roomId: true,
          _count: { select: { documents: { where: { status: 'ACTIVE' } } } },
        },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      });

      // Build action required (admins only)
      if (isAdmin) {
        const actionItems: ActionItem[] = [];

        // Add unanswered questions
        for (const q of unansweredQuestions) {
          actionItems.push({
            id: q.id,
            type: 'question',
            title: q.subject.slice(0, 100) + (q.subject.length > 100 ? '...' : ''),
            description: q.document?.name ? `About: ${q.document.name}` : 'General question',
            roomId: q.room.id,
            roomName: q.room.name,
            createdAt: q.createdAt.toISOString(),
            priority: Date.now() - q.createdAt.getTime() > 24 * 60 * 60 * 1000 ? 'high' : 'normal',
          });
        }

        response.actionRequired = {
          totalCount: unansweredQuestions.length + pendingAccessRequests,
          unansweredQuestions: unansweredQuestions.length,
          pendingAccessRequests,
          latestAccessRequestRoomId: latestAccessRequest?.roomId ?? undefined,
          items: actionItems.slice(0, 10),
        };
      }

      // Messages: the landing consumes the unread count only.
      response.messages = { unreadCount: unreadMessages };

      // My Rooms
      const elevatedRoomIds = new Set(roomAdminElevations.map((a) => a.roomId));
      const newDocCountByRoomId = new Map(newDocCountsByRoom.map((g) => [g.roomId, g._count._all]));
      const foldersByRoomId = new Map<
        string,
        { id: string; name: string; documentCount: number }[]
      >();
      for (const f of rootFolders) {
        const list = foldersByRoomId.get(f.roomId) ?? [];
        if (list.length < 4) {
          list.push({ id: f.id, name: f.name, documentCount: f._count.documents });
        }
        foldersByRoomId.set(f.roomId, list);
      }

      response.myRooms = userRooms.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        myRole: isAdmin || elevatedRoomIds.has(r.id) ? ('ADMIN' as const) : ('VIEWER' as const),
        documentCount: r._count.documents,
        viewerCount: r._count.links, // Active links as proxy for viewer access
        questionCount: r._count.questions,
        newDocumentCount: newDocCountByRoomId.get(r.id) ?? 0,
        topFolders: foldersByRoomId.get(r.id) ?? [],
        lastActivity: r.updatedAt.toISOString(),
      }));

      // Continue Reading
      response.continueReading = recentPageViews.map((pv) => ({
        documentId: pv.document.id,
        documentName: pv.document.name,
        roomId: pv.room.id,
        roomName: pv.room.name,
        lastPage: pv.pageNumber || undefined,
        totalPages: undefined, // Would require additional query for version pageCount
        lastViewedAt: pv.createdAt.toISOString(),
      }));

      // Bookmarks
      response.bookmarks = userBookmarks.map((b) => ({
        id: b.id,
        documentId: b.document.id,
        documentName: b.document.name,
        roomId: b.room.id,
        roomName: b.room.name,
        folderPath: b.document.folder?.name,
        createdAt: b.createdAt.toISOString(),
      }));

      // My Questions
      response.myQuestions = userQuestions.map((q) => ({
        id: q.id,
        question: q.subject,
        status: q.status as 'OPEN' | 'ANSWERED' | 'CLOSED',
        roomId: q.room.id,
        roomName: q.room.name,
        documentName: q.document?.name,
        createdAt: q.createdAt.toISOString(),
        answeredAt: q.answers[0]?.createdAt.toISOString(),
      }));

      // Announcements
      response.announcements = announcements.map((a) => ({
        id: a.id,
        content: a.body,
        authorName: getActorName(a.sender),
        roomName: a.room?.name || 'General',
        createdAt: a.createdAt.toISOString(),
      }));

      return response;
    });

    // lastLoginAt is stamped by the login and 2FA-validate routes only.
    // Mutating it here made every dashboard refresh wipe the "new since your
    // last visit" freshness counts computed against it.

    return NextResponse.json(data);
  } catch (error) {
    console.error('[DashboardV2] GET Error:', error);
    return NextResponse.json({ error: 'Failed to get dashboard data' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT handler - Save dashboard layout
// ---------------------------------------------------------------------------

interface LayoutUpdatePayload {
  layout: {
    desktopLayout?: WidgetPosition[];
    collapsedWidgets?: string[];
    densityMode?: 'compact' | 'cozy';
    welcomeBannerDismissed?: boolean;
  };
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireAuth();
    const orgId = session.organizationId;
    const userId = session.userId;

    const body = (await request.json()) as LayoutUpdatePayload;

    if (!body.layout) {
      return NextResponse.json({ error: 'Missing layout data' }, { status: 400 });
    }

    const { desktopLayout, collapsedWidgets, densityMode, welcomeBannerDismissed } = body.layout;

    await withOrgContext(orgId, async (tx) => {
      // Get user's role
      const userOrg = await tx.userOrganization.findUnique({
        where: {
          organizationId_userId: { organizationId: orgId, userId },
        },
        select: { role: true },
      });

      if (!userOrg) {
        throw new Error('User not found in organization');
      }

      // Upsert the layout
      // Normalize layout to fix any corrupted y-positions before saving
      const normalizedLayout = desktopLayout
        ? normalizeLayout(desktopLayout)
        : getDefaultLayout(userOrg.role);

      // Cast to JSON-compatible type for Prisma
      const layoutJson = JSON.parse(JSON.stringify(normalizedLayout));
      const updateLayoutJson = desktopLayout
        ? JSON.parse(JSON.stringify(normalizedLayout))
        : undefined;

      await tx.userDashboardLayout.upsert({
        where: {
          organizationId_userId_role: {
            organizationId: orgId,
            userId,
            role: userOrg.role,
          },
        },
        create: {
          organizationId: orgId,
          userId,
          role: userOrg.role,
          version: CURRENT_DASHBOARD_LAYOUT_VERSION,
          desktopLayout: layoutJson,
          collapsedWidgets: collapsedWidgets ?? [],
          densityMode: densityMode ?? 'cozy',
          welcomeBannerDismissed: welcomeBannerDismissed ?? false,
        },
        update: {
          version: CURRENT_DASHBOARD_LAYOUT_VERSION,
          ...(updateLayoutJson !== undefined && { desktopLayout: updateLayoutJson }),
          ...(collapsedWidgets !== undefined && { collapsedWidgets }),
          ...(densityMode !== undefined && { densityMode }),
          ...(welcomeBannerDismissed !== undefined && { welcomeBannerDismissed }),
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DashboardV2] PUT Error:', error);
    return NextResponse.json({ error: 'Failed to save layout' }, { status: 500 });
  }
}
