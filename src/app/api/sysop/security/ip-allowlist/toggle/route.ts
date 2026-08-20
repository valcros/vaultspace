import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { SysopIpAllowlistService } from '@/lib/sysop/ipAllowlist';
import { getClientIp } from '@/lib/utils/ip';
import { headers } from 'next/headers';

export async function POST(request: Request) {
  try {
    const session = await requirePlatformOperator();
    const headersList = await headers();
    const currentClientIp = getClientIp(headersList);
    const { enabled } = await request.json();

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Parameter "enabled" must be a boolean' }, { status: 400 });
    }

    const result = await SysopIpAllowlistService.setEnforcement(
      session.userId,
      session.organizationId,
      currentClientIp,
      enabled
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message || 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update enforcement settings' },
      { status: 400 }
    );
  }
}
