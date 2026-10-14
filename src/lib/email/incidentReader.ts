import { bootstrapDb } from '@/lib/db';

/** Call only after a platform-operator capability check. */
export async function listRecentEmailIncidents() {
  const [incidents, openCount] = await Promise.all([
    bootstrapDb.emailDeliveryIncident.findMany({
      orderBy: [{ acknowledgedAt: { sort: 'desc', nulls: 'first' } }, { eventAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        provider: true,
        providerMessageId: true,
        recipientDomain: true,
        status: true,
        failureReason: true,
        smtpStatusCode: true,
        enhancedSmtpStatusCode: true,
        recipientMailServer: true,
        eventAt: true,
        acknowledgedAt: true,
      },
    }),
    bootstrapDb.emailDeliveryIncident.count({ where: { acknowledgedAt: null } }),
  ]);
  return { incidents, openCount };
}
