import { beforeEach, describe, expect, it, vi } from 'vitest';

// ------ Provider mocks ------------------------------------------------------
const mockEmailSendEmail = vi.fn().mockResolvedValue({ messageId: 'msg-1' });

vi.mock('@/providers', () => ({
  getProviders: () => ({
    email: { sendEmail: mockEmailSendEmail },
  }),
}));

// ------ DB mocks --------------------------------------------------------------
const mockDocumentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockResetFindUnique = vi.fn();
const mockResetUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockWithOrgContext = vi.fn(
  async (_organizationId: string, operation: (tx: unknown) => Promise<unknown>) =>
    operation({ document: { updateMany: mockDocumentUpdateMany } })
);

vi.mock('@/lib/db', () => ({
  bootstrapDb: {
    passwordResetToken: {
      findUnique: (...args: unknown[]) => mockResetFindUnique(...args),
      updateMany: (...args: unknown[]) => mockResetUpdateMany(...args),
    },
  },
  withOrgContext: (organizationId: string, operation: (tx: unknown) => Promise<unknown>) =>
    mockWithOrgContext(organizationId, operation),
}));

const mockCaptureSecurityAudit = vi.fn().mockResolvedValue('captured');
vi.mock('@/lib/audit/securityAudit', () => ({
  captureSecurityAudit: (...args: unknown[]) => mockCaptureSecurityAudit(...args),
}));

// ------ EmailNotificationService mock ---------------------------------------
const mockNotifyDocumentUploaded = vi.fn().mockResolvedValue(undefined);
const mockNotifyDocumentViewed = vi.fn().mockResolvedValue(undefined);

vi.mock('@/services/notifications', () => ({
  EmailNotificationService: vi.fn().mockImplementation(() => ({
    notifyDocumentUploaded: mockNotifyDocumentUploaded,
    notifyDocumentViewed: mockNotifyDocumentViewed,
  })),
}));

import {
  processDocumentUploadedNotification,
  processDocumentViewedNotification,
  processEmailJob,
} from './emailProcessor';

// ---------------------------------------------------------------------------

function makeEmailJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      to: 'recipient@example.com',
      subject: 'Test Subject',
      template: '',
      data: {},
      ...overrides,
    },
    id: 'job-1',
    name: 'email.send',
    attemptsMade: 0,
    opts: { attempts: 5 },
  } as never;
}

function makeNotificationJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      organizationId: 'org-1',
      roomId: 'room-1',
      documentId: 'doc-1',
      uploaderId: 'user-1',
      ...overrides,
    },
    id: 'job-1',
    name: 'notify',
  } as never;
}

// ---------------------------------------------------------------------------

describe('processEmailJob — template rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailSendEmail.mockResolvedValue({ messageId: 'msg-1' });
  });

  it('renders room-invitation template with correct subject and html', async () => {
    await processEmailJob(
      makeEmailJob({
        template: 'room-invitation',
        data: {
          inviterName: 'Alice',
          roomName: 'Due Diligence',
          roomUrl: 'https://app.example.com/rooms/1',
        },
      })
    );
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Due Diligence'),
        html: expect.stringContaining('Alice'),
      })
    );
  });

  it('renders document-shared template', async () => {
    await processEmailJob(
      makeEmailJob({
        template: 'document-shared',
        data: {
          sharerName: 'Bob',
          documentName: 'Term Sheet.pdf',
          documentUrl: 'https://app.example.com/docs/1',
        },
      })
    );
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Bob'),
        html: expect.stringContaining('Term Sheet.pdf'),
      })
    );
  });

  it('renders password-reset template', async () => {
    await processEmailJob(
      makeEmailJob({
        template: 'password-reset',
        data: {
          resetUrl: 'https://app.example.com/reset?token=abc',
          userName: 'Dana',
          organizationName: 'Demo Organization',
          expiresIn: '1 hour',
        },
      })
    );
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Reset your Demo Organization password',
        html: expect.stringContaining('https://app.example.com/reset?token=abc'),
      })
    );
  });

  it('renders room-digest template', async () => {
    await processEmailJob(
      makeEmailJob({
        template: 'room-digest',
        data: {
          recipientName: 'Ada Admin',
          period: 'weekly',
          roomName: 'Diligence Room',
          from: '2026-06-23T00:00:00.000Z',
          to: '2026-06-30T00:00:00.000Z',
          roomUrl: 'https://app.example.com/rooms/room-1',
          summary: {
            documentsUploaded: 2,
            documentsViewed: 5,
            documentsDownloaded: 1,
            uniqueViewers: 3,
            questionsSubmitted: 1,
            questionsAnswered: 1,
            newShareLinks: 2,
          },
          topDocuments: [{ name: 'Report.pdf', views: 5, downloads: 1 }],
          recentQuestions: [{ subject: 'Clarify revenue?', status: 'OPEN' }],
          viewerActivity: [{ email: 'viewer@example.com', views: 2 }],
        },
      })
    );

    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Weekly digest: Diligence Room',
        html: expect.stringContaining('Report.pdf'),
        text: expect.stringContaining('Documents uploaded: 2'),
      })
    );
  });

  it('renders welcome template', async () => {
    await processEmailJob(
      makeEmailJob({
        template: 'welcome',
        data: { userName: 'Charlie', dashboardUrl: 'https://app.example.com/dashboard' },
      })
    );
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Welcome'),
        html: expect.stringContaining('Charlie'),
      })
    );
  });
});

