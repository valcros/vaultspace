/**
 * PostgresSearchProvider
 *
 * Full-text search over the search_indexes table using PostgreSQL FTS.
 * FTS expression and column names match /api/search/route.ts exactly so the
 * GIN index (migration 20260529000000) is used by both query paths.
 *
 * NOTE: /api/search does NOT call providers.search.search() — it has its own
 * direct SQL that returns roomName and other join-derived fields the provider
 * interface cannot express. This provider's search() fulfils the interface
 * contract and is available for future use, but does not affect the current
 * API search behavior. search() is FTS-only; before any route is migrated to
 * it, add the ILIKE title/fileName fallback that /api/search currently includes.
 *
 * Index ownership:
 *   The worker's processSearchIndexJob upserts SearchIndex directly (with
 *   authoritative tags, customMetadata, mimeType, uploadedAt from joined
 *   document/version records), then calls providers.search.index() as a
 *   secondary path. This provider's update path therefore only touches the
 *   fields it has authoritative values for: extractedText, documentTitle,
 *   fileName, and roomId. It does NOT overwrite tags, customMetadata,
 *   mimeType, or uploadedAt — those remain owned by the worker upsert.
 */

import { db } from '@/lib/db';
import type { SearchProvider, SearchQuery, SearchResponse } from '../types';

export class PostgresSearchProvider implements SearchProvider {
  async index(
    organizationId: string,
    documentId: string,
    versionId: string,
    content: { title: string; text: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    const roomId = (content.metadata?.['roomId'] as string | undefined) ?? null;

    await db.searchIndex.upsert({
      where: {
        organizationId_versionId: { organizationId, versionId },
      },
      create: {
        organizationId,
        documentId,
        versionId,
        roomId,
        documentTitle: content.title,
        extractedText: content.text,
        fileName: content.title,
        mimeType: 'application/octet-stream',
        uploadedAt: new Date(),
      },
      update: {
        // Only update fields this provider has authoritative values for.
        // tags, customMetadata, mimeType, and uploadedAt are owned by the
        // worker's direct upsert (which has joined document/version data).
        roomId,
        documentTitle: content.title,
        extractedText: content.text,
        fileName: content.title,
      },
    });
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    const { query: q, organizationId, roomId, limit = 20, offset = 0 } = query;
    const clampedLimit = Math.min(Math.max(limit, 1), 50);
    const start = Date.now();

    type RawRow = {
      documentId: string;
      versionId: string;
      title: string;
      snippet: string;
      score: number;
      highlights: string[];
    };

    type CountRow = { count: bigint };

    const roomFilter = roomId
      ? db.$queryRaw<CountRow[]>`
          SELECT COUNT(*) AS count
          FROM "search_indexes"
          WHERE "organizationId" = ${organizationId}
            AND "roomId" = ${roomId}
            AND to_tsvector('english',
                  coalesce("extractedText", '') || ' ' ||
                  coalesce("documentTitle", '') || ' ' ||
                  coalesce("fileName", '')
                ) @@ plainto_tsquery('english', ${q})`
      : db.$queryRaw<CountRow[]>`
          SELECT COUNT(*) AS count
          FROM "search_indexes"
          WHERE "organizationId" = ${organizationId}
            AND to_tsvector('english',
                  coalesce("extractedText", '') || ' ' ||
                  coalesce("documentTitle", '') || ' ' ||
                  coalesce("fileName", '')
                ) @@ plainto_tsquery('english', ${q})`;

    const [countResult] = await Promise.all([roomFilter]);
    const total = Number(countResult[0]?.count ?? 0);

    if (total === 0) {
      return { results: [], total: 0, took: Date.now() - start };
    }

    const rows = roomId
      ? await db.$queryRaw<RawRow[]>`
          SELECT
            "documentId",
            "versionId",
            "documentTitle" AS title,
            ts_headline('english',
              coalesce("extractedText", ''),
              plainto_tsquery('english', ${q}),
              'MaxWords=35, MinWords=15, MaxFragments=1'
            ) AS snippet,
            ts_rank(
              to_tsvector('english',
                coalesce("extractedText", '') || ' ' ||
                coalesce("documentTitle", '') || ' ' ||
                coalesce("fileName", '')
              ),
              plainto_tsquery('english', ${q})
            )::float AS score,
            ARRAY[]::text[] AS highlights
          FROM "search_indexes"
          WHERE "organizationId" = ${organizationId}
            AND "roomId" = ${roomId}
            AND to_tsvector('english',
                  coalesce("extractedText", '') || ' ' ||
                  coalesce("documentTitle", '') || ' ' ||
                  coalesce("fileName", '')
                ) @@ plainto_tsquery('english', ${q})
          ORDER BY score DESC
          LIMIT ${clampedLimit}
          OFFSET ${offset}`
      : await db.$queryRaw<RawRow[]>`
          SELECT
            "documentId",
            "versionId",
            "documentTitle" AS title,
            ts_headline('english',
              coalesce("extractedText", ''),
              plainto_tsquery('english', ${q}),
              'MaxWords=35, MinWords=15, MaxFragments=1'
            ) AS snippet,
            ts_rank(
              to_tsvector('english',
                coalesce("extractedText", '') || ' ' ||
                coalesce("documentTitle", '') || ' ' ||
                coalesce("fileName", '')
              ),
              plainto_tsquery('english', ${q})
            )::float AS score,
            ARRAY[]::text[] AS highlights
          FROM "search_indexes"
          WHERE "organizationId" = ${organizationId}
            AND to_tsvector('english',
                  coalesce("extractedText", '') || ' ' ||
                  coalesce("documentTitle", '') || ' ' ||
                  coalesce("fileName", '')
                ) @@ plainto_tsquery('english', ${q})
          ORDER BY score DESC
          LIMIT ${clampedLimit}
          OFFSET ${offset}`;

    return {
      results: rows.map((r) => ({
        documentId: r.documentId,
        versionId: r.versionId,
        title: r.title,
        snippet: r.snippet,
        score: r.score,
        highlights: r.highlights,
      })),
      total,
      took: Date.now() - start,
    };
  }

  async remove(organizationId: string, documentId: string): Promise<void> {
    await db.searchIndex.deleteMany({
      where: { organizationId, documentId },
    });
  }
}
