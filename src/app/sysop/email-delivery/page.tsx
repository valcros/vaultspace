import { requirePlatformOperator } from '@/lib/middleware';
import { assertPlatformCapability } from '@/lib/sysop/capabilityGuard';
import { listAcsDeliveryFailures } from '@/lib/email/azureDeliveryLogSource';
import { diagnoseDelivery, type EmailDeliveryObservation } from '@/lib/email/deliveryDiagnostics';
import { listRecentEmailIncidents } from '@/lib/email/incidentReader';
import { isAzureMode } from '@/lib/deployment-mode';
import { listUsablePlatformCapabilities } from '@/lib/sysop/capabilityGuard';

export const dynamic = 'force-dynamic';

function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export default async function EmailDeliveryPage() {
  const session = await requirePlatformOperator();
  await assertPlatformCapability(session, 'SYSOP_OVERVIEW_READ');

  let observations: EmailDeliveryObservation[] = [];
  let unavailable = false;
  if (isAzureMode()) {
    try {
      observations = await listAcsDeliveryFailures();
    } catch {
      unavailable = true;
    }
  }
  const incidentQueueEnabled = process.env['EMAIL_INCIDENT_VIEW_ENABLED'] === 'true';
  let incidentQueue: Awaited<ReturnType<typeof listRecentEmailIncidents>> = {
    incidents: [],
    openCount: 0,
  };
  let incidentsUnavailable = false;
  if (incidentQueueEnabled) {
    try {
      incidentQueue = await listRecentEmailIncidents();
    } catch {
      incidentsUnavailable = true;
    }
  }
  const canAcknowledge = incidentQueueEnabled
    ? (await listUsablePlatformCapabilities(session)).has('SYSOP_SECURITY_MANAGE')
    : false;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Email delivery diagnostics</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Provider reported delivery failures from the last 30 days. A successful provider
          submission does not establish inbox delivery. Recipient addresses and message content are
          omitted.
        </p>
      </div>

      {unavailable ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          Azure delivery logs are unavailable. Check the ACS resource configuration and the web
          app’s resource-scoped Reader assignment.
        </p>
      ) : !isAzureMode() ? (
        <p className="rounded-lg border p-4 text-sm">
          No delivery evidence source is configured for this installation.
        </p>
      ) : observations.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm">
          No provider reported delivery failures in the last 30 days.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recent provider reported email delivery failures</caption>
            <thead className="bg-slate-100 dark:bg-slate-900">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Observed UTC
                </th>
                <th scope="col" className="px-4 py-3">
                  Recipient domain
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  SMTP
                </th>
                <th scope="col" className="px-4 py-3">
                  Diagnosis
                </th>
                <th scope="col" className="px-4 py-3">
                  Provider ID
                </th>
              </tr>
            </thead>
            <tbody>
              {observations.map((item) => (
                <tr
                  key={`${item.providerMessageId}-${item.observedAt}`}
                  className="border-t border-slate-200 align-top dark:border-slate-800"
                >
                  <td className="whitespace-nowrap px-4 py-3">{formatTime(item.observedAt)}</td>
                  <td className="px-4 py-3">{item.recipientDomain || 'Unknown'}</td>
                  <td className="px-4 py-3">{item.status}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {[item.smtpStatusCode, item.enhancedSmtpStatusCode]
                      .filter(Boolean)
                      .join(' / ') || 'Unavailable'}
                  </td>
                  <td className="min-w-72 px-4 py-3">
                    {item.diagnosis}
                    {item.failureReason && (
                      <span className="mt-1 block text-xs text-slate-500">
                        Reason: {item.failureReason}
                      </span>
                    )}
                  </td>
                  <td className="max-w-52 break-all px-4 py-3 font-mono text-xs">
                    {item.providerMessageId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Azure Monitor retention is 30 days. An SMTP policy code cannot reveal a recipient’s private
        rule.
      </p>
      {incidentQueueEnabled && (
        <section aria-labelledby="email-incidents-heading" className="space-y-4">
          <div>
            <h2 id="email-incidents-heading" className="text-xl font-semibold">
              Delivery incidents
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {incidentsUnavailable
                ? 'Incident count unavailable.'
                : `${incidentQueue.openCount} unacknowledged. The table shows up to 100 incidents, with open incidents first.`}
            </p>
          </div>
          {incidentsUnavailable ? (
            <p role="alert" className="rounded-lg border border-amber-300 p-4 text-sm">
              The incident queue is unavailable.
            </p>
          ) : incidentQueue.incidents.length === 0 ? (
            <p className="rounded-lg border p-4 text-sm">No delivery incidents are recorded.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Recent durable email delivery incidents</caption>
                <thead className="bg-slate-100 dark:bg-slate-900">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Observed UTC
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Recipient domain
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Diagnosis
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Review
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {incidentQueue.incidents.map((incident) => (
                    <tr
                      key={incident.id}
                      className="border-t border-slate-200 align-top dark:border-slate-800"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatTime(incident.eventAt)}
                      </td>
                      <td className="px-4 py-3">{incident.recipientDomain}</td>
                      <td className="px-4 py-3">{incident.status}</td>
                      <td className="min-w-72 px-4 py-3">
                        {diagnoseDelivery(incident)}
                        {incident.failureReason && (
                          <span className="mt-1 block text-xs text-slate-500">
                            Reason: {incident.failureReason}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {incident.acknowledgedAt ? (
                          <span>Acknowledged {formatTime(incident.acknowledgedAt)}</span>
                        ) : canAcknowledge ? (
                          <form
                            method="post"
                            action={`/api/sysop/email-delivery/${incident.id}/ack`}
                          >
                            <button
                              type="submit"
                              className="min-h-8 rounded border border-slate-400 px-3 py-1 font-medium hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-slate-800"
                            >
                              Acknowledge
                              <span className="sr-only">
                                {' '}
                                incident for {incident.recipientDomain} at{' '}
                                {formatTime(incident.eventAt)}
                              </span>
                            </button>
                          </form>
                        ) : (
                          <span>Open</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
