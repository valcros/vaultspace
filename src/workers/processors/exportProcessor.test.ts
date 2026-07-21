import { beforeEach, describe, expect, it, vi } from 'vitest';

// ------ archiver mock -------------------------------------------------------
// The processor streams the archive to a temp file and waits for 'entry'
// events between appends, so the mock emulates pipe/entry/finalize behavior.
type EntryHandler = (entry: { name?: string }) => void;
let _capturedStream: { write: (chunk: Buffer) => void; end: () => void } | null = null;
let _entryHandlers: EntryHandler[] = [];
const _archiverPipe = vi.fn();
const _archiverAppend = vi.fn();
const _archiverFinalize = vi.fn();
const _archiverOn = vi.fn();
const _archiverOff = vi.fn();
const _archiverAbort = vi.fn();
const _archiverInstance = {
  pipe: _archiverPipe,
  append: _archiverAppend,
  finalize: _archiverFinalize,
  on: _archiverOn,
  off: _archiverOff,
  abort: _archiverAbort,
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
        scanStatus: 'CLEAN',
        createdAt: new Date('2024-01-01'),
        fileBlob: { storageKey: 'documents/org-1/file.pdf', storageBucket: 'documents' },
      },
    ],
  },
];

function setupArchiverMock() {
  _capturedStream = null;
  _entryHandlers = [];
  mockStorageGet.mockResolvedValue(Buffer.from('file-content'));
  mockEmailSendEmail.mockResolvedValue({ messageId: 'msg-1' });
  _archiverPipe.mockImplementation((s: typeof _capturedStream) => {
    _capturedStream = s;
  });
  _archiverOn.mockImplementation((event: string, handler: EntryHandler) => {
    if (event === 'entry') {
      _entryHandlers.push(handler);
    }
  });
  _archiverOff.mockImplementation((event: string, handler: EntryHandler) => {
    if (event === 'entry') {
      _entryHandlers = _entryHandlers.filter((h) => h !== handler);
    }
  });
  _archiverAppend.mockImplementation((_data: unknown, opts: { name: string }) => {
    const handlers = [..._entryHandlers];
    setImmediate(() => handlers.forEach((h) => h({ name: opts.name })));
  });
  _archiverFinalize.mockImplementation(async () => {
    setImmediate(() => {
      _capturedStream?.write(Buffer.from('mock-zip-content'));
      _capturedStream?.end();
    });
  });
}

function fakeBufferOfLength(length: number): Buffer {
  // The processor only reads .length before append; avoid allocating GBs.
  return { length } as unknown as Buffer;
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

describe('processRoomExportJob — scan gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(MOCK_ROOM);
    mockEventCreate.mockResolvedValue({});
    mockUserFindUnique.mockResolvedValue({ email: 'alice@example.com', firstName: 'Alice' });
  });

  it.each(['INFECTED', 'PENDING', 'ERROR'])(
    'never bundles a %s version into the archive',
    async (scanStatus) => {
      mockDocumentFindMany.mockResolvedValue([
        {
          id: 'doc-1',
          name: 'Deck',
          folder: null,
          versions: [
            {
              id: 'ver-1',
              versionNumber: 1,
              mimeType: 'application/pdf',
              scanStatus,
              createdAt: new Date('2024-01-01'),
              fileBlob: { storageKey: 'documents/org-1/file.pdf', storageBucket: 'documents' },
            },
          ],
        },
      ]);

      await processRoomExportJob(createMockJob());

      // The infected original is never fetched from storage nor appended.
      expect(mockStorageGet).not.toHaveBeenCalledWith('documents', 'documents/org-1/file.pdf');
      expect(_archiverAppend).not.toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ name: 'Deck.pdf' })
      );
    }
  );
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

describe('processRoomExportJob — multi-file sequential export', () => {
  const TWO_DOCUMENTS = [
    MOCK_DOCUMENTS[0],
    {
      id: 'doc-2',
      name: 'Financials',
      folder: null,
      versions: [
        {
          id: 'ver-2',
          versionNumber: 1,
          mimeType: 'text/csv',
          scanStatus: 'CLEAN',
          createdAt: new Date('2024-01-02'),
          fileBlob: { storageKey: 'documents/org-1/file.csv', storageBucket: 'documents' },
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(MOCK_ROOM);
    mockDocumentFindMany.mockResolvedValue(TWO_DOCUMENTS);
    mockEventCreate.mockResolvedValue({});
    mockUserFindUnique.mockResolvedValue({ email: 'alice@example.com', firstName: 'Alice' });
  });

  it('appends all files and completes (entry waits do not hang)', async () => {
    await processRoomExportJob(createMockJob());
    expect(_archiverAppend).toHaveBeenCalledTimes(2);
    expect(_archiverAppend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Deck.pdf' })
    );
    expect(_archiverAppend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Financials.csv' })
    );
    expect(mockStoragePut).toHaveBeenCalled();
  });
});

describe('processRoomExportJob — 2GB size guard', () => {
  const TWO_LARGE_DOCUMENTS = [
    MOCK_DOCUMENTS[0],
    {
      id: 'doc-2',
      name: 'Big File',
      folder: null,
      versions: [
        {
          id: 'ver-2',
          versionNumber: 1,
          mimeType: 'application/pdf',
          scanStatus: 'CLEAN',
          createdAt: new Date('2024-01-02'),
          fileBlob: { storageKey: 'documents/org-1/big.pdf', storageBucket: 'documents' },
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    setupArchiverMock();
    mockRoomFindFirst.mockResolvedValue(MOCK_ROOM);
    mockDocumentFindMany.mockResolvedValue(MOCK_DOCUMENTS);
    mockEventCreate.mockResolvedValue({});
    mockUserFindUnique.mockResolvedValue({ email: 'alice@example.com', firstName: 'Alice' });
  });

  it('fails the job with a clear message when a single file exceeds 2GB', async () => {
    mockStorageGet.mockResolvedValue(fakeBufferOfLength(2 * 1024 * 1024 * 1024 + 1));
    await expect(processRoomExportJob(createMockJob())).rejects.toThrow(
      'Export exceeds 2GB limit; export folders individually'
    );
    expect(_archiverAbort).toHaveBeenCalled();
    expect(mockStoragePut).not.toHaveBeenCalled();
    expect(mockEmailSendEmail).not.toHaveBeenCalled();
  });

  it('fails when cumulative source bytes across files exceed 2GB', async () => {
    mockDocumentFindMany.mockResolvedValue(TWO_LARGE_DOCUMENTS);
    mockStorageGet.mockResolvedValue(fakeBufferOfLength(1.5 * 1024 * 1024 * 1024));
    await expect(processRoomExportJob(createMockJob())).rejects.toThrow(
      'Export exceeds 2GB limit; export folders individually'
    );
    // First file fit under the limit and was appended; second tripped the guard
    expect(_archiverAppend).toHaveBeenCalledTimes(1);
    expect(mockStoragePut).not.toHaveBeenCalled();
  });

  it('completes normally when total size stays under the limit', async () => {
    mockStorageGet.mockResolvedValue(fakeBufferOfLength(1024));
    await expect(processRoomExportJob(createMockJob())).resolves.not.toThrow();
    expect(_archiverAbort).not.toHaveBeenCalled();
    expect(mockStoragePut).toHaveBeenCalled();
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
