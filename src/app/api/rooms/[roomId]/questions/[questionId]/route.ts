/**
 * Single Question API (Q&A)
 *
 * GET   /api/rooms/:roomId/questions/:questionId - Get question with answers
 * PATCH /api/rooms/:roomId/questions/:questionId - Update question
 */

import { NextRequest, NextResponse } from 'next/server';
import { QuestionStatus, QuestionPriority } from '@prisma/client';
import { z } from 'zod';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; questionId: string }>;
}

const updateQuestionSchema = z.object({
  status: z.nativeEnum(QuestionStatus).optional(),
  priority: z.nativeEnum(QuestionPriority).optional(),
  isPublic: z.boolean().optional(),
});

/**
 * GET /api/rooms/:roomId/questions/:questionId
 * Get a single question with all answers
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, questionId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

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

      // Get question with answers
      const question = await tx.question.findFirst({
        where: {
          id: questionId,
          roomId,
          organizationId: session.organizationId,
        },
        include: {
          askedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          answers: {
            include: {
              answeredBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!question) {
        return { error: 'Question not found', status: 404 };
      }

      return { question };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ question: result.question });
  } catch (error) {
    console.error('[QuestionAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get question' }, { status: 500 });
  }
}

/**
 * PATCH /api/rooms/:roomId/questions/:questionId
 * Update a question (status, priority, visibility)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, questionId } = await context.params;

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = updateQuestionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updates = parsed.data;

    // Ensure at least one field is being updated
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

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
      const existing = await tx.question.findFirst({
        where: {
          id: questionId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Question not found', status: 404 };
      }

      // Update the question
      const question = await tx.question.update({
        where: { id: questionId },
        data: updates,
      });

      // Create appropriate event
      const eventType = updates.status === 'CLOSED' ? 'QUESTION_CLOSED' : 'QUESTION_UPDATED';
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType,
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          roomId,
          description:
            updates.status === 'CLOSED'
              ? `Question closed: ${existing.subject}`
              : `Question updated: ${existing.subject}`,
          metadata: {
            questionId,
            updates,
          },
        },
      });

      return { question };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ question: result.question });
  } catch (error) {
    console.error('[QuestionAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update question' }, { status: 500 });
  }
}
