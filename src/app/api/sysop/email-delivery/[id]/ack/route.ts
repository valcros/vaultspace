import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { isSameOriginRequest } from '@/lib/auth/sameOrigin';
import { bootstrapDb } from '@/lib/db';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { requirePlatformOperator } from '@/lib/middleware';
import { assertPlatformCapability } from '@/lib/sysop/capabilityGuard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  if (!origin || !isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (process.env['EMAIL_INCIDENT_VIEW_ENABLED'] !== 'true') {
    return NextResponse.json({ error: 'Unavailable' }, { status: 404 });
  }
  try {
    const session = await requirePlatformOperator();
    await assertPlatformCapability(session, 'SYSOP_SECURITY_MANAGE');
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const changed = await bootstrapDb.$transaction(async (tx) => {
      const updated = await tx.emailDeliveryIncident.updateMany({
        where: { id, acknowledgedAt: null },
        data: { acknowledgedAt: new Date(), acknowledgedByUserId: session.userId },
      });
      if (updated.count === 0) {
        return false;
      }
      await tx.platformAuditEvent.create({
        data: {
          action: 'EMAIL_DELIVERY_INCIDENT_ACKNOWLEDGED',
          outcome: 'SUCCEEDED',
          actorUserId: session.userId,
          requestId: `email_incident_ack_${randomUUID()}`,
          incidentRef: id,
          previousState: 'OPEN',
          nextState: 'ACKNOWLEDGED',
        },
      });
      return true;
    });
    if (!changed) {
      return NextResponse.json({ error: 'Not found or already acknowledged' }, { status: 404 });
    }
    return NextResponse.redirect(new URL('/sysop/email-delivery', origin), { status: 303 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error(
      JSON.stringify({
        component: 'email-delivery-incidents',
        event: 'ack_failed',
        errorCode: 'EMAIL_INCIDENT_ACK_FAILED',
      })
    );
    return NextResponse.json({ error: 'Acknowledgement unavailable' }, { status: 503 });
  }
}
