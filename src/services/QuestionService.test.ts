import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceContext } from './types';

const mocks = vi.hoisted(() => ({
  withOrgContext: vi.fn(),
  notifyRoomAdministrators: vi.fn(),
  notifyQuestionAsker: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ withOrgContext: mocks.withOrgContext }));
vi.mock('@/services/notifications/InAppNotificationService', () => ({
  notifyRoomAdministrators: mocks.notifyRoomAdministrators,
  notifyQuestionAsker: mocks.notifyQuestionAsker,
}));

import { QuestionService } from './QuestionService';

function context() {
  return {
    session: {
      organizationId: 'org-1',
      userId: 'admin-1',
      user: { email: 'admin@example.test', firstName: 'Admin', lastName: 'One' },
    },
    eventBus: { emit: vi.fn().mockResolvedValue('event-1') },
  } as unknown as ServiceContext;
}

function transaction() {
  return {
    question: {
      create: vi
        .fn()
        .mockResolvedValue({ id: 'question-1', subject: 'Question?', askedByUserId: 'member-1' }),
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'question-1', status: 'OPEN', askedByUserId: 'member-1' }),
      update: vi.fn(),
    },
    answer: { create: vi.fn().mockResolvedValue({ id: 'answer-1' }) },
    event: { create: vi.fn().mockResolvedValue({ id: 'viewer-event-1' }) },
  };
}

describe('Q&A inbox producers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(transaction())
    );
  });

  it('notifies room administrators when a member asks a question', async () => {
    const ctx = context();
    await new QuestionService().createQuestion(ctx, 'room-1', {
      subject: 'Question?',
      body: 'Body',
    });
    expect(mocks.notifyRoomAdministrators).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sourceEventId: 'event-1',
        actorUserId: 'admin-1',
        type: 'QUESTION_ACTIVITY',
        actionPath: '/rooms/room-1?manage=qa',
      })
    );
  });

  it('notifies the active question asker when an answer is submitted', async () => {
    const ctx = context();
    await new QuestionService().createAnswer(ctx, 'room-1', 'question-1', 'Answer');
    expect(mocks.notifyQuestionAsker).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sourceEventId: 'event-1',
        askerUserId: 'member-1',
        actorUserId: 'admin-1',
      })
    );
  });

  it('writes a viewer question audit event and notification in one transaction', async () => {
    const tx = transaction();
    mocks.withOrgContext.mockImplementation(
      async (_org: string, callback: (tx: unknown) => unknown) => callback(tx)
    );
    await new QuestionService().createViewerQuestion('org-1', 'room-1', {
      subject: 'Viewer question?',
      body: 'Body',
      askedByEmail: 'viewer@example.test',
    });
    expect(mocks.withOrgContext).toHaveBeenCalledTimes(1);
    expect(tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: 'QUESTION_SUBMITTED', actorType: 'VIEWER' }),
    });
    expect(mocks.notifyRoomAdministrators).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sourceEventId: 'viewer-event-1', type: 'QUESTION_ACTIVITY' })
    );
  });
});
