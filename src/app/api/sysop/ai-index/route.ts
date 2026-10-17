import { NextRequest, NextResponse } from 'next/server';

import { readAiRoomCoverage } from '@/lib/ai/coverage';
import { captureSecurityAudit } from '@/lib/audit/securityAudit';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { requirePlatformOperator } from '@/lib/middleware';
import { assertPlatformCapability } from '@/lib/sysop/capabilityGuard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await requirePlatformOperator();
    await assertPlatformCapability(session, 'SYSOP_OVERVIEW_READ');
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    const roomId = request.nextUrl.searchParams.get('roomId');
    if (!organizationId || !roomId || organizationId.length > 100 || roomId.length > 100) {
      return NextResponse.json(
        { error: 'organizationId and roomId are required' },
        { status: 400 }
      );
    }
    await captureSecurityAudit({
      organizationId: session.organizationId,
      eventType: 'SYSOP_ACCESSED',
      actorType: 'ADMIN',
      actorId: session.userId,
      requestId: `sysop_ai_index_${Date.now()}`,
      description: 'AI index coverage accessed',
      metadata: { route: '/api/sysop/ai-index', organizationId, roomId },
    });
    const coverage = await readAiRoomCoverage(organizationId, roomId);
    return NextResponse.json(coverage, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof Error && error.message === 'AI_ROOM_NOT_FOUND') {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'AI index coverage unavailable' }, { status: 503 });
  }
}