describe('processEmailJob — raw HTML fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailSendEmail.mockResolvedValue({ messageId: 'msg-1' });
  });

  it('falls back to data.html when no template is specified', async () => {
    await processEmailJob(
      makeEmailJob({
        template: '',
        data: { html: '<p>Hello world</p>', text: 'Hello world' },
      })
    );
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<p>Hello world</p>',
      })
    );
  });

  it('falls back to data.html when an unknown template is specified', async () => {
    await processEmailJob(
      makeEmailJob({
        template: 'nonexistent-template',
        data: { html: '<p>Fallback</p>' },
      })
    );
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<p>Fallback</p>' })
    );
  });

  it('passes text alongside html when present', async () => {
    await processEmailJob(
      makeEmailJob({
        template: '',
        data: { html: '<p>Hi</p>', text: 'Hi' },
      })
    );
    expect(mockEmailSendEmail).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hi' }));
  });
});

describe('processEmailJob — send failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailSendEmail.mockRejectedValue(new Error('SMTP unreachable'));
  });

  it('re-throws a normalized retryable error so BullMQ can retry', async () => {
    await expect(processEmailJob(makeEmailJob())).rejects.toThrow('EMAIL_PROVIDER_ERROR');
  });
});

describe('processEmailJob — password reset lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetFindUnique.mockResolvedValue({
      deliveryStatus: 'QUEUED',
      deliveryAttempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockResetUpdateMany.mockResolvedValue({ count: 1 });
    mockEmailSendEmail.mockResolvedValue({ messageId: 'acs-message-1' });
  });

  it('propagates the flow id and stores provider acceptance', async () => {
    await processEmailJob(
      makeEmailJob({
        template: 'password-reset',
        passwordReset: {
          flowId: 'flow-1',
          userId: 'user-1',
          requestId: 'request-1',
          organizationIds: ['org-1'],
        },
      })
    );

    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'flow-1', sensitiveContent: true })
    );
    expect(mockResetUpdateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        id: 'flow-1',
        usedAt: null,
        deliveryStatus: 'SENDING',
        deliveryAttempts: 1,
      }),
      data: expect.objectContaining({
        deliveryStatus: 'PROVIDER_ACCEPTED',
        providerMessageId: 'acs-message-1',
      }),
    });
  });

  it('does not submit a reset email again after provider acceptance', async () => {
    mockResetUpdateMany.mockResolvedValueOnce({ count: 0 });
    mockResetFindUnique.mockResolvedValue({
      deliveryStatus: 'PROVIDER_ACCEPTED',
      deliveryAttempts: 1,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await processEmailJob(
      makeEmailJob({
        template: 'password-reset',
        passwordReset: {
          flowId: 'flow-1',
          userId: 'user-1',
          requestId: 'request-1',
          organizationIds: ['org-1'],
        },
      })
    );

    expect(mockEmailSendEmail).not.toHaveBeenCalled();
  });

  it('does not submit when the authoritative claim loses to token invalidation', async () => {
    mockResetUpdateMany.mockResolvedValueOnce({ count: 0 });
    mockResetFindUnique.mockResolvedValue({
      deliveryStatus: 'QUEUED',
      deliveryAttempts: 0,
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await processEmailJob(
      makeEmailJob({
        template: 'password-reset',
        passwordReset: {
          flowId: 'flow-1',
          userId: 'user-1',
          requestId: 'request-1',
          organizationIds: ['org-1'],
        },
      })
    );

    expect(mockEmailSendEmail).not.toHaveBeenCalled();
  });

  it('does not submit an expired reset flow', async () => {
    mockResetUpdateMany.mockResolvedValueOnce({ count: 0 });
    mockResetFindUnique.mockResolvedValue({
      deliveryStatus: 'QUEUED',
      deliveryAttempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() - 1),
    });

    await processEmailJob(
      makeEmailJob({
        template: 'password-reset',
        passwordReset: {
          flowId: 'flow-1',
          userId: 'user-1',
          requestId: 'request-1',
          organizationIds: ['org-1'],
        },
      })
    );

    expect(mockEmailSendEmail).not.toHaveBeenCalled();
  });

  it('does not retry after provider acceptance when lifecycle persistence fails', async () => {
    mockResetUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      processEmailJob(
        makeEmailJob({
          template: 'password-reset',
          passwordReset: {
            flowId: 'flow-1',
            userId: 'user-1',
            requestId: 'request-1',
            organizationIds: ['org-1'],
          },
        })
      )
    ).resolves.toBeUndefined();

    expect(mockEmailSendEmail).toHaveBeenCalledOnce();
  });

  it('stops retrying a permanent mailbox rejection and records a terminal audit event', async () => {
    mockEmailSendEmail.mockRejectedValue({ responseCode: 550 });

    await expect(
      processEmailJob(
        makeEmailJob({
          template: 'password-reset',
          passwordReset: {
            flowId: 'flow-1',
            userId: 'user-1',
            requestId: 'request-1',
            organizationIds: ['org-1'],
          },
        })
      )
    ).rejects.toThrow('SMTP_PERMANENT_REJECTION');

    expect(mockResetUpdateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        id: 'flow-1',
        usedAt: null,
        deliveryStatus: 'SENDING',
        deliveryAttempts: 1,
      }),
      data: expect.objectContaining({
        deliveryStatus: 'FAILED_PERMANENT',
        deliveryErrorCode: 'SMTP_PERMANENT_REJECTION',
      }),
    });
    expect(mockCaptureSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'USER_PASSWORD_RESET' })
    );
  });
});

