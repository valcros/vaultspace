import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { bootstrapDb as db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Cross-tenant read: platform-operator grant required (not org role).
    await requirePlatformOperator();

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
        environment: 'Azure Staging (rg-vaultspace-staging)',
        subscription: 'Munger subscription 1 (041a67eb-fec8-41a4-9d70-c35863268cd6)',
        webApp: 'ca-vaultspace-web--0000304',
        databaseHost: 'psql-vaultspace-staging.postgres.database.azure.com',
        aiService: 'aoai-vaultspace-staging (S0 Tier)',
        vmHost: 'vm-vaultspace-agent-host (Standard_D4s_v5 at 4.154.18.36)',
        governance: 'DA-VAL-001 Value & Simplicity Gate',
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
