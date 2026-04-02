import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

interface SearchResult {
  documentId: string;
  versionId: string;
  title: string;
  fileName: string;
  snippet: string;
  score: number;
  mimeType: string;
  tags: string[];
  uploadedAt: Date;
  roomId: string;
  roomName: string;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  took: number;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = request.nextUrl;

    // Parse and validate query params
    const q = searchParams.get('q')?.trim();
    const roomId = searchParams.get('roomId');
    const type = searchParams.get('type');
    const tagsParam = searchParams.get('tags');
    const category = searchParams.get('category');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    if (!q) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Search query (q) is required' } },
        { status: 400 }
      );
    }

    const limit = Math.min(Math.max(parseInt(limitParam || '20', 10) || 20, 1), 50);
    const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
    const tags = tagsParam
      ? tagsParam
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : null;

    const organizationId = session.organizationId;
    const startTime = Date.now();

    const response = await withOrgContext(organizationId, async (tx) => {
      // Build dynamic WHERE conditions
      const conditions: Prisma.Sql[] = [Prisma.sql`si."organizationId" = ${organizationId}`];

      // Exclude soft-deleted documents
      conditions.push(Prisma.sql`d."status" != 'DELETED'`);

      // Full-text OR ILIKE fallback condition
      conditions.push(
        Prisma.sql`(
          to_tsvector('english', coalesce(si."extractedText", '') || ' ' || coalesce(si."documentTitle", '') || ' ' || coalesce(si."fileName", ''))
          @@ plainto_tsquery('english', ${q})
          OR si."documentTitle" ILIKE '%' || ${q} || '%'
          OR si."fileName" ILIKE '%' || ${q} || '%'
        )`
      );

      if (roomId) {
        conditions.push(Prisma.sql`d."roomId" = ${roomId}`);
      }

      if (type) {
        conditions.push(Prisma.sql`si."mimeType" LIKE ${type + '%'}`);
      }

      if (tags && tags.length > 0) {
        conditions.push(Prisma.sql`si."tags" && ${tags}::text[]`);
      }

      if (category) {
        conditions.push(Prisma.sql`d."category" = ${category}::"DocumentCategory"`);
      }

      const whereClause = Prisma.join(conditions, ' AND ');

      // Count query
      const countResult = await tx.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count
        FROM search_indexes si
        JOIN documents d ON d.id = si."documentId"
        JOIN rooms r ON r.id = d."roomId"
        WHERE ${whereClause}
      `;

      const total = Number(countResult[0]?.count ?? 0);

      if (total === 0) {
        return { results: [], total: 0, took: Date.now() - startTime };
      }

      // Main search query with ranking and snippets
      const results = await tx.$queryRaw<SearchResult[]>`
        SELECT
          si."documentId" AS "documentId",
          si."versionId" AS "versionId",
          si."documentTitle" AS "title",
          si."fileName" AS "fileName",
          ts_headline(
            'english',
            coalesce(si."extractedText", ''),
            plainto_tsquery('english', ${q}),
            'MaxWords=35, MinWords=15, MaxFragments=1'
          ) AS "snippet",
          ts_rank(
            to_tsvector('english', coalesce(si."extractedText", '') || ' ' || coalesce(si."documentTitle", '') || ' ' || coalesce(si."fileName", '')),
            plainto_tsquery('english', ${q})
          )::float AS "score",
          si."mimeType" AS "mimeType",
          si."tags" AS "tags",
          si."uploadedAt" AS "uploadedAt",
          d."roomId" AS "roomId",
          r."name" AS "roomName"
        FROM search_indexes si
        JOIN documents d ON d.id = si."documentId"
        JOIN rooms r ON r.id = d."roomId"
        WHERE ${whereClause}
        ORDER BY "score" DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      return { results, total, took: Date.now() - startTime };
    });

    return NextResponse.json({
      success: true,
      results: response.results,
      total: response.total,
      took: response.took,
    } satisfies { success: true } & SearchResponse);
  } catch (error: unknown) {
    if (error instanceof Error && 'statusCode' in error) {
      const appError = error as Error & { statusCode: number; code: string };
      return NextResponse.json(
        { success: false, error: { code: appError.code, message: appError.message } },
        { status: appError.statusCode }
      );
    }

    console.error('[Search API] Unexpected error:', error);
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      },
      { status: 500 }
    );
  }
}
