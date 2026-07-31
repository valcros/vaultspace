import { Prisma } from '@prisma/client';

type ConflictTransaction = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Atomically records one observation of a payload that reused an existing
 * provider event ID. PostgreSQL row locking serializes concurrent observations;
 * the database trigger makes the first evidence immutable and the count
 * monotonic.
 */
export async function recordProviderEventConflict(
  tx: ConflictTransaction,
  inboxId: string,
  conflictingPayloadFingerprint: string
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ conflictCount: number }>>(Prisma.sql`
    WITH observed AS (
      SELECT clock_timestamp()::timestamp(3) AS "at"
    )
    UPDATE "provider_event_inbox"
    SET "processingStatus" = 'CONFLICT',
        "conflictCount" = "conflictCount" + 1,
        "firstConflictAt" = COALESCE("firstConflictAt", observed."at"),
        "conflictingPayloadFingerprint" = COALESCE(
          "conflictingPayloadFingerprint",
          ${conflictingPayloadFingerprint}
        ),
        "lastConflictAt" = GREATEST(
          COALESCE("lastConflictAt", '-infinity'::timestamp),
          observed."at"
        ),
        "lastConflictingPayloadFingerprint" = ${conflictingPayloadFingerprint},
        "lastErrorCode" = 'EVENT_ID_PAYLOAD_CONFLICT',
        "processingLeaseId" = NULL,
        "processingLeaseExpiresAt" = NULL,
        "updatedAt" = GREATEST("updatedAt", observed."at")
    FROM observed
    WHERE "id" = ${inboxId}
    RETURNING "conflictCount"
  `);
  const count = rows[0]?.conflictCount;
  if (typeof count !== 'number') {
    throw new Error('Provider event conflict target was not found');
  }
  return count;
}
