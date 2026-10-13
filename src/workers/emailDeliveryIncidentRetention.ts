import { PrismaClient } from '@prisma/client';

const MAX_BATCHES = 20;
const BATCH_SIZE = 500;

/** A separate EXECUTE-only login runs the fixed database retention policy. */
export async function runEmailIncidentRetention(): Promise<number> {
  if (process.env['EMAIL_INCIDENT_RETENTION_ENABLED'] !== 'true') {
    return 0;
  }
  const url = process.env['EMAIL_INCIDENT_RETENTION_DATABASE_URL'];
  if (!url || !/^postgres(?:ql)?:\/\//.test(url)) {
    throw new Error('EMAIL_INCIDENT_RETENTION_DATABASE_CONFIGURATION_INVALID');
  }
  const client = new PrismaClient({ log: [], datasources: { db: { url } } });
  try {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const [result] = await client.$queryRaw<Array<{ purged: number }>>`
        SELECT public.purge_email_delivery_incidents_v1() AS purged
      `;
      if (
        !result ||
        !Number.isInteger(result.purged) ||
        result.purged < 0 ||
        result.purged > BATCH_SIZE
      ) {
        throw new Error('EMAIL_INCIDENT_RETENTION_RESULT_INVALID');
      }
      total += result.purged;
      if (result.purged < BATCH_SIZE) {
        return total;
      }
    }
    throw new Error('EMAIL_INCIDENT_RETENTION_BACKLOG_EXCEEDED');
  } finally {
    await client.$disconnect();
  }
}

async function main(): Promise<void> {
  try {
    const purged = await runEmailIncidentRetention();
    console.log(
      JSON.stringify({
        component: 'email-delivery-incident-retention',
        event: 'run',
        outcome: 'completed',
        purged,
      })
    );
  } catch {
    console.error(
      JSON.stringify({
        component: 'email-delivery-incident-retention',
        event: 'run',
        outcome: 'failed',
        errorCode: 'EMAIL_INCIDENT_RETENTION_FAILED',
      })
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
