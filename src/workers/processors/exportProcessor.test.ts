import { beforeEach, describe, expect, it, vi } from 'vitest';

// ------ archiver mock -------------------------------------------------------
let _capturedStream: { push: (chunk: Buffer | null) => void } | null = null;
const _archiverPipe = vi.fn();
const _archiverAppend = vi.fn();
const _archiverFinalize = vi.fn();
const _archiverOn = vi.fn();
const _archiverInstance = {
  pipe: _archiverPipe,
  append: _archiverAppend,
  finalize: _archiverFinalize,
  on: _archiverOn,
};
vi.mock('archiver', () => ({ default: vi.fn(() => _archiverInstance) }));

// ------ DB mocks ------------------------------------------------------------
const mockRoomFindFirst = vi.fn();
const mockDocumentFindMany = vi.fn();
const mockEventCreate = vi.fn().mockResolvedValue({});
const mockUserFindUnique = vi.fn();

vi.mock('@/lib/db', () => {
  const mockDb = {
    room: { findFirst: (...args: unknown[]) => mockRoomFindFirst(...args) },
    document: { findMany: (...args: unknown[]) => mockDocumentFindMany(...args) },
    event: { create: (...args: unknown[]) => mockEventCreate(...args) },
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
  };

  return {
    db: mockDb,
    withOrgContext: async (
      _organizationId: string,
      operation: (tx: typeof mockDb) => Promise<unknown>
    ) => operation(mockDb),
  };
});

// ------ Provider mocks -------------------------------------------------------
const mockStorageGet = vi.fn().mockResolvedValue(Buffer.from('file-content'));
const mockStoragePut = vi.fn().mockResolvedValue(undefined);
const mockStorageGetSignedUrl = vi.fn().mockResolvedValue('https://cdn.example.com/export.zip');
const mockEmailSendEmail = vi.fn().mockResolvedValue({ messageId: 'msg-1' });

vi.mock('@/providers', () => ({
  getProviders: () => ({
    storage: {
      get: mockStorageGet,
      put: mockStoragePut,
      getSignedUrl: mockStorageGetSignedUrl,
    },
    email: { sendEmail: mockEmailSendEmail },
  }),
}));

import { processRoomExportJob } from './exportProcessor';

// ---------------------------------------------------------------------------

function createMockJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      roomId: 'room-1',
      organizationId: 'org-1',
      requestedByUserId: 'user-1',
      options: { includeOriginals: false, includeMetadata: false },
      ...overrides,
    },
    id: 'job-1',
    name: 'room.export',
  } as never;
}

const MOCK_ROOM = { id: 'room-1', name: 'Series A Funding' };

const MOCK_DOCUMENTS = [
  {
    id: 'doc-1',
    name: 'Deck',
    folder: null,
    versions: [
      {
        id: 'ver-1',
        versionNumber: 1,
        mimeType: 'application/pdf',
        createdAt: new Date('2024-01-01'),
        fileBlob: { storageKey: 'documents/org-1/file.pdf', storageBucket: 'documents' },
      },
    ],
  },
];

function setupArchiverMock() {
  _capturedStream = null;
  mockStorageGet.mockResolvedValue(Buffer.from('file-content'));
  mockEmailSendEmail.mockResolvedValue({ messageId: 'msg-1' });
  _archiverPipe.mockImplementation((s: typeof _capturedStream) => {
    _capturedStream = s;
  });
  _archiverFinalize.mockImplementation(async () => {
    setImmediate(() => {
      _capturedStream?.push(Buffer.from('mock-zip-content'));
      _capturedStream?.push(null);
    });
  });
}

// ---------------------------------------------------------------------------

describe('processRoomExportJob — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(MOCK_ROOM);
    mockDocumentFindMany.mockResolvedValue(MOCK_DOCUMENTS);
    mockEventCreate.mockResolvedValue({});
    mockUserFindUnique.mockResolvedValue({ email: 'alice@example.com', firstName: 'Alice' });
  });

  it('fetches each file from storage', async () => {
    await processRoomExportJob(createMockJob());
    expect(mockStorageGet).toHaveBeenCalledWith('documents', 'documents/org-1/file.pdf');
  });

  it('appends files to archive', async () => {
    await processRoomExportJob(createMockJob());
    expect(_archiverAppend).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ name: 'Deck.pdf' })
    );
  });

  it('stores the ZIP in the exports prefix', async () => {
    await processRoomExportJob(createMockJob());
    expect(mockStoragePut).toHaveBeenCalledWith(
      'documents',
      expect.stringMatching(/^exports\/org-1\/room-1\//),
      expect.any(Buffer)
    );
  });

  it('creates an ADMIN_EXPORT_INITIATED audit event', async () => {
    await processRoomExportJob(createMockJob());
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          roomId: 'room-1',
          actorType: 'ADMIN',
          actorId: 'user-1',
          eventType: 'ADMIN_EXPORT_INITIATED',
        }),
      })
    );
  });

  it('fetches a signed URL and emails the requesting user', async () => {
    await processRoomExportJob(createMockJob());
    expect(mockStorageGetSignedUrl).toHaveBeenCalledWith(
      'documents',
      expect.stringContaining('exports/'),
      86400
    );
    expect(mockEmailSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        subject: expect.stringContaining('Series A Funding'),
        html: expect.stringContaining('https://cdn.example.com/export.zip'),
      })
    );
  });
});

