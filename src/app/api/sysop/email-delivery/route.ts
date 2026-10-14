import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { assertPlatformCapability } from '@/lib/sysop/capabilityGuard';
import { captureSecurityAudit } from '@/lib/audit/securityAudit';
import { listAcsDeliveryFailures } from '@/lib/email/azureDeliveryLogSource';
import { listRecentEmailIncidents } from '@/lib/email/incidentReader';
import { isAzureMode } from '@/lib/deployment-mode';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await requirePlatformOperator();
    await assertPlatformCapability(session, 'SYSOP_OVERVIEW_READ');
    await captureSecurityAudit({
      organizationId: session.organizationId,
      eventType: 'SYSOP_ACCESSED',
      actorType: 'ADMIN',
      actorId: session.userId,
      requestId: `sysop_email_delivery_${Date.now()}`,
      description: 'Platform email delivery diagnostics accessed',
      metadata: { route: '/api/sysop/email-delivery' },
    });
    const observations = isAzureMode() ? await listAcsDeliveryFailures() : [];
    const incidentQueueEnabled = process.env['EMAIL_INCIDENT_VIEW_ENABLED'] === 'true';
    const incidentQueue = incidentQueueEnabled
      ? await listRecentEmailIncidents()
      : { incidents: [], openCount: 0 };
    return NextResponse.json(
      {
        source: isAzureMode() ? 'azure-monitor' : 'not-configured',
        retentionDays: isAzureMode() ? 30 : 0,
        observedAt: new Date().toISOString(),
        observations,
        incidentQueueEnabled,
        ...incidentQueue,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error(
      JSON.stringify({
        component: 'email-delivery-diagnostics',
        event: 'query_failed',
        code:
          error instanceof Error && /^EMAIL_DELIVERY_LOG_/.test(error.message)
            ? error.message
            : 'EMAIL_DELIVERY_LOG_UNAVAILABLE',
      })
    );
    return NextResponse.json({ error: 'Delivery diagnostics unavailable' }, { status: 503 });
  }
}
