/**
 * Staging-only pgvector activation. Baseline schema works without pgvector,
 * but semantic retrieval requires this extension and the HNSW index.
 * Uses the migration role. No customer document bytes are read here.
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  if (process.env['AI_VECTOR_INDEX_CONFIRM'] !== 'staging') {
    throw new Error('Set AI_VECTOR_INDEX_CONFIRM=staging after reviewing the target database');
  }
  const url = process.env['MIGRATION_DATABASE_URL'];
  if (!url) throw new Error('MIGRATION_DATABASE_URL_REQUIRED');
  const expectedHost = process.env['AI_QA_STAGING_DB_HOST'];
  const target = new URL(url);
  if (
    !expectedHost ||
    !expectedHost.endsWith('.postgres.database.azure.com') ||
    !expectedHost.includes('staging') ||
    target.hostname !== expectedHost ||
    target.pathname !== '/vaultspace'
  ) {
    throw new Error('AI_VECTOR_STAGING_TARGET_INVALID');
  }
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const available = await client.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS available`;
    if (!available[0]?.available) throw new Error('AI_VECTOR_EXTENSION_UNAVAILABLE');
    await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
    // A concurrent build avoids blocking normal document writes in staging.
    await client.$executeRawUnsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_chunks_embedding_hnsw_idx
      ON ai_chunks USING hnsw ((embedding::vector(1536)) vector_cosine_ops)`);
    const index = await client.$queryRaw<
      Array<{
        valid: boolean;
        ready: boolean;
        access_method: string;
        expression: string | null;
        operator_class: string;
      }>
    >`
      SELECT i.indisvalid AS valid, i.indisready AS ready, am.amname AS access_method,
             pg_get_expr(i.indexprs, i.indrelid) AS expression,
             opc.opcname AS operator_class
      FROM pg_index i
      JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_class tbl ON tbl.oid = i.indrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      JOIN pg_am am ON am.oid = idx.relam
      JOIN pg_opclass opc ON opc.oid = i.indclass[0]
      WHERE ns.nspname = 'public' AND tbl.relname = 'ai_chunks'
        AND idx.relname = 'ai_chunks_embedding_hnsw_idx'`;
    if (!index.length) throw new Error('AI_VECTOR_INDEX_MISSING');
    if (
      !index[0]?.valid ||
      !index[0].ready ||
      index[0].access_method !== 'hnsw' ||
      index[0].operator_class !== 'vector_cosine_ops' ||
      index[0].expression?.replace(/[\s()"]/g, '') !== 'embedding::vector1536'
    ) {
      throw new Error('AI_VECTOR_INDEX_INVALID');
    }
    process.stdout.write('AI vector extension and valid HNSW index present\n');
  } finally {
    await client.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'AI_VECTOR_INDEX_FAILED'}\n`);
  process.exitCode = 1;
});
