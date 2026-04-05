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
import { getDefaultLayout } from '@/lib/dashboard-defaults';
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

interface MessagePreview {
  id: string;
  senderName: string;
  subject: string;
  preview: string;
  createdAt: string;
  isRead: boolean;
  roomName?: string;
}

interface RoomSummary {
  id: string;
  name: string;
  status: string;
  documentCount: number;
  viewerCount: number;
  questionCount: number;
  lastActivity?: string;
}

interface ActivityItem {
  id: string;
  eventType: string;
  actorName: string;
  actorEmail?: string;
  description: string;
  roomId?: string;
  roomName?: string;
  documentId?: string;
  documentName?: string;
  createdAt: string;
}

interface DocumentSummary {
  id: string;
  name: string;
  roomId: string;
  roomName: string;
  folderPath?: string;
  createdAt: string;
  updatedAt?: string;
  isNew: boolean;
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

interface ChecklistProgress {
  id: string;
  name: string;
  roomId: string;
  roomName: string;
  completedCount: number;
  totalCount: number;
  missingItems: string[];
}

interface EngagementData {
  period: '7d' | '30d';
  totalViews: number;
  uniqueViewers: number;
  downloads: number;
  dailyActivity: { date: string; views: number }[];
  topDocuments: { id: string; name: string; roomName: string; views: number }[];
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
    items: ActionItem[];
  };

  messages?: {
    unreadCount: number;
    recent: MessagePreview[];
  };

  myRooms?: RoomSummary[];

  recentActivity?: ActivityItem[];

  engagementInsights?: EngagementData;

  checklistProgress?: ChecklistProgress[];

  // Viewer-focused widgets (also useful for admins)
  continueReading?: ContinueReadingItem[];

  bookmarks?: BookmarkItem[];

  newSinceLastVisit?: {
    newDocuments: DocumentSummary[];
    updatedDocuments: DocumentSummary[];
  };

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

