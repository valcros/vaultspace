/**
 * Question Service
 *
 * Handles Q&A lifecycle: question submission, answers, status changes.
 * All mutations emit events for audit trail.
 * Supports both authenticated users and external viewers.
 */

import type { Prisma, Question, Answer, QuestionStatus, QuestionPriority } from '@prisma/client';

import { withOrgContext } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

import type { PaginatedResult, ServiceContext } from './types';

/**
 * Question list filters
 */
export interface QuestionListOptions {
  status?: QuestionStatus;
  documentId?: string;
  search?: string;
  offset?: number;
  limit?: number;
}

/**
 * Question creation options (authenticated user)
 */
export interface CreateQuestionOptions {
  subject: string;
  body: string;
  documentId?: string;
  priority?: QuestionPriority;
  isPublic?: boolean;
}

/**
 * Question update options
 */
export interface UpdateQuestionOptions {
  status?: QuestionStatus;
  priority?: QuestionPriority;
  isPublic?: boolean;
}

/**
 * Viewer question creation options (no auth session)
 */
export interface CreateViewerQuestionOptions {
  subject: string;
  body: string;
  documentId?: string;
  askedByEmail: string;
  askedByName?: string;
  viewSessionId?: string;
}

/**
 * Question with answer count and asker info
 */
