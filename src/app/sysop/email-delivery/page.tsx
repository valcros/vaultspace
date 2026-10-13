import { requirePlatformOperator } from '@/lib/middleware';
import { assertPlatformCapability } from '@/lib/sysop/capabilityGuard';
import { listAcsDeliveryFailures } from '@/lib/email/azureDeliveryLogSource';
import type { EmailDeliveryObservation } from '@/lib/email/deliveryDiagnostics';
import { isAzureMode } from '@/lib/deployment-mode';

export const dynamic = 'force-dynamic';

function formatTime(value: string): string {
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
    </main>
  );
}
