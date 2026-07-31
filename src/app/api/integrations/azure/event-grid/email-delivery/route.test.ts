import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  transaction: vi.fn(),
  createMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  queryRaw: vi.fn(),
}));

const configuration = {
  enabled: true,
  tenantId: '11111111-1111-4111-8111-111111111111',
  audience: '44444444-4444-4444-8444-444444444444',
  callerAppId: '22222222-2222-4222-8222-222222222222',
  callerObjectId: null,
  requiredRole: 'AzureEventGridSecureWebhookSubscriber',
  sources: [
    {
      subscriptionName: 'email-delivery',
      topic:
        '/subscriptions/sub/resourcegroups/rg/providers/microsoft.communication/communicationservices/acs',
    },
  ],
  activeFingerprintKeyId: '2026-07',
  fingerprintKeys: new Map([
    ['2026-07', Buffer.alloc(32, 7)],
    ['2026-06', Buffer.alloc(32, 6)],
  ]),
  expectedInboxOwner: 'vaultspace_migrator',
};

vi.mock('@/lib/integrations/acsEventGridConfig', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAcsEventGridConfiguration: () => configuration,
}));
vi.mock('@/lib/integrations/eventGridAuth', async (importOriginal) => ({
  ...(await importOriginal()),
  authenticateEventGridRequest: (...args: unknown[]) => mocks.authenticate(...args),
}));
vi.mock('@/lib/db', () => ({
  providerIngressDb: { $transaction: (...args: unknown[]) => mocks.transaction(...args) },
}));

import { POST } from './route';

const topic = configuration.sources[0]!.topic;

function deliveryEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    topic,
    subject: 'sender/private@example.com/message/event-1',
    eventType: 'Microsoft.Communication.EmailDeliveryReportReceived',
    dataVersion: '1.0',
    metadataVersion: '1',
    eventTime: '2026-07-31T03:00:00.000Z',
    data: {
      sender: 'private-sender@example.com',
      recipient: 'private-recipient@example.com',
      messageId: 'provider-message-1',
      status: 'Delivered',
      deliveryStatusDetails: { statusMessage: 'private provider detail' },
      deliveryAttemptTimeStamp: '2026-07-31T02:59:59.000Z',
    },
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(
    'https://vaultspace.example/api/integrations/azure/event-grid/email-delivery',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        authorization: 'Bearer a.b.c',
        'content-type': 'application/json',
        'aeg-subscription-name': 'email-delivery',
        'aeg-event-type': 'Notification',
        ...headers,
      },
    }
  );
}