export interface QuestionWithMeta extends Question {
  _count: {
    answers: number;
  };
  askedByUser: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

/**
 * Question with full answers and answerer info
 */
export interface QuestionWithAnswers extends Question {
  answers: (Answer & {
    answeredBy: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
  })[];
  askedByUser: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

export class QuestionService {
  /**
   * List questions in a room
   * @readonly
   */
  async listQuestions(
    ctx: ServiceContext,
    roomId: string,
    options: QuestionListOptions = {}
  ): Promise<PaginatedResult<QuestionWithMeta>> {
    const { session } = ctx;
    const organizationId = session.organizationId;
    const { status, documentId, search, offset = 0, limit = 50 } = options;

    const where: Prisma.QuestionWhereInput = {
      organizationId,
      roomId,
      ...(status && { status }),
      ...(documentId && { documentId }),
      ...(search && {
        OR: [
          { subject: { contains: search, mode: 'insensitive' } },
          { body: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const { total, questions } = await withOrgContext(organizationId, async (tx) => {
      const total = await tx.question.count({ where });

      const questions = await tx.question.findMany({
        where,
        include: {
          _count: {
            select: {
              answers: true,
            },
          },
          askedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      });

      return { total, questions };
    });

    return {
      items: questions,
      total,
      offset,
      limit,
      hasMore: offset + questions.length < total,
    };
  }

  /**
   * Get a question by ID with all answers
   * @readonly
   */
  async getQuestion(
    ctx: ServiceContext,
    roomId: string,
    questionId: string
  ): Promise<QuestionWithAnswers> {
    const { session } = ctx;
    const organizationId = session.organizationId;

    const question = await withOrgContext(organizationId, async (tx) => {
      return tx.question.findFirst({
        where: {
          id: questionId,
          roomId,
          organizationId,
        },
        include: {
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
          askedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });
    });

    if (!question) {
      throw new NotFoundError('Question not found');
    }

    return question as QuestionWithAnswers;
  }

  /**
   * Create a question (authenticated user)
   * @mutating
   */
  async createQuestion(
    ctx: ServiceContext,
    roomId: string,
    options: CreateQuestionOptions
  ): Promise<Question> {
    const { session, eventBus } = ctx;
    const organizationId = session.organizationId;

    const question = await withOrgContext(organizationId, async (tx) => {
      return tx.question.create({
        data: {
          organizationId,
          roomId,
          subject: options.subject.trim(),
          body: options.body.trim(),
          documentId: options.documentId,
          priority: options.priority ?? 'NORMAL',
          isPublic: options.isPublic ?? false,
          askedByUserId: session.userId,
          askedByEmail: session.user.email,
          askedByName: `${session.user.firstName} ${session.user.lastName}`,
        },
      });
    });

    await eventBus.emit('QUESTION_SUBMITTED', {
      roomId,
      documentId: options.documentId,
      description: `Question submitted: ${question.subject}`,
      metadata: {
        questionId: question.id,
        subject: question.subject,
        documentId: options.documentId,
      },
    });

    return question;
  }

  /**
   * Update a question (status, priority, visibility)
   * @mutating
   */
  async updateQuestion(
    ctx: ServiceContext,
    roomId: string,
    questionId: string,
    options: UpdateQuestionOptions
  ): Promise<Question> {
    const { session, eventBus } = ctx;
    const organizationId = session.organizationId;

    const { question, previousStatus } = await withOrgContext(organizationId, async (tx) => {
      const existing = await tx.question.findFirst({
        where: {
          id: questionId,
          roomId,
          organizationId,
        },
      });

      if (!existing) {
        throw new NotFoundError('Question not found');
      }

      const data: Prisma.QuestionUpdateInput = {};
      if (options.status !== undefined) {
        data.status = options.status;
      }
      if (options.priority !== undefined) {
        data.priority = options.priority;
      }
      if (options.isPublic !== undefined) {
        data.isPublic = options.isPublic;
      }

      const updated = await tx.question.update({
        where: { id: questionId },
        data,
      });

      return { question: updated, previousStatus: existing.status };
    });

    const eventType =
      options.status === 'CLOSED' ? 'QUESTION_CLOSED' : 'QUESTION_UPDATED';

    await eventBus.emit(eventType, {
      roomId,
      description: `Question ${eventType === 'QUESTION_CLOSED' ? 'closed' : 'updated'}: ${question.subject}`,
      metadata: {
        questionId: question.id,
        changes: options,
        previousStatus,
      },
    });

    return question;
  }

  /**
   * Create an answer to a question
   * @mutating
   */
  async createAnswer(
    ctx: ServiceContext,
    roomId: string,
    questionId: string,
    body: string
  ): Promise<Answer> {
    const { session, eventBus } = ctx;
    const organizationId = session.organizationId;

    const answer = await withOrgContext(organizationId, async (tx) => {
      const question = await tx.question.findFirst({
        where: {
          id: questionId,
          roomId,
          organizationId,
        },
      });

      if (!question) {
        throw new NotFoundError('Question not found');
      }

      const created = await tx.answer.create({
        data: {
          organizationId,
          questionId,
          answeredByUserId: session.userId,
          body: body.trim(),
        },
      });

      // Auto-set question status to ANSWERED if currently OPEN
      if (question.status === 'OPEN') {
        await tx.question.update({
          where: { id: questionId },
          data: { status: 'ANSWERED' },
        });
      }

      return created;
    });

    await eventBus.emit('ANSWER_SUBMITTED', {
      roomId,
      description: `Answer submitted for question ${questionId}`,
      metadata: {
        answerId: answer.id,
        questionId,
      },
    });

    return answer;
  }

  /**
   * Create a question from an external viewer (no session required)
   * @mutating
   */
  async createViewerQuestion(
    organizationId: string,
    roomId: string,
    options: CreateViewerQuestionOptions
  ): Promise<Question> {
    const question = await withOrgContext(organizationId, async (tx) => {
      return tx.question.create({
        data: {
          organizationId,
          roomId,
          subject: options.subject.trim(),
          body: options.body.trim(),
          documentId: options.documentId,
          askedByEmail: options.askedByEmail,
          askedByName: options.askedByName,
          viewSessionId: options.viewSessionId,
          priority: 'NORMAL',
          isPublic: false,
          status: 'OPEN',
        },
      });
    });

    // Emit event without EventBus (no session context available)
    await withOrgContext(organizationId, async (tx) => {
      await tx.event.create({
        data: {
          organizationId,
          roomId,
          eventType: 'QUESTION_SUBMITTED',
          actorType: 'VIEWER',
          actorEmail: options.askedByEmail,
          description: `Viewer question submitted: ${question.subject}`,
          metadata: {
            questionId: question.id,
            subject: question.subject,
            askedByEmail: options.askedByEmail,
            viewSessionId: options.viewSessionId,
          },
        },
      });
    });

    return question;
  }

  /**
   * List questions visible to a viewer (own questions + public answered questions)
   * @readonly
   */
  async listViewerQuestions(
    organizationId: string,
    roomId: string,
    viewerEmail: string
  ): Promise<Question[]> {
    return withOrgContext(organizationId, async (tx) => {
      return tx.question.findMany({
        where: {
          organizationId,
          roomId,
          OR: [
            // Viewer's own questions
            { askedByEmail: viewerEmail },
            // Public questions that have been answered
            { isPublic: true, status: 'ANSWERED' },
            { isPublic: true, status: 'CLOSED' },
          ],
        },
        include: {
          _count: {
            select: {
              answers: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  }
}

export const questionService = new QuestionService();
