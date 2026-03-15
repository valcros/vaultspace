/**
 * Notification Preferences API (F003, F043)
 *
 * GET   /api/users/me/notifications - Get notification preferences
 * PATCH /api/users/me/notifications - Update notification preferences
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/users/me/notifications
 * Get current user's notification preferences
 */
export async function GET() {
  try {
    const session = await requireAuth();

    // Find user organization
    const userOrg = await db.userOrganization.findFirst({
      where: {
        userId: session.userId,
        organizationId: session.organizationId,
      },
    });

    if (!userOrg) {
      return NextResponse.json(
        { error: 'User organization not found' },
        { status: 404 }
      );
    }

    // Get or create notification preferences
    let preferences = await db.notificationPreference.findUnique({
      where: { userOrganizationId: userOrg.id },
    });

    if (!preferences) {
      // Create default preferences
      preferences = await db.notificationPreference.create({
        data: {
          organizationId: session.organizationId,
          userOrganizationId: userOrg.id,
        },
      });
    }

    return NextResponse.json({ preferences });
  } catch (error) {
    console.error('[NotificationsAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get notification preferences' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/users/me/notifications
 * Update notification preferences
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Find user organization
    const userOrg = await db.userOrganization.findFirst({
      where: {
        userId: session.userId,
        organizationId: session.organizationId,
      },
    });

    if (!userOrg) {
      return NextResponse.json(
        { error: 'User organization not found' },
        { status: 404 }
      );
    }

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
      return NextResponse.json(
        { error: 'Invalid digest frequency' },
        { status: 400 }
      );
    }

    // Validate quiet hours format (HH:MM)
    const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;
    if (quietHoursStart !== undefined && quietHoursStart !== null && !timeRegex.test(quietHoursStart)) {
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

    // Upsert notification preferences
    const preferences = await db.notificationPreference.upsert({
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

    return NextResponse.json({ preferences });
  } catch (error) {
    console.error('[NotificationsAPI] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update notification preferences' },
      { status: 500 }
    );
  }
}
