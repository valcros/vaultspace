/**
 * Dashboard API v2
 *
 * GET /api/dashboard/v2 - Get role-aware dashboard data with layout
 * PUT /api/dashboard/v2 - Save dashboard layout
 *
 * The GET read logic lives in src/lib/dashboard-data.ts (getDashboardData)
 * so the RSC dashboard landing can call it directly without an HTTP hop.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { getDashboardData } from '@/lib/dashboard-data';
import {
  CURRENT_DASHBOARD_LAYOUT_VERSION,
  getDefaultLayout,
  normalizeLayout,
} from '@/lib/dashboard-defaults';
import type { WidgetPosition } from '@/types/dashboard';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await requireAuth();

    const data = await getDashboardData({
      organizationId: session.organizationId,
      userId: session.userId,
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