describe('processRoomExportJob — no documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(MOCK_ROOM);
    mockDocumentFindMany.mockResolvedValue([]);
  });

  it('returns early without creating a ZIP', async () => {
    await processRoomExportJob(createMockJob());
    expect(mockStoragePut).not.toHaveBeenCalled();
    expect(mockEventCreate).not.toHaveBeenCalled();
  });
});

describe('processRoomExportJob — room not found', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(null);
  });

  it('throws so BullMQ can retry', async () => {
    await expect(processRoomExportJob(createMockJob())).rejects.toThrow('Room not found');
  });
});

describe('processRoomExportJob — user not found / no email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(MOCK_ROOM);
    mockDocumentFindMany.mockResolvedValue(MOCK_DOCUMENTS);
    mockEventCreate.mockResolvedValue({});
  });

  it('skips the email when user has no record', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await processRoomExportJob(createMockJob());
    expect(mockEmailSendEmail).not.toHaveBeenCalled();
  });

  it('skips the email when user has no email address', async () => {
    mockUserFindUnique.mockResolvedValue({ email: null, firstName: 'Ghost' });
    await processRoomExportJob(createMockJob());
    expect(mockEmailSendEmail).not.toHaveBeenCalled();
  });

  it('skips the email when export notification is disabled', async () => {
    mockUserFindUnique.mockResolvedValue({ email: 'alice@example.com', firstName: 'Alice' });
    await processRoomExportJob(createMockJob({ options: { sendEmail: false } }));
    expect(mockStoragePut).toHaveBeenCalled();
    expect(mockStorageGetSignedUrl).not.toHaveBeenCalled();
    expect(mockEmailSendEmail).not.toHaveBeenCalled();
  });
});

describe('processRoomExportJob — email send failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(MOCK_ROOM);
    mockDocumentFindMany.mockResolvedValue(MOCK_DOCUMENTS);
    mockEventCreate.mockResolvedValue({});
    mockUserFindUnique.mockResolvedValue({ email: 'alice@example.com', firstName: 'Alice' });
    mockEmailSendEmail.mockRejectedValue(new Error('SMTP down'));
  });

  it('does not throw when email fails', async () => {
    await expect(processRoomExportJob(createMockJob())).resolves.not.toThrow();
  });

  it('still stores the ZIP even if email fails', async () => {
    await processRoomExportJob(createMockJob());
    expect(mockStoragePut).toHaveBeenCalled();
  });
});

describe('processRoomExportJob — metadata included', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(MOCK_ROOM);
    mockDocumentFindMany.mockResolvedValue(MOCK_DOCUMENTS);
    mockEventCreate.mockResolvedValue({});
    mockUserFindUnique.mockResolvedValue({ email: 'alice@example.com', firstName: 'Alice' });
  });

  it('appends _metadata.json to the archive when includeMetadata is true', async () => {
    await processRoomExportJob(
      createMockJob({ options: { includeMetadata: true, includeOriginals: false } })
    );
    const calls = (_archiverAppend as ReturnType<typeof vi.fn>).mock.calls;
    const metaCall = calls.find(
      (c: unknown[]) =>
        typeof c[1] === 'object' && (c[1] as { name: string }).name === '_metadata.json'
    );
    expect(metaCall).toBeDefined();
  });
});

describe('processRoomExportJob — individual file storage failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(MOCK_ROOM);
    mockDocumentFindMany.mockResolvedValue(MOCK_DOCUMENTS);
    mockEventCreate.mockResolvedValue({});
    mockUserFindUnique.mockResolvedValue({ email: 'alice@example.com', firstName: 'Alice' });
    mockStorageGet.mockRejectedValue(new Error('Blob missing'));
  });

  it('continues and still creates the ZIP when a file cannot be retrieved', async () => {
    await expect(processRoomExportJob(createMockJob())).resolves.not.toThrow();
    expect(mockStoragePut).toHaveBeenCalled();
  });
});
