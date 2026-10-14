import { listAcsIncidentEvidence } from '@/lib/email/acsIncidentSource';
import { loadRecipientFingerprintKey } from '@/lib/email/incidentEvidence';
import {
  createIncidentCollectorClient,
  insertIncidentEvidence,
} from '@/lib/email/incidentRepository';

export async function collectEmailDeliveryIncidents(): Promise<{
  observed: number;
  inserted: number;
  duplicate: number;
  invalidRows: number;
}> {
  if (process.env['EMAIL_INCIDENT_COLLECTOR_ENABLED'] !== 'true') {
    return { observed: 0, inserted: 0, duplicate: 0, invalidRows: 0 };
  }
  if (process.env['DEPLOYMENT_MODE'] !== 'azure') {
    throw new Error('EMAIL_INCIDENT_SOURCE_NOT_CONFIGURED');
  }
  const configuredLookback = process.env['EMAIL_INCIDENT_LOOKBACK_HOURS'];
  const lookbackHours = configuredLookback ? Number(configuredLookback) : 72;
  const fingerprintKey = loadRecipientFingerprintKey();
  const { evidence, invalidRows } = await listAcsIncidentEvidence(fingerprintKey, lookbackHours);
  const client = createIncidentCollectorClient();
  try {
    const result = await insertIncidentEvidence(client, evidence);
    return { observed: evidence.length + invalidRows, invalidRows, ...result };
  } finally {
    await client.$disconnect();
  }
}

async function main(): Promise<void> {
  try {
    const result = await collectEmailDeliveryIncidents();
    if (result.invalidRows > 0) {
      console.error(
        JSON.stringify({
          component: 'email-delivery-incident-collector',
          event: 'run',
          outcome: 'degraded',
          errorCode: 'EMAIL_INCIDENT_SOURCE_INVALID_ROWS',
          ...result,
        })
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      JSON.stringify({
        component: 'email-delivery-incident-collector',
        event: 'run',
        outcome: 'completed',
        ...result,
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        component: 'email-delivery-incident-collector',
        event: 'run',
        outcome: 'failed',
        errorCode:
          error instanceof Error && /^EMAIL_INCIDENT_[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : 'EMAIL_INCIDENT_COLLECTOR_FAILED',
      })
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
