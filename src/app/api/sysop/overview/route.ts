import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch platform tenant metrics
    const [orgCount, userCount, roomCount, docCount, orgs] = await Promise.all([
      db.organization.count(),
      db.user.count(),
      db.room.count(),
      db.document.count(),
      db.organization.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          _count: {
            select: {
              rooms: true,
              users: true,
            },
          },
        },
        take: 20,
      }),
    ]);

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
        roomCount: org._count.rooms,
        userCount: org._count.users,
        estimatedStorageBytes,
        usagePercentage,
        quotaAlertLevel,
        createdAt: org.createdAt.toISOString(),
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
      },
      infrastructure: {
        environment: 'Azure Staging (<azure-resource-group>)',
        subscription: 'Azure staging subscription (<azure-subscription-id>)',
        webApp: '<web-container-app>--0000304',
        databaseHost: 'REDACTED.postgres.database.azure.com',
        aiService: 'REDACTED (S0 Tier)',
        vmHost: 'REDACTED (Standard_D4s_v5 at REDACTED)',
        governance: 'DA-VAL-001 Value & Simplicity Gate',
      },
      organizations: orgSummaries,
    });
  } catch (error) {
    console.error('SysOp overview API error:', error);
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
