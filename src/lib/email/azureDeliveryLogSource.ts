import { DefaultAzureCredential } from '@azure/identity';
import { normalizeAcsDeliveryRow, type EmailDeliveryObservation } from './deliveryDiagnostics';

interface LogsQueryResponse {
  tables?: Array<{ name: string; columns: Array<{ name: string }>; rows: unknown[][] }>;
  error?: { code?: string };
}

/** Reads only ACS status metadata. Recipient local parts and message content stay in Azure Monitor. */
export async function listAcsDeliveryFailures(): Promise<EmailDeliveryObservation[]> {
  const resourceId = process.env['ACS_COMMUNICATION_RESOURCE_ID'];
  if (
    !resourceId ||
    !/^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Communication\/CommunicationServices\/[^/]+$/i.test(
      resourceId
    )
  ) {
    throw new Error('EMAIL_DELIVERY_LOG_CONFIGURATION_MISSING');
  }

  const token = await new DefaultAzureCredential().getToken('https://api.loganalytics.io/.default');
  const escapedResourceId = resourceId.toLowerCase().replaceAll("'", "''");
  const query = `ACSEmailStatusUpdateOperational
| where TimeGenerated > ago(30d)
| where tolower(_ResourceId) == '${escapedResourceId}'
| where DeliveryStatus in ('Failed', 'Bounced', 'Suppressed', 'Quarantined', 'FilteredSpam')
| extend RecipientDomain = tolower(tostring(split(RecipientId, '@')[1]))
| project TimeGenerated, CorrelationId, RecipientDomain, DeliveryStatus, FailureReason, SmtpStatusCode, EnhancedSmtpStatusCode, RecipientMailServerHostName
| top 100 by TimeGenerated desc`;
  const response = await fetch(`https://api.loganalytics.azure.com/v1${resourceId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, timespan: 'P30D' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`EMAIL_DELIVERY_LOG_QUERY_FAILED_${response.status}`);
  }
  const result = (await response.json()) as LogsQueryResponse;
  if (result.error || !result.tables?.[0]) {
    throw new Error('EMAIL_DELIVERY_LOG_QUERY_INCOMPLETE');
  }
  const table = result.tables[0];
  return table.rows.flatMap((values) => {
    const row = Object.fromEntries(
      table.columns.map((column, index) => [column.name, values[index]])
    );
    const observation = normalizeAcsDeliveryRow(row);
    return observation ? [observation] : [];
  });
}
