import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { SysopIpAllowlistService } from '@/lib/sysop/ipAllowlist';
import { getClientIp } from '@/lib/utils/ip';
import { headers } from 'next/headers';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePlatformOperator();
    const headersList = await headers();
    const currentClientIp = getClientIp(headersList);
    const { id } = await context.params;

    await SysopIpAllowlistService.deleteEntry(
      session.userId,
      session.organizationId,
      currentClientIp,
      id
    );

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message || 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete allowlist entry' },
      { status: 400 }
    );
  }
}
