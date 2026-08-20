import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { SysopIpAllowlistService } from '@/lib/sysop/ipAllowlist';
import { getClientIp } from '@/lib/utils/ip';
import { db } from '@/lib/db';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requirePlatformOperator();
    const headersList = await headers();
    const currentClientIp = getClientIp(headersList);

    const [entries, settings] = await Promise.all([
      db.sysopIpAllowlist.findMany({
        orderBy: { createdAt: 'desc' },
      }),
      db.sysopSecuritySettings.findUnique({
        where: { id: 'global' },
      }),
    ]);

    const isCurrentIpCovered = currentClientIp
      ? (await SysopIpAllowlistService.isClientIpAllowed(currentClientIp)).allowed
      : false;

    return NextResponse.json({
      currentClientIp,
      isCurrentIpCovered,
      ipAllowlistEnabled: settings?.ipAllowlistEnabled ?? false,
      entries,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message || 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to fetch IP allowlist configuration' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requirePlatformOperator();
    const { cidr, label } = await request.json();

    if (!cidr || typeof cidr !== 'string') {
      return NextResponse.json({ error: 'Valid IP address or CIDR notation is required' }, { status: 400 });
    }

    const entry = await SysopIpAllowlistService.addEntry(
      session.userId,
      session.organizationId,
      cidr,
      label
    );

    return NextResponse.json({ success: true, entry }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message || 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add allowlist entry' },
      { status: 400 }
    );
  }
}
