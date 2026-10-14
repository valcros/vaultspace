import { DefaultAzureCredential } from '@azure/identity';

import {
  normalizeAcsIncidentEvidence,
  type IncidentEvidence,
  type RecipientFingerprintKey,
} from './incidentEvidence';

interface LogsQueryResponse {
  tables?: Array<{ columns: Array<{ name: string }>; rows: unknown[][] }>;
  error?: { code?: string };
}

const MAX_ROWS = 1001;

export interface AcsIncidentBatch {
  evidence: IncidentEvidence[];
  invalidRows: number;
}

/** Query raw recipient IDs only inside this collector, so they can be keyed before persistence. */
export async function listAcsIncidentEvidence(
  fingerprintKey: RecipientFingerprintKey,
  lookbackHours = 72
): Promise<AcsIncidentBatch> {
  const resourceId = process.env['ACS_COMMUNICATION_RESOURCE_ID'];
  if (
    !resourceId ||
    !/^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Communication\/CommunicationServices\/[^/]+$/i.test(
      resourceId
    ) ||
    !Number.isInteger(lookbackHours) ||
    lookbackHours < 1 ||
    lookbackHours > 720
  ) {
    throw new Error('EMAIL_INCIDENT_SOURCE_CONFIGURATION_INVALID');
  }
  const token = await new DefaultAzureCredential().getToken('https://api.loganalytics.io/.default');
  const escapedResourceId = resourceId.toLowerCase().replaceAll("'", "''");
  const query = `ACSEmailStatusUpdateOperational
| where TimeGenerated > ago(${lookbackHours}h)
| where tolower(_ResourceId) == '${escapedResourceId}'
| where DeliveryStatus in ('Failed', 'Bounced', 'Suppressed', 'Quarantined', 'FilteredSpam')
| extend RecipientDomain = tolower(tostring(split(RecipientId, '@')[1]))
| project TimeGenerated, CorrelationId, RecipientId, RecipientDomain, DeliveryStatus, FailureReason, SmtpStatusCode, EnhancedSmtpStatusCode, RecipientMailServerHostName
| top ${MAX_ROWS} by TimeGenerated desc`;
  const response = await fetch(`https://api.loganalytics.azure.com/v1${resourceId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, timespan: `PT${lookbackHours}H` }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`EMAIL_INCIDENT_SOURCE_QUERY_FAILED_${response.status}`);
  }
  const result = (await response.json()) as LogsQueryResponse;
  const table = result.tables?.[0];
  if (result.error || !table) {
    throw new Error('EMAIL_INCIDENT_SOURCE_QUERY_INCOMPLETE');
  }
  if (table.rows.length >= MAX_ROWS) {
    throw new Error('EMAIL_INCIDENT_SOURCE_WINDOW_OVERFLOW');
  }
  const evidence: IncidentEvidence[] = [];
  let invalidRows = 0;
  for (const values of table.rows) {
    const row = Object.fromEntries(
      table.columns.map((column, index) => [column.name, values[index]])
    );
    try {
      evidence.push(normalizeAcsIncidentEvidence(row, fingerprintKey));
    } catch (error) {
      if (
        error instanceof Error &&
        /^EMAIL_INCIDENT_(PROVIDER_ROW_INVALID|RECIPIENT_OR_KEY_INVALID|RECIPIENT_DOMAIN_MISMATCH)$/.test(
          error.message
        )
      ) {
        invalidRows++;
        continue;
      }
      throw error;
    }
  }
  return { evidence, invalidRows };
}
