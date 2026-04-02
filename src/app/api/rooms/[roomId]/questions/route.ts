/**
 * Questions API (Q&A)
 *
 * GET  /api/rooms/:roomId/questions - List questions for a room
 * POST /api/rooms/:roomId/questions - Create a question (admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { QuestionPriority } from '@prisma/client';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

const listQuerySchema = z.object({
  status: z.enum(['OPEN', 'ANSWERED', 'CLOSED']).optional(),
  documentId: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const createQuestionSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  documentId: z.string().nullable().optional(),
  priority: z.nativeEnum(QuestionPriority).optional(),
  isPublic: z.boolean().optional(),
});

/**
 * GET /api/rooms/:roomId/questions
 * List questions for a room (admin only)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse query params
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      status: url.searchParams.get('status') ?? undefined,
      documentId: url.searchParams.get('documentId') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { status, documentId, search, limit, offset } = parsed.data;

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Build where clause
      const where = {
        roomId,
        organizationId: session.organizationId,
        ...(status && { status }),
        ...(documentId && { documentId }),
        ...(search && {
          subject: { contains: search, mode: 'insensitive' as const },
        }),
      };

      // Get total count and questions
      const [total, questions] = await Promise.all([
        tx.question.count({ where }),
        tx.question.findMany({
          where,
          include: {
            askedByUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            _count: {
              select: {
                answers: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
      ]);

      return { questions, total };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      questions: result.questions,
      total: result.total,
    });
  } catch (error) {
    console.error('[QuestionsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list questions' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/:roomId/questions
 * Create a new question (admin)
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createQuestionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { subject, body: questionBody, documentId, priority, isPublic } = parsed.data;

    // Use RLS context for all org-scoped queries
    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Verify document if provided
      if (documentId) {
        const document = await tx.document.findFirst({
          where: {
            id: documentId,
            roomId,
            organizationId: session.organizationId,
          },
        });

        if (!document) {
          return { error: 'Document not found', status: 404 };
        }
      }

      // Create the question
      const question = await tx.question.create({
        data: {
          organizationId: session.organizationId,
          roomId,
          askedByUserId: session.userId,
          askedByEmail: session.user.email,
          subject: subject.trim(),
          body: questionBody.trim(),
          documentId: documentId ?? null,
          priority: priority ?? 'NORMAL',
          isPublic: isPublic ?? false,
        },
      });

      // Create audit event
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'QUESTION_SUBMITTED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId,
          description: `Question submitted: ${subject.trim()}`,
          metadata: {
            questionId: question.id,
            documentId: documentId ?? null,
          },
        },
      });

      return { question };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ question: result.question }, { status: 201 });
  } catch (error) {
    console.error('[QuestionsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create question' }, { status: 500 });
  }
}