describe('ACS Event Grid shadow ingestion', () => {
  let stored: Record<string, unknown> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = null;
    mocks.authenticate.mockResolvedValue(undefined);
    mocks.createMany.mockImplementation(async ({ data }) => {
      if (stored) {
        return { count: 0 };
      }
      stored = {
        id: 'receipt-1',
        createdAt: new Date('2026-07-31T03:00:01Z'),
        updatedAt: new Date('2026-07-31T03:00:01Z'),
        conflictCount: 0,
        firstConflictAt: null,
        conflictingPayloadFingerprint: null,
        lastConflictAt: null,
        lastConflictingPayloadFingerprint: null,
        ...data,
      };
      return { count: 1 };
    });
    mocks.findUniqueOrThrow.mockImplementation(async () => stored);
    mocks.queryRaw.mockImplementation(async () => {
      const conflictAt = new Date();
      stored = {
        ...stored,
        processingStatus: 'CONFLICT',
        conflictCount: Number(stored?.['conflictCount'] ?? 0) + 1,
        firstConflictAt: stored?.['firstConflictAt'] ?? conflictAt,
        conflictingPayloadFingerprint:
          stored?.['conflictingPayloadFingerprint'] ?? 'first-conflict-fingerprint',
        lastConflictAt: conflictAt,
        lastConflictingPayloadFingerprint: 'last-conflict-fingerprint',
        lastErrorCode: 'EVENT_ID_PAYLOAD_CONFLICT',
      };
      return [{ conflictCount: stored['conflictCount'] }];
    });
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        providerEventInbox: {
          createMany: mocks.createMany,
          findUniqueOrThrow: mocks.findUniqueOrThrow,
        },
        $queryRaw: mocks.queryRaw,
      })
    );
  });

  it('authenticates before accepting an exact subscription validation handshake', async () => {
    const response = await POST(
      request(
        [
          {
            id: 'validation-1',
            topic,
            eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
            data: { validationCode: 'bounded-validation-code' },
          },
        ],
        { 'aeg-event-type': 'SubscriptionValidation' }
      )
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      validationResponse: 'bounded-validation-code',
    });
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('stores normalized evidence without raw PII and commits before 200', async () => {
    const response = await POST(request([deliveryEvent()]));
    expect(response.status).toBe(200);
    expect(mocks.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'acs',
          providerMessageId: 'provider-message-1',
          providerStatus: 'Delivered',
          processingStatus: 'PENDING',
          payloadFingerprintKeyId: '2026-07',
        }),
      })
    );
    const persisted = JSON.stringify(mocks.createMany.mock.calls);
    expect(persisted).not.toContain('private-recipient');
    expect(persisted).not.toContain('private-sender');
    expect(persisted).not.toContain('private provider detail');
    await expect(response.json()).resolves.toMatchObject({ accepted: 1 });
  });

  it('treats reordered exact replay as idempotent across HMAC key rotation', async () => {
    const original = deliveryEvent();
    const reordered = { ...original, data: { ...(original.data as object) } };
    configuration.activeFingerprintKeyId = '2026-06';
    try {
      expect((await POST(request([original]))).status).toBe(200);
      configuration.activeFingerprintKeyId = '2026-07';
      const response = await POST(request([reordered]));
      expect(response.status).toBe(200);
      expect(mocks.queryRaw).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({ duplicates: 1, conflicts: 0 });
    } finally {
      configuration.activeFingerprintKeyId = '2026-07';
    }
  });

  it('preserves first evidence and durably quarantines a conflicting replay', async () => {
    await POST(request([deliveryEvent()]));
    const originalFingerprint = stored!['payloadFingerprint'];
    const response = await POST(
      request([
        deliveryEvent({
          data: { ...(deliveryEvent().data as object), recipient: 'changed@example.com' },
        }),
      ])
    );
    expect(response.status).toBe(200);
    expect(stored!['payloadFingerprint']).toBe(originalFingerprint);
    expect(stored).toMatchObject({
      processingStatus: 'CONFLICT',
      conflictCount: 1,
      lastErrorCode: 'EVENT_ID_PAYLOAD_CONFLICT',
    });
  });

  it('durably increments every conflicting delivery observation', async () => {
    await POST(request([deliveryEvent()]));
    const firstConflict = deliveryEvent({
      data: { ...(deliveryEvent().data as object), recipient: 'changed-1@example.com' },
    });
    const secondConflict = deliveryEvent({
      data: { ...(deliveryEvent().data as object), recipient: 'changed-2@example.com' },
    });
    expect((await POST(request([firstConflict]))).status).toBe(200);
    expect((await POST(request([secondConflict]))).status).toBe(200);
    expect(stored).toMatchObject({ processingStatus: 'CONFLICT', conflictCount: 2 });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it('quarantines authenticated evidence with missing correlation fields', async () => {
    const event = deliveryEvent();
    delete (event.data as Record<string, unknown>)['messageId'];
    const response = await POST(request([event]));
    expect(response.status).toBe(200);
    expect(mocks.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerMessageId: null,
          processingStatus: 'QUARANTINED',
          lastErrorCode: 'PROVIDER_MESSAGE_ID_MISSING',
          quarantineReasonCodes: ['PROVIDER_MESSAGE_ID_MISSING'],
        }),
      })
    );
  });

  it('preserves every simultaneous non-PII quarantine reason', async () => {
    const event = deliveryEvent({ dataVersion: '2.0', metadataVersion: '2' });
    delete (event.data as Record<string, unknown>)['messageId'];
    (event.data as Record<string, unknown>)['status'] = 'FuturePrivateStatus';
    const response = await POST(request([event]));
    expect(response.status).toBe(200);
    expect(mocks.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerStatus: null,
          quarantineReasonCodes: [
            'PROVIDER_MESSAGE_ID_MISSING',
            'PROVIDER_STATUS_UNSUPPORTED',
            'EVENT_GRID_VERSION_UNSUPPORTED',
          ],
        }),
      })
    );
  });

  it('quarantines an unknown future status without persisting its value', async () => {
    const event = deliveryEvent();
    (event.data as Record<string, unknown>)['status'] = 'FuturePrivateStatus';
    const response = await POST(request([event]));
    expect(response.status).toBe(200);
    expect(mocks.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerStatus: null,
          processingStatus: 'QUARANTINED',
          lastErrorCode: 'PROVIDER_STATUS_UNSUPPORTED',
        }),
      })
    );
  });

  it('rejects conflicting documented delivery timestamp aliases atomically', async () => {
    const event = deliveryEvent();
    (event.data as Record<string, unknown>)['deliveryAttemptTimestamp'] =
      '2026-07-31T02:58:59.000Z';
    const response = await POST(request([event]));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects notification batching even when every event is otherwise valid', async () => {
    const response = await POST(request([deliveryEvent(), deliveryEvent({ id: 'event-2' })]));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does not include sensitive event fields in structured logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const response = await POST(request([deliveryEvent()]));
      expect(response.status).toBe(200);
      const logs = JSON.stringify(logSpy.mock.calls);
      expect(logs).not.toContain('private-recipient');
      expect(logs).not.toContain('private-sender');
      expect(logs).not.toContain('private provider detail');
      expect(logs).not.toContain('provider-message-1');
      expect(logs).not.toContain('Bearer');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('rejects a topic outside the exact subscription-topic pair', async () => {
    const response = await POST(request([deliveryEvent({ topic: `${topic}-other` })]));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns retryable 503 when the inbox transaction is unavailable', async () => {
    mocks.transaction.mockRejectedValue(new Error('database unavailable'));
    const response = await POST(request([deliveryEvent()]));
    expect(response.status).toBe(503);
  });

  it('authenticates before enforcing the declared body limit', async () => {
    const response = await POST(
      request([deliveryEvent()], { 'content-length': String(256 * 1024 + 1) })
    );
    expect(response.status).toBe(413);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
