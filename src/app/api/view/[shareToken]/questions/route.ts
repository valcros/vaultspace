/**
 * Viewer Q&A API
 *
 * GET  /api/view/[shareToken]/questions - List questions visible to the viewer
 * POST /api/view/[shareToken]/questions - Submit a new question
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { db, withOrgContext } from '@/lib/db';

interface RouteContext {
  params: Promise<{ shareToken: string }>;
}

/**
 * PRE-RLS BOOTSTRAP: Resolve viewer session from token
 *
 * Narrowly scoped raw db lookup to bootstrap viewer context.
 * The sessionToken is a secret that proves the viewer has already
 * been authenticated via /api/view/[shareToken]/access.
 * Once we have the session, we use its organizationId to enter RLS context.
 */
async function getViewerSession(shareToken: string) {
  const cookieStore = await cookies();
  const viewerToken = cookieStore.get(`viewer_${shareToken}`)?.value;

  if (!viewerToken) {
    return null;
  }

  const session = await db.viewSession.findFirst({
    where: {
      sessionToken: viewerToken,
    },
    select: {
      id: true,
      organizationId: true,
      roomId: true,
      visitorEmail: true,
      visitorName: true,
      link: {
        select: {
          slug: true,
        },
      },
    },
  });

  return session;
}

// ---------------------------------------------------------------------------
// GET - List questions visible to the viewer
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;
    const session = await getViewerSession(shareToken);

    if (!session) {
      return NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 });
    }

    // Verify the session's link matches the shareToken
    if (session.link?.slug !== shareToken) {
      return NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 });
    }

    const questions = await withOrgContext(session.organizationId, async (tx) => {
      // 1. Viewer's own questions (all statuses)
      const ownQuestions = await tx.question.findMany({
        where: {
          roomId: session.roomId,
          askedByEmail: session.visitorEmail ?? undefined,
        },
        include: {
          answers: {
            select: {
              id: true,
              body: true,
              createdAt: true,
              answeredBy: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
          _count: {
            select: { answers: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // 2. Public answered questions from anyone (excluding own to avoid duplicates)
      const publicAnswered = await tx.question.findMany({
        where: {
          roomId: session.roomId,
          isPublic: true,
          status: 'ANSWERED',
          // Exclude the viewer's own questions (already included above)
          NOT: {
            askedByEmail: session.visitorEmail ?? undefined,
          },
        },
        include: {
          answers: {
            select: {
              id: true,
              body: true,
              createdAt: true,
              answeredBy: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
          _count: {
            select: { answers: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { ownQuestions, publicAnswered };
    });

    const formatQuestion = (q: (typeof questions.ownQuestions)[number]) => ({
      id: q.id,
      subject: q.subject,
      body: q.body,
      status: q.status,
      priority: q.priority,
      isPublic: q.isPublic,
      documentId: q.documentId,
      askedByEmail: q.askedByEmail,
      askedByName: q.askedByName,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
      answerCount: q._count.answers,
      answers: q.answers.map((a) => ({
        id: a.id,
        body: a.body,
        createdAt: a.createdAt.toISOString(),
        answeredByName: `${a.answeredBy.firstName} ${a.answeredBy.lastName}`,
      })),
    });

    return NextResponse.json({
      own: questions.ownQuestions.map(formatQuestion),
      public: questions.publicAnswered.map(formatQuestion),
    });
  } catch (error) {
    console.error('[ViewerQuestionsAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to load questions' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST - Submit a new question
// ---------------------------------------------------------------------------

const createQuestionSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  documentId: z.string().optional(),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { shareToken } = await context.params;
    const session = await getViewerSession(shareToken);

    if (!session) {
      return NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 });
    }

    // Verify the session's link matches the shareToken
    if (session.link?.slug !== shareToken) {
      return NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 });
    }

    const rawBody = await request.json();
    const parsed = createQuestionSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { subject, body, documentId } = parsed.data;

    const question = await withOrgContext(session.organizationId, async (tx) => {
      // If documentId provided, verify it belongs to this room
      if (documentId) {
        const doc = await tx.document.findFirst({
          where: {
            id: documentId,
            roomId: session.roomId,
          },
          select: { id: true },
        });
        if (!doc) {
          return null; // Signal invalid document
        }
      }

      // Create the question
      const created = await tx.question.create({
        data: {
          organizationId: session.organizationId,
          roomId: session.roomId,
          documentId: documentId ?? null,
          askedByUserId: null,
          askedByEmail: session.visitorEmail ?? '',
          askedByName: session.visitorName ?? null,
          viewSessionId: session.id,
          subject,
          body,
          status: 'OPEN',
          priority: 'NORMAL',
          isPublic: false,
        },
      });

      // Create audit event
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'QUESTION_SUBMITTED',
          actorType: 'VIEWER',
          actorEmail: session.visitorEmail,
          roomId: session.roomId,
          documentId: documentId ?? null,
          sessionId: session.id,
          description: `Question submitted: ${subject}`,
          metadata: {
            questionId: created.id,
            subject,
          },
        },
      });

      return created;
    });

    if (question === null) {
      return NextResponse.json({ error: 'Document not found in this room' }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: question.id,
        subject: question.subject,
        body: question.body,
        status: question.status,
        createdAt: question.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[ViewerQuestionsAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to submit question' }, { status: 500 });
  }
}
