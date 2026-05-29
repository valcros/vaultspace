import { beforeEach, describe, expect, it, vi } from 'vitest';

// ------ Provider mocks ------------------------------------------------------
const mockEmailSendEmail = vi.fn().mockResolvedValue({ messageId: 'msg-1' });

vi.mock('@/providers', () => ({
  getProviders: () => ({
    email: { sendEmail: mockEmailSendEmail },
  }),
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
        data: { resetUrl: 'https://app.example.com/reset?token=abc' },
      })
    );
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('password'),
        html: expect.stringContaining('https://app.example.com/reset?token=abc'),
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

  it('re-throws so BullMQ can retry', async () => {
    await expect(processEmailJob(makeEmailJob())).rejects.toThrow('SMTP unreachable');
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
});
