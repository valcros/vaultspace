import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { bootstrapDb as db } from '@/lib/db';
import { captureSecurityAudit } from '@/lib/audit/securityAudit';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Cross-tenant read: platform-operator grant required (not org role).
    const session = await requirePlatformOperator();

    await captureSecurityAudit({
      organizationId: session.organizationId,
      eventType: 'SYSOP_ACCESSED',
      actorType: 'ADMIN',
      actorId: session.userId,
      requestId: `sysop_req_${Date.now()}`,
      description: 'SysOp overview telemetry accessed by platform operator',
      metadata: { route: '/api/sysop/overview' },
    });

    // Fetch platform tenant metrics
    const [
      orgCount,
      userCount,
      roomCount,
      docCount,
      pendingUnverifiedOrglessUsers,
      orgs,
      latestOrganizationActivity,
    ] = await Promise.all([
      db.organization.count(),
      db.user.count(),
      db.room.count(),
      db.document.count(),
      // Inert pending registrations: unverified AND not attached to any org. This
      // matches the lifecycle-janitor population, not all unverified users (an
      // invited-but-unverified user with a membership is not inert).
      db.user.count({
        where: { emailVerifiedAt: null, organizations: { none: {} } },
      }),
      db.organization.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          createdAt: true,
          _count: {
            select: {
              rooms: true,
              // Count only active memberships so a disabled second member does
              // not mask an otherwise-empty shell.
              users: { where: { isActive: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      db.session.groupBy({
        by: ['organizationId'],
        where: { organizationId: { not: null } },
        _max: { lastActiveAt: true },
      }),
    ]);

    const lastAccessByOrganizationId = new Map(
      latestOrganizationActivity.flatMap((activity) =>
        activity.organizationId && activity._max.lastActiveAt
          ? [[activity.organizationId, activity._max.lastActiveAt] as const]
          : []
      )
    );

    // Calculate storage quota usage for demo/staging
    const orgSummaries = orgs.map((org) => {
      const estimatedStorageBytes = (org._count.rooms * 45 + 120) * 1024 * 1024; // MB to Bytes estimate
      const quotaLimitBytes = 5 * 1024 * 1024 * 1024; // 5GB limit default
      const usagePercentage = Math.min(
        100,
        Math.round((estimatedStorageBytes / quotaLimitBytes) * 100)
      );

      let quotaAlertLevel: 'NORMAL' | 'WARNING_90' | 'CRITICAL_98' = 'NORMAL';
      if (usagePercentage >= 98) {
        quotaAlertLevel = 'CRITICAL_98';
      } else if (usagePercentage >= 90) {
        quotaAlertLevel = 'WARNING_90';
      }

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        isActive: org.isActive,
        roomCount: org._count.rooms,
        userCount: org._count.users,
        // A tenant with no rooms and at most one active member is an empty shell
        // (abandoned self-service signup or a machine-created org). Surfaced so
        // operators can distinguish real tenants from junk.
        isEmpty: org._count.rooms === 0 && org._count.users <= 1,
        estimatedStorageBytes,
        usagePercentage,
        quotaAlertLevel,
        createdAt: org.createdAt.toISOString(),
        lastAccessAt: lastAccessByOrganizationId.get(org.id)?.toISOString() ?? null,
      };
    });

    const quotaAlertsCount = orgSummaries.filter((o) => o.quotaAlertLevel !== 'NORMAL').length;

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      summary: {
        totalOrganizations: orgCount,
        totalUsers: userCount,
        totalRooms: roomCount,
        totalDocuments: docCount,
        quotaAlertsCount,
        emptyOrganizationsCount: orgSummaries.filter((o) => o.isEmpty).length,
        pendingUnverifiedOrglessUsers,
      },
      infrastructure: {
        environment: process.env['DEPLOYMENT_MODE'] === 'azure' ? 'Managed cloud' : 'Self-hosted',
        governance: 'Platform operating controls',
        status: 'HEALTHY',
      },
      organizations: orgSummaries,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('SysOp overview API error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
