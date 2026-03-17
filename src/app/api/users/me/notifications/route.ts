/**
 * Notification Preferences API (F003, F043)
 *
 * GET   /api/users/me/notifications - Get notification preferences
 * PATCH /api/users/me/notifications - Update notification preferences
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/users/me/notifications
 * Get current user's notification preferences
 */
export async function GET() {
  try {
    const session = await requireAuth();

    // Use RLS context for org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Find user organization
      const userOrg = await tx.userOrganization.findFirst({
        where: {
          userId: session.userId,
          organizationId: session.organizationId,
        },
      });

      if (!userOrg) {
        return { error: 'User organization not found', status: 404 };
      }

      // Get or create notification preferences
      let preferences = await tx.notificationPreference.findUnique({
        where: { userOrganizationId: userOrg.id },
      });

      if (!preferences) {
        // Create default preferences
        preferences = await tx.notificationPreference.create({
          data: {
            organizationId: session.organizationId,
            userOrganizationId: userOrg.id,
          },
        });
      }

      return { preferences };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ preferences: result.preferences });
  } catch (error) {
    console.error('[NotificationsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get notification preferences' }, { status: 500 });
  }
}

/**
 * PATCH /api/users/me/notifications
 * Update notification preferences
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();

    const body = await request.json();
    const {
      emailOnDocumentViewed,
      emailOnDocumentUploaded,
      emailOnAccessRevoked,
      emailDailyDigest,
      digestFrequency,
      quietHoursStart,
      quietHoursEnd,
    } = body;

    // Validate digest frequency
    const validFrequencies = ['IMMEDIATE', 'DAILY', 'WEEKLY'];
    if (digestFrequency !== undefined && !validFrequencies.includes(digestFrequency)) {
      return NextResponse.json({ error: 'Invalid digest frequency' }, { status: 400 });
    }

    // Validate quiet hours format (HH:MM)
    const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;
    if (
      quietHoursStart !== undefined &&
      quietHoursStart !== null &&
      !timeRegex.test(quietHoursStart)
    ) {
      return NextResponse.json(
        { error: 'Invalid quiet hours start format (use HH:MM)' },
        { status: 400 }
      );
    }
    if (quietHoursEnd !== undefined && quietHoursEnd !== null && !timeRegex.test(quietHoursEnd)) {
      return NextResponse.json(
        { error: 'Invalid quiet hours end format (use HH:MM)' },
        { status: 400 }
      );
    }

    // Use RLS context for org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Find user organization
      const userOrg = await tx.userOrganization.findFirst({
        where: {
          userId: session.userId,
          organizationId: session.organizationId,
        },
      });

      if (!userOrg) {
        return { error: 'User organization not found', status: 404 };
      }

      // Upsert notification preferences
      const preferences = await tx.notificationPreference.upsert({
        where: { userOrganizationId: userOrg.id },
        create: {
          organizationId: session.organizationId,
          userOrganizationId: userOrg.id,
          ...(emailOnDocumentViewed !== undefined && { emailOnDocumentViewed }),
          ...(emailOnDocumentUploaded !== undefined && { emailOnDocumentUploaded }),
          ...(emailOnAccessRevoked !== undefined && { emailOnAccessRevoked }),
          ...(emailDailyDigest !== undefined && { emailDailyDigest }),
          ...(digestFrequency !== undefined && { digestFrequency }),
          ...(quietHoursStart !== undefined && { quietHoursStart }),
          ...(quietHoursEnd !== undefined && { quietHoursEnd }),
        },
        update: {
          ...(emailOnDocumentViewed !== undefined && { emailOnDocumentViewed }),
          ...(emailOnDocumentUploaded !== undefined && { emailOnDocumentUploaded }),
          ...(emailOnAccessRevoked !== undefined && { emailOnAccessRevoked }),
          ...(emailDailyDigest !== undefined && { emailDailyDigest }),
          ...(digestFrequency !== undefined && { digestFrequency }),
          ...(quietHoursStart !== undefined && { quietHoursStart }),
          ...(quietHoursEnd !== undefined && { quietHoursEnd }),
        },
      });

      return { preferences };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ preferences: result.preferences });
  } catch (error) {
    console.error('[NotificationsAPI] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update notification preferences' },
      { status: 500 }
    );
  }
}
