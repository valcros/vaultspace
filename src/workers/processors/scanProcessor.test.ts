/**
 * Scan Processor Tests
 *
 * Tests CLEAN path (queues preview), INFECTED path (audit event + admin email),
 * and ERROR path (re-throw for BullMQ retry).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock db
const mockVersionUpdate = vi.fn().mockResolvedValue({});
// Terminal-state idempotency guard reads the current scanStatus; default to a
// re-processable state so the normal paths run.
const mockVersionFindFirst = vi.fn().mockResolvedValue({ scanStatus: 'PENDING' });
const mockDocumentFindFirst = vi.fn().mockResolvedValue({ roomId: 'room-1' });
const mockUserOrgFindMany = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/db', () => {
  const mockDb = {
    documentVersion: {
      update: (...args: unknown[]) => mockVersionUpdate(...args),
      findFirst: (...args: unknown[]) => mockVersionFindFirst(...args),
    },
    document: { findFirst: (...args: unknown[]) => mockDocumentFindFirst(...args) },
    userOrganization: { findMany: (...args: unknown[]) => mockUserOrgFindMany(...args) },
  };

  return {
    db: mockDb,
    withOrgContext: async (
      _organizationId: string,
      operation: (tx: typeof mockDb) => Promise<unknown>
    ) => operation(mockDb),
  };
});

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

const originalScanEngine = process.env['SCAN_ENGINE'];
const originalClamavHost = process.env['CLAMAV_HOST'];
const originalClamavReadyTimeoutMs = process.env['CLAMAV_READY_TIMEOUT_MS'];
const originalClamavReadyPollMs = process.env['CLAMAV_READY_POLL_MS'];

afterEach(() => {
  if (originalScanEngine === undefined) {
    delete process.env['SCAN_ENGINE'];
  } else {
    process.env['SCAN_ENGINE'] = originalScanEngine;
  }

  if (originalClamavHost === undefined) {
    delete process.env['CLAMAV_HOST'];
  } else {
    process.env['CLAMAV_HOST'] = originalClamavHost;
  }

  if (originalClamavReadyTimeoutMs === undefined) {
    delete process.env['CLAMAV_READY_TIMEOUT_MS'];
  } else {
    process.env['CLAMAV_READY_TIMEOUT_MS'] = originalClamavReadyTimeoutMs;
  }

  if (originalClamavReadyPollMs === undefined) {
    delete process.env['CLAMAV_READY_POLL_MS'];
  } else {
    process.env['CLAMAV_READY_POLL_MS'] = originalClamavReadyPollMs;
  }
});

function createMockJob(overrides = {}, jobOverrides = {}) {
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
    attemptsMade: 0,
    opts: { attempts: 10 },
    ...jobOverrides,
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
      expect.objectContaining({ documentId: 'doc-1', versionId: 'ver-1' })
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
    delete process.env['SCAN_ENGINE'];
    delete process.env['CLAMAV_HOST'];
  });

  it('marks as CLEAN and queues preview when scanner is unavailable', async () => {
    await processScanJob(createMockJob());

    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'CLEAN' }) })
    );
    expect(mockJobAddJob).toHaveBeenCalled();
  });

  it('keeps scan PENDING when ClamAV is configured but unavailable and attempts remain', async () => {
    process.env['SCAN_ENGINE'] = 'clamav';
    process.env['CLAMAV_HOST'] = 'localhost';
    process.env['CLAMAV_READY_TIMEOUT_MS'] = '0';

    await expect(processScanJob(createMockJob())).rejects.toThrow(
      'Configured virus scanner is not available'
    );

    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scanStatus: 'PENDING',
          scanError: null,
          scannedAt: null,
        }),
      })
    );
    expect(mockJobAddJob).not.toHaveBeenCalled();
  });

  it('marks ERROR when ClamAV is unavailable on the final attempt', async () => {
    process.env['SCAN_ENGINE'] = 'clamav';
    process.env['CLAMAV_HOST'] = 'localhost';
    process.env['CLAMAV_READY_TIMEOUT_MS'] = '0';

    await expect(
      processScanJob(createMockJob({}, { attemptsMade: 9, opts: { attempts: 10 } }))
    ).rejects.toThrow('Configured virus scanner is not available');

    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scanStatus: 'ERROR',
          scanError: 'Configured virus scanner is not available',
        }),
      })
    );
    expect(mockJobAddJob).not.toHaveBeenCalled();
  });

  it('waits for configured ClamAV to become available before scanning', async () => {
    process.env['SCAN_ENGINE'] = 'clamav';
    process.env['CLAMAV_HOST'] = 'localhost';
    process.env['CLAMAV_READY_TIMEOUT_MS'] = '500';
    process.env['CLAMAV_READY_POLL_MS'] = '100';
    mockScanIsAvailable.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockScanScan.mockResolvedValue({ clean: true });

    await processScanJob(createMockJob());

    expect(mockScanIsAvailable).toHaveBeenCalledTimes(2);
    expect(mockScanScan).toHaveBeenCalledWith(Buffer.from('file-content'));
    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scanStatus: 'CLEAN' }),
      })
    );
    expect(mockJobAddJob).toHaveBeenCalledWith(
      'high',
      'preview.generate',
      expect.objectContaining({ documentId: 'doc-1', versionId: 'ver-1' })
    );
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

describe('processScanJob — idempotency (redelivery)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanIsAvailable.mockResolvedValue(true);
  });

  it.each(['CLEAN', 'INFECTED', 'SKIPPED'])(
    'does not re-scan a version already in terminal state %s',
    async (status) => {
      mockVersionFindFirst.mockResolvedValueOnce({ scanStatus: status });
      await processScanJob(createMockJob());
      expect(mockScanScan).not.toHaveBeenCalled();
      expect(mockVersionUpdate).not.toHaveBeenCalled();
    }
  );
});

describe('processScanJob — SKIPPED path (too large to scan)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanIsAvailable.mockResolvedValue(true);
    mockScanScan.mockResolvedValue({
      clean: true,
      skipped: true,
      skipReason:
        "File exceeds the scanner's maximum scan size (137740552 > 26214400 bytes); allowed but not virus-scanned",
    });
    mockDocumentFindFirst.mockResolvedValue({ roomId: 'room-1' });
  });

  it('marks version SKIPPED with the reason (NOT INFECTED)', async () => {
    await processScanJob(createMockJob());
    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scanStatus: 'SKIPPED',
          scanError: expect.stringContaining('not virus-scanned'),
        }),
      })
    );
  });

  it('still queues a preview so the file is usable', async () => {
    await processScanJob(createMockJob());
    expect(mockJobAddJob).toHaveBeenCalled();
  });

  it('does NOT email admins (it is not a threat)', async () => {
    mockUserOrgFindMany.mockResolvedValue([
      { user: { email: 'admin@org.com', firstName: 'Admin' } },
    ]);
    await processScanJob(createMockJob());
    expect(mockEmailSendEmail).not.toHaveBeenCalled();
  });

  it('audits the skip via DOCUMENT_SCANNED', async () => {
    await processScanJob(createMockJob());
    expect(mockEmit).toHaveBeenCalledWith(
      'DOCUMENT_SCANNED',
      expect.objectContaining({
        roomId: 'room-1',
        metadata: expect.objectContaining({ scanStatus: 'SKIPPED' }),
      })
    );
  });
});

describe('processScanJob — ERROR path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanIsAvailable.mockResolvedValue(true);
    mockScanScan.mockRejectedValue(new Error('ClamAV unreachable'));
  });

  it('keeps scan PENDING and re-throws while attempts remain', async () => {
    await expect(processScanJob(createMockJob())).rejects.toThrow('ClamAV unreachable');

    expect(mockVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scanStatus: 'PENDING',
          scanError: null,
          scannedAt: null,
        }),
      })
    );
  });

  it('marks version as ERROR on the final attempt', async () => {
    await expect(
      processScanJob(createMockJob({}, { attemptsMade: 9, opts: { attempts: 10 } }))
    ).rejects.toThrow('ClamAV unreachable');

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
