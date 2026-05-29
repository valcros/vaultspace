/**
 * Scan Processor Tests
 *
 * Tests CLEAN path (queues preview), INFECTED path (audit event + admin email),
 * and ERROR path (re-throw for BullMQ retry).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock db
const mockVersionUpdate = vi.fn().mockResolvedValue({});
const mockDocumentFindFirst = vi.fn().mockResolvedValue({ roomId: 'room-1' });
const mockUserOrgFindMany = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/db', () => ({
  db: {
    documentVersion: { update: (...args: unknown[]) => mockVersionUpdate(...args) },
    document: { findFirst: (...args: unknown[]) => mockDocumentFindFirst(...args) },
    userOrganization: { findMany: (...args: unknown[]) => mockUserOrgFindMany(...args) },
  },
}));

// Mock EventBus
const mockEmit = vi.fn().mockResolvedValue('event-1');
vi.mock('@/lib/events/EventBus', () => ({
  createEventBus: () => ({ emit: mockEmit }),
}));

// Mock providers
const mockStorageGet = vi.fn().mockResolvedValue(Buffer.from('file-content'));
const mockJobAddJob = vi.fn().mockResolvedValue('job-1');
const mockScanScan = vi.fn().mockResolvedValue({ clean: true });
const mockScanIsAvailable = vi.fn().mockResolvedValue(true);
const mockEmailSendEmail = vi.fn().mockResolvedValue({ messageId: 'msg-1' });

vi.mock('@/providers', () => ({
  getProviders: () => ({
    storage: { get: mockStorageGet },
    job: { addJob: mockJobAddJob },
    scan: { scan: mockScanScan, isAvailable: mockScanIsAvailable },
    email: { sendEmail: mockEmailSendEmail },
  }),
}));

import { processScanJob } from './scanProcessor';

function createMockJob(overrides = {}) {
  return {
    data: {
      documentId: 'doc-1',
      versionId: 'ver-1',
      organizationId: 'org-1',
      storageKey: 'documents/org-1/file.pdf',
      fileName: 'report.pdf',
      fileSizeBytes: 1024,
      contentType: 'application/pdf',
      ...overrides,
    },
    id: 'job-1',
    name: 'scan.document',
  } as never;
}

describe('processScanJob — CLEAN path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanIsAvailable.mockResolvedValue(true);
    mockScanScan.mockResolvedValue({ clean: true });
  });

  it('marks version as CLEAN and queues preview', async () => {
    await processScanJob(createMockJob());

    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scanStatus: 'CLEAN' }),
      })
    );

    expect(mockJobAddJob).toHaveBeenCalledWith(
      'high',
      'preview.generate',
      expect.objectContaining({ documentId: 'doc-1', versionId: 'ver-1' }),
      expect.any(Object)
    );
  });

  it('does not emit an event or send email on clean result', async () => {
    await processScanJob(createMockJob());

    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockEmailSendEmail).not.toHaveBeenCalled();
  });
});

describe('processScanJob — scanner unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanIsAvailable.mockResolvedValue(false);
  });

  it('marks as CLEAN and queues preview when scanner is unavailable', async () => {
    await processScanJob(createMockJob());

    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'CLEAN' }) })
    );
    expect(mockJobAddJob).toHaveBeenCalled();
  });
});

describe('processScanJob — INFECTED path', () => {
  const threats = ['Eicar-Test-Signature', 'Win.Malware.Generic'];

  beforeEach(() => {
    vi.clearAllMocks();
    mockScanIsAvailable.mockResolvedValue(true);
    mockScanScan.mockResolvedValue({ clean: false, threats });
    mockDocumentFindFirst.mockResolvedValue({ roomId: 'room-1' });
  });

  it('marks version as INFECTED with threat list', async () => {
    await processScanJob(createMockJob());

    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scanStatus: 'INFECTED',
          scanError: expect.stringContaining('Eicar-Test-Signature'),
        }),
      })
    );
  });

  it('does not queue a preview job', async () => {
    await processScanJob(createMockJob());

    expect(mockJobAddJob).not.toHaveBeenCalled();
  });

  it('emits DOCUMENT_SCANNED audit event with roomId and threat metadata', async () => {
    await processScanJob(createMockJob());

    expect(mockEmit).toHaveBeenCalledWith(
      'DOCUMENT_SCANNED',
      expect.objectContaining({
        roomId: 'room-1',
        documentId: 'doc-1',
        metadata: expect.objectContaining({
          scanStatus: 'INFECTED',
          threats,
        }),
      })
    );
  });

  it('emails each active org admin', async () => {
    mockUserOrgFindMany.mockResolvedValue([
      { user: { email: 'admin1@org.com', firstName: 'Alice' } },
      { user: { email: 'admin2@org.com', firstName: 'Bob' } },
    ]);

    await processScanJob(createMockJob());

    expect(mockEmailSendEmail).toHaveBeenCalledTimes(2);
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin1@org.com',
        subject: expect.stringContaining('Infected'),
        html: expect.stringContaining('report.pdf'),
      })
    );
  });

  it('skips admins with no email address', async () => {
    mockUserOrgFindMany.mockResolvedValue([
      { user: { email: null, firstName: 'Ghost' } },
      { user: { email: 'real@org.com', firstName: 'Real' } },
    ]);

    await processScanJob(createMockJob());

    expect(mockEmailSendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'real@org.com' })
    );
  });

  it('continues if an individual admin email fails', async () => {
    mockUserOrgFindMany.mockResolvedValue([
      { user: { email: 'bad@org.com', firstName: 'Bad' } },
      { user: { email: 'good@org.com', firstName: 'Good' } },
    ]);
    mockEmailSendEmail
      .mockRejectedValueOnce(new Error('SMTP error'))
      .mockResolvedValueOnce({ messageId: 'ok' });

    await expect(processScanJob(createMockJob())).resolves.not.toThrow();
    expect(mockEmailSendEmail).toHaveBeenCalledTimes(2);
  });
});

describe('processScanJob — ERROR path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanIsAvailable.mockResolvedValue(true);
    mockScanScan.mockRejectedValue(new Error('ClamAV unreachable'));
  });

  it('marks version as ERROR and re-throws for BullMQ retry', async () => {
    await expect(processScanJob(createMockJob())).rejects.toThrow('ClamAV unreachable');

    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scanStatus: 'ERROR',
          scanError: 'ClamAV unreachable',
        }),
      })
    );
  });
});
