import { Prisma } from '@prisma/client';

import { withOrgContext } from '@/lib/db';

import { AI_PIPELINE_REVISION } from './chunking';

export interface RetrievalRequest {
  organizationId: string;
  roomId: string;
  /** Authoritative caller-supplied source scope; Phase 2 resolves this per actor. */
  allowedVersionIds: string[];
  question: string;
  questionEmbedding: number[];
  embeddingModelId: string;
  limit?: number;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  versionId: string;
  pageNumber: number | null;
  content: string;
  contentSha256: string;
  score: number;
}

export interface RetrievalProvider {
  retrieve(request: RetrievalRequest): Promise<RetrievedChunk[]>;
}

type Row = Omit<RetrievedChunk, 'score'>;

function validate(request: RetrievalRequest): void {
  if (
    !request.organizationId ||
    !request.roomId ||
    !request.question.trim() ||
    request.question.length > 2000 ||
    request.allowedVersionIds.length > 1000 ||
    !request.embeddingModelId ||
    request.embeddingModelId.length > 120 ||
    request.questionEmbedding.length !== 1536 ||
    request.questionEmbedding.some((n) => !Number.isFinite(n))
  ) {
    throw new Error('AI_RETRIEVAL_INPUT_INVALID');
  }
}

/** Retrieval is internal-only; no web route exposes it before Phase 2 gates. */
export class PostgresRetrievalProvider implements RetrievalProvider {
  async retrieve(request: RetrievalRequest): Promise<RetrievedChunk[]> {
    validate(request);
    if (!request.allowedVersionIds.length) {
      return [];
    }
    const { organizationId, roomId, allowedVersionIds, question, embeddingModelId } = request;
    const limit = Math.min(Math.max(request.limit ?? 8, 1), 12);
    const queryVector = `[${request.questionEmbedding.join(',')}]`;
    const scope = Prisma.sql`
      FROM ai_chunks c
      JOIN ai_sources s ON s.id = c."sourceId" AND s."organizationId" = c."organizationId"
      JOIN document_versions v ON v.id = c."versionId" AND v."organizationId" = c."organizationId"
      JOIN file_blobs b ON b."versionId" = v.id AND b."organizationId" = c."organizationId"
      JOIN documents d ON d.id = c."documentId" AND d."organizationId" = c."organizationId"
      JOIN rooms r ON r.id = c."roomId" AND r."organizationId" = c."organizationId"
      JOIN organizations o ON o.id = c."organizationId"
      JOIN ai_policies p ON p."roomId" = r.id AND p."organizationId" = c."organizationId"
      WHERE c."organizationId" = ${organizationId}
        AND c."roomId" = ${roomId}
        AND c."versionId" IN (${Prisma.join(allowedVersionIds)})
        AND s.state = 'READY' AND s."versionId" = c."versionId"
        AND s."embeddingModelId" = ${embeddingModelId}
        AND s."pipelineRevision" = ${AI_PIPELINE_REVISION}
        AND s."documentId" = c."documentId" AND s."roomId" = c."roomId"
        AND s."fileSha256" = v."fileSha256"
        AND v."documentId" = d.id AND v."scanStatus" = 'CLEAN'
        AND (v."mimeType" = 'text/plain' OR v."mimeType" = 'application/pdf' OR v."mimeType" LIKE 'image/%')
        AND d."currentVersionId" = v.id AND d.status = 'ACTIVE'
        AND d."deletedAt" IS NULL AND d."withdrawnAt" IS NULL
        AND (d."expiresAt" IS NULL OR d."expiresAt" > now())
        AND d."roomId" = r.id AND r.status = 'ACTIVE' AND r.mode = 'INDEPENDENT'
        AND o."isActive" = true AND o."aiEnabled" = true
        AND p.enabled = true`;
    const columns = Prisma.sql`c.id, c."documentId", c."versionId", c."pageNumber", c.content, c."contentSha256"`;
    return withOrgContext(organizationId, async (tx) => {
      // All predicates are repeated in both SQL lanes. RLS is an additional
      // boundary, not the only tenant filter.
      const lexical = await tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT ${columns} ${scope}
        AND to_tsvector('english', c.content) @@ plainto_tsquery('english', ${question})
        ORDER BY ts_rank_cd(to_tsvector('english', c.content), plainto_tsquery('english', ${question})) DESC
        LIMIT 40`);
      const semantic = await tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT ${columns} ${scope}
        ORDER BY c.embedding::vector(1536) <=> ${queryVector}::vector(1536)
        LIMIT 40`);
      const ranked = new Map<string, RetrievedChunk>();
      for (const [lane, rows] of [lexical, semantic].entries()) {
        rows.forEach((row, index) => {
          const current = ranked.get(row.id);
          const score = 1 / (60 + index + 1);
          ranked.set(row.id, {
            ...row,
            score: (current?.score ?? 0) + score + (lane === 0 ? 0.000001 : 0),
          });
        });
      }
      return [...ranked.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    });
  }
}