      // Build layout response
      const defaultLayout = getDefaultLayout(userRole);
      const layoutResponse: DashboardLayoutResponse = savedLayout
        ? {
            desktopLayout: savedLayout.desktopLayout as unknown as WidgetPosition[],
            collapsedWidgets: savedLayout.collapsedWidgets,
            densityMode: savedLayout.densityMode as 'compact' | 'cozy',
            welcomeBannerDismissed: savedLayout.welcomeBannerDismissed,
            isDefault: false,
          }
        : {
            desktopLayout: defaultLayout,
            collapsedWidgets: [],
            densityMode: 'cozy',
            welcomeBannerDismissed: false,
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
        // Messages
        unreadMessages,
        recentMessages,
        // Rooms
        userRooms,
        // Activity
        recentEvents,
        // Bookmarks
        userBookmarks,
        // Questions (user's own)
        userQuestions,
        // Continue reading
        recentPageViews,
        // Engagement (last 7 days)
        viewsLast7Days,
        // Checklists
        checklists,
        // New documents since last login
        newDocs,
        updatedDocs,
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

        // Unread messages count
        tx.message.count({
          where: {
            organizationId: orgId,
            recipientUserId: userId,
            isRead: false,
          },
        }),

        // Recent messages
        tx.message.findMany({
          where: {
            organizationId: orgId,
            recipientUserId: userId,
          },
          include: {
            sender: { select: { firstName: true, lastName: true, email: true } },
            room: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),

        // User's rooms (all users see all non-closed rooms in their org)
        tx.room.findMany({
          where: {
            organizationId: orgId,
            status: { not: 'CLOSED' },
          },
          include: {
            _count: {
              select: {
                documents: { where: { status: 'ACTIVE' } },
                links: { where: { isActive: true } },
                questions: { where: { status: 'OPEN' } },
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        }),

        // Recent activity events
        tx.event.findMany({
          where: { organizationId: orgId },
          include: {
            actor: { select: { firstName: true, lastName: true, email: true } },
            room: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 15,
        }),

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
            room: { select: { name: true } },
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

        // Views in last 7 days for engagement chart
        tx.event.groupBy({
          by: ['createdAt'],
          where: {
            organizationId: orgId,
            eventType: { in: ['DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED', 'PAGE_VIEWED'] },
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
          _count: true,
        }),

        // Checklist progress (for rooms in the org)
        tx.checklist.findMany({
          where: {
            organizationId: orgId,
          },
          include: {
            room: { select: { id: true, name: true } },
            items: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
          take: 5,
        }),

        // New documents since last login
        lastLoginAt
          ? tx.document.findMany({
              where: {
                organizationId: orgId,
                status: 'ACTIVE',
                createdAt: { gt: lastLoginAt },
              },
              include: {
                room: { select: { id: true, name: true } },
                folder: { select: { name: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 10,
            })
          : Promise.resolve([]),

        // Updated documents since last login
        lastLoginAt
          ? tx.document.findMany({
              where: {
                organizationId: orgId,
                status: 'ACTIVE',
                updatedAt: { gt: lastLoginAt },
                createdAt: { lte: lastLoginAt }, // Not new, just updated
              },
              include: {
                room: { select: { id: true, name: true } },
                folder: { select: { name: true } },
              },
              orderBy: { updatedAt: 'desc' },
              take: 10,
            })
          : Promise.resolve([]),

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

      // Get top viewed documents
      const topDocuments = await tx.document.findMany({
        where: {
          organizationId: orgId,
          status: 'ACTIVE',
          viewCount: { gt: 0 },
        },
        include: {
          room: { select: { name: true } },
        },
        orderBy: { viewCount: 'desc' },
        take: 5,
      });

      // Get unique viewer count
      const uniqueViewers = await tx.event.groupBy({
        by: ['actorId'],
        where: {
          organizationId: orgId,
          eventType: { in: ['DOCUMENT_VIEWED', 'PAGE_VIEWED'] },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          actorId: { not: null },
        },
      });

      // Get download count
      const downloadCount = await tx.event.count({
        where: {
          organizationId: orgId,
          eventType: 'DOCUMENT_DOWNLOADED',
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
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
          items: actionItems.slice(0, 10),
        };
      }

      // Messages
      response.messages = {
        unreadCount: unreadMessages,
        recent: recentMessages.map((m) => ({
          id: m.id,
          senderName: getActorName(m.sender),
          subject: m.subject,
          preview: m.body.slice(0, 100) + (m.body.length > 100 ? '...' : ''),
          createdAt: m.createdAt.toISOString(),
          isRead: m.isRead,
          roomName: m.room?.name,
        })),
      };

      // My Rooms
      response.myRooms = userRooms.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        documentCount: r._count.documents,
        viewerCount: r._count.links, // Active links as proxy for viewer access
        questionCount: r._count.questions,
        lastActivity: r.updatedAt.toISOString(),
      }));

      // Recent Activity
      response.recentActivity = recentEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actorName: getActorName(e.actor, e.actorEmail),
        actorEmail: e.actorEmail || undefined,
        description: e.description || e.eventType.replace(/_/g, ' ').toLowerCase(),
        roomId: e.room?.id,
        roomName: e.room?.name,
        documentId: e.documentId || undefined,
        documentName: undefined, // Document name not loaded for performance
        createdAt: e.createdAt.toISOString(),
      }));

      // Engagement Insights
      const dailyViewCounts = new Map<string, number>();
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0] as string;
        dailyViewCounts.set(dateKey, 0);
      }

      for (const view of viewsLast7Days) {
        const dateKey = new Date(view.createdAt).toISOString().split('T')[0] as string;
        const currentCount = dailyViewCounts.get(dateKey);
        if (currentCount !== undefined) {
          dailyViewCounts.set(dateKey, currentCount + view._count);
        }
      }

      response.engagementInsights = {
        period: '7d',
        totalViews: viewsLast7Days.reduce((sum, v) => sum + v._count, 0),
        uniqueViewers: uniqueViewers.length,
        downloads: downloadCount,
        dailyActivity: Array.from(dailyViewCounts.entries()).map(([date, views]) => ({
          date,
          views,
        })),
        topDocuments: topDocuments.map((d) => ({
          id: d.id,
          name: d.name,
          roomName: d.room.name,
          views: d.viewCount,
        })),
      };

      // Checklist Progress
      response.checklistProgress = checklists.map((c) => ({
        id: c.id,
        name: c.name,
        roomId: c.room.id,
        roomName: c.room.name,
        completedCount: c.items.filter((i) => i.status === 'COMPLETE').length,
        totalCount: c.items.length,
        missingItems: c.items
          .filter((i) => i.status !== 'COMPLETE' && i.status !== 'NOT_APPLICABLE')
          .map((i) => i.name)
          .slice(0, 5),
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

      // New Since Last Visit
      response.newSinceLastVisit = {
        newDocuments: newDocs.map((d) => ({
          id: d.id,
          name: d.name,
          roomId: d.room.id,
          roomName: d.room.name,
          folderPath: d.folder?.name,
          createdAt: d.createdAt.toISOString(),
          isNew: true,
        })),
        updatedDocuments: updatedDocs.map((d) => ({
          id: d.id,
          name: d.name,
          roomId: d.room.id,
          roomName: d.room.name,
          folderPath: d.folder?.name,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
          isNew: false,
        })),
      };

      // My Questions
      response.myQuestions = userQuestions.map((q) => ({
        id: q.id,
        question: q.subject,
        status: q.status as 'OPEN' | 'ANSWERED' | 'CLOSED',
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

    // Update last login timestamp
    await withOrgContext(orgId, async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });
    });

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
      // Cast to JSON-compatible type for Prisma
      const layoutJson = desktopLayout
        ? JSON.parse(JSON.stringify(desktopLayout))
        : getDefaultLayout(userOrg.role);
      const updateLayoutJson = desktopLayout
        ? JSON.parse(JSON.stringify(desktopLayout))
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
          desktopLayout: layoutJson,
          collapsedWidgets: collapsedWidgets ?? [],
          densityMode: densityMode ?? 'cozy',
          welcomeBannerDismissed: welcomeBannerDismissed ?? false,
        },
        update: {
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
