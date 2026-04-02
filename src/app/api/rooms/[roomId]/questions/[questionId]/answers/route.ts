/**
 * Answers API (Q&A)
 *
 * POST /api/rooms/:roomId/questions/:questionId/answers - Create an answer
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; questionId: string }>;
}

const createAnswerSchema = z.object({
  body: z.string().min(1),
});

/**
 * POST /api/rooms/:roomId/questions/:questionId/answers
 * Create an answer to a question
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, questionId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createAnswerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { body: answerBody } = parsed.data;

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

      // Verify question exists
      const question = await tx.question.findFirst({
        where: {
          id: questionId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!question) {
        return { error: 'Question not found', status: 404 };
      }

      // Create the answer
      const answer = await tx.answer.create({
        data: {
          organizationId: session.organizationId,
          questionId,
          answeredByUserId: session.userId,
          body: answerBody.trim(),
        },
      });

      // Auto-set question status to ANSWERED if currently OPEN
      if (question.status === 'OPEN') {
        await tx.question.update({
          where: { id: questionId },
          data: { status: 'ANSWERED' },
        });
      }

      // Create audit event
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'ANSWER_SUBMITTED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId,
          description: `Answer submitted for question: ${question.subject}`,
          metadata: {
            questionId,
            answerId: answer.id,
          },
        },
      });

      return { answer };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ answer: result.answer }, { status: 201 });
  } catch (error) {
    console.error('[AnswersAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create answer' }, { status: 500 });
  }
}
