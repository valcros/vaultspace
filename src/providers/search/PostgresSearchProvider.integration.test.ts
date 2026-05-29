/**
 * PostgresSearchProvider integration tests
 *
 * Requires a real PostgreSQL database with the search_indexes table and the
 * FTS GIN index (migration 20260529000000_add_search_index_room_id).
 *
 * Opt-in: set RUN_POSTGRES_SEARCH_INTEGRATION=true
 * Example:
 *   RUN_POSTGRES_SEARCH_INTEGRATION=true DATABASE_URL=<url> npx vitest run \
 *     src/providers/search/PostgresSearchProvider.integration.test.ts
 *
 * Do NOT remove the skip guard — unit test runs (CI without a live DB) must
 * not attempt to connect.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const RUN = process.env['RUN_POSTGRES_SEARCH_INTEGRATION'] === 'true';

describe.skipIf(!RUN)('PostgresSearchProvider — integration (live Postgres)', () => {
  let provider: import('./PostgresSearchProvider').PostgresSearchProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  const ORG = `test-org-${Date.now()}`;
  const ROOM = `test-room-${Date.now()}`;
  const DOC_A = `doc-a-${Date.now()}`;
  const DOC_B = `doc-b-${Date.now()}`;
  const VER_A = `ver-a-${Date.now()}`;
  const VER_B = `ver-b-${Date.now()}`;

  beforeAll(async () => {
    const { PostgresSearchProvider: P } = await import('./PostgresSearchProvider');
    const { db: dbImport } = await import('@/lib/db');
    db = dbImport;
    provider = new P();

    // Insert minimal rows directly so tests are self-contained
    // (no need for organization/document FK rows when RLS is off in test DB)
    await db.$executeRawUnsafe(`
      INSERT INTO "search_indexes"
        (id, "createdAt", "updatedAt", "organizationId", "documentId", "versionId",
         "documentTitle", "extractedText", "fileName", "mimeType", "uploadedAt", "roomId")
      VALUES
        ('${DOC_A}', now(), now(), '${ORG}', '${DOC_A}', '${VER_A}',
         'Annual Report 2024', 'Revenue grew significantly in Q4', 'annual_report.pdf',
         'application/pdf', now(), '${ROOM}'),
        ('${DOC_B}', now(), now(), '${ORG}', '${DOC_B}', '${VER_B}',
         'Board Minutes', 'Approved the budget proposal unanimously', 'minutes.pdf',
         'application/pdf', now(), 'other-room')
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.searchIndex.deleteMany({
      where: { organizationId: ORG },
    });
    await db.$disconnect();
  });

  it('finds a document by full-text search', async () => {
    const result = await provider.search({ query: 'Revenue', organizationId: ORG });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r) => r.documentId === DOC_A)).toBe(true);
  });

  it('room filter includes matching doc and excludes non-matching doc', async () => {
    const result = await provider.search({
      query: 'approved',
      organizationId: ORG,
      roomId: ROOM,
    });
    expect(result.results.every((r) => r.documentId !== DOC_B)).toBe(true);
  });

  it('search without room filter finds docs across rooms', async () => {
    const result = await provider.search({ query: 'approved', organizationId: ORG });
    expect(result.results.some((r) => r.documentId === DOC_B)).toBe(true);
  });

  it('index upserts a new row', async () => {
    const DOC_C = `doc-c-${Date.now()}`;
    const VER_C = `ver-c-${Date.now()}`;
    await provider.index(ORG, DOC_C, VER_C, {
      title: 'Term Sheet',
      text: 'Valuation cap agreed upon',
      metadata: { roomId: ROOM },
    });
    const row = await db.searchIndex.findFirst({
      where: { organizationId: ORG, documentId: DOC_C },
    });
    expect(row).not.toBeNull();
    expect(row?.extractedText).toBe('Valuation cap agreed upon');
    expect(row?.roomId).toBe(ROOM);
    // Cleanup
    await db.searchIndex.deleteMany({ where: { organizationId: ORG, documentId: DOC_C } });
  });

  it('index update path does not overwrite tags or mimeType', async () => {
    // Simulate worker having already written richer metadata
    await db.$executeRawUnsafe(`
      UPDATE "search_indexes"
      SET tags = ARRAY['finance'], "mimeType" = 'application/pdf'
      WHERE "organizationId" = '${ORG}' AND "documentId" = '${DOC_A}'
    `);
    // Provider index call should not clear those fields
    await provider.index(ORG, DOC_A, VER_A, { title: 'Annual Report 2024', text: 'New text' });
    const row = await db.searchIndex.findFirst({
      where: { organizationId: ORG, documentId: DOC_A },
    });
    expect(row?.tags).toContain('finance');
    expect(row?.mimeType).toBe('application/pdf');
  });

  it('remove deletes all rows for the document', async () => {
    await provider.remove(ORG, DOC_A);
    const row = await db.searchIndex.findFirst({
      where: { organizationId: ORG, documentId: DOC_A },
    });
    expect(row).toBeNull();
  });

  it('search returns empty results for unknown query', async () => {
    const result = await provider.search({
      query: 'zxqvbnmxkqpwlzqpwxqzqpwx',
      organizationId: ORG,
    });
    expect(result.results).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});