describe('processEmailJob — recipient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailSendEmail.mockResolvedValue({ messageId: 'msg-1' });
  });

  it('passes the to address through', async () => {
    await processEmailJob(makeEmailJob({ to: 'specific@example.com' }));
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'specific@example.com' })
    );
  });

  it('accepts an array of recipients', async () => {
    await processEmailJob(makeEmailJob({ to: ['a@example.com', 'b@example.com'] }));
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['a@example.com', 'b@example.com'] })
    );
  });
});

// ---------------------------------------------------------------------------

describe('processDocumentUploadedNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifyDocumentUploaded.mockResolvedValue(undefined);
    process.env['APP_URL'] = 'https://app.example.com';
  });

  it('calls notifyDocumentUploaded with correct args', async () => {
    await processDocumentUploadedNotification(makeNotificationJob());
    expect(mockNotifyDocumentUploaded).toHaveBeenCalledWith({
      organizationId: 'org-1',
      roomId: 'room-1',
      documentId: 'doc-1',
      uploaderId: 'user-1',
    });
  });

  it('throws when APP_URL is not set', async () => {
    delete process.env['APP_URL'];
    await expect(processDocumentUploadedNotification(makeNotificationJob())).rejects.toThrow(
      'APP_URL'
    );
  });
});

describe('processDocumentViewedNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifyDocumentViewed.mockResolvedValue(undefined);
    mockDocumentUpdateMany.mockResolvedValue({ count: 1 });
    process.env['APP_URL'] = 'https://app.example.com';
  });

  it('calls notifyDocumentViewed with correct args', async () => {
    await processDocumentViewedNotification(
      makeNotificationJob({ viewerEmail: 'viewer@example.com', uploaderId: undefined })
    );
    expect(mockNotifyDocumentViewed).toHaveBeenCalledWith({
      organizationId: 'org-1',
      roomId: 'room-1',
      documentId: 'doc-1',
      viewerEmail: 'viewer@example.com',
    });
  });

  it('throws when APP_URL is not set', async () => {
    delete process.env['APP_URL'];
    await expect(processDocumentViewedNotification(makeNotificationJob())).rejects.toThrow(
      'APP_URL'
    );
  });

  it('increments viewCount with org scoping when incrementViewCount is set', async () => {
    await processDocumentViewedNotification(makeNotificationJob({ incrementViewCount: true }));
    expect(mockWithOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockDocumentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'doc-1', organizationId: 'org-1' },
      data: { viewCount: { increment: 1 } },
    });
  });

  it('still sends the view notification email when incrementing', async () => {
    await processDocumentViewedNotification(
      makeNotificationJob({ incrementViewCount: true, viewerEmail: 'viewer@example.com' })
    );
    expect(mockNotifyDocumentViewed).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', viewerEmail: 'viewer@example.com' })
    );
  });

  it('does not touch viewCount when incrementViewCount is absent (link-based views)', async () => {
    await processDocumentViewedNotification(
      makeNotificationJob({ viewerEmail: 'viewer@example.com' })
    );
    expect(mockDocumentUpdateMany).not.toHaveBeenCalled();
    expect(mockNotifyDocumentViewed).toHaveBeenCalled();
  });

  it('rethrows increment failures so BullMQ can retry', async () => {
    mockDocumentUpdateMany.mockRejectedValue(new Error('DB down'));
    await expect(
      processDocumentViewedNotification(makeNotificationJob({ incrementViewCount: true }))
    ).rejects.toThrow('DB down');
    expect(mockNotifyDocumentViewed).not.toHaveBeenCalled();
  });
});
