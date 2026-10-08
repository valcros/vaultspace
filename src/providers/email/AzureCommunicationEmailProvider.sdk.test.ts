import { EmailClient } from '@azure/communication-email';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AzureCommunicationEmailProvider } from './AzureCommunicationEmailProvider';

const connectionString =
  'endpoint=https://email-sdk-test.invalid/;accesskey=' + Buffer.alloc(32).toString('base64');
const message = {
  to: 'recipient@example.com',
  subject: 'Offline SDK regression',
  html: '<p>No email is sent by this test.</p>',
  text: 'No email is sent by this test.',
};

// Exercise the real SDK serializer. Only its HTTP transport is replaced, so
// invalid UUIDs cannot slip through a mocked beginSend as they did previously.
function offlineProvider() {
  const operationIds: Array<string | undefined> = [];
  const client = new EmailClient(connectionString, {
    retryOptions: { maxRetries: 0 },
    httpClient: {
      async sendRequest(request) {
        operationIds.push(request.headers.get('Operation-Id'));
        throw Object.assign(new Error('OFFLINE_TRANSPORT_GUARD'), { statusCode: 400 });
      },
    },
  });
  const realBeginSend = EmailClient.prototype.beginSend;
  vi.spyOn(EmailClient.prototype, 'beginSend').mockImplementation(function (body, options) {
    return realBeginSend.call(client, body, options);
  });
  const provider = new AzureCommunicationEmailProvider({
    connectionString,
    senderAddress: 'sender@example.com',
  });
  return { provider, operationIds };
}

afterEach(() => vi.restoreAllMocks());

describe('ACS operation IDs with the real Azure SDK', () => {
  it('serializes verification and reset CUIDs as stable, distinct UUIDv5 values', async () => {
    const { provider, operationIds } = offlineProvider();
    for (const operationId of [
      'cm123456789012345678901234',
      'cm123456789012345678901234',
      'cm987654321098765432109876',
    ]) {
      await expect(provider.sendEmail({ ...message, operationId })).rejects.toThrow(
        'EMAIL_HTTP_400'
      );
    }
    // Independently calculated RFC UUIDv5 vectors: DNS namespace, UTF-8 name
    // "vaultspace.org/email/operation/<flowId>". Changing these breaks retries.
    expect(operationIds).toEqual([
      '9fa80a43-bba0-5fbd-9aa6-09fd47329ed8',
      '9fa80a43-bba0-5fbd-9aa6-09fd47329ed8',
      'c922b32d-d577-506e-95f8-598442db1b98',
    ]);
  });

  it('preserves an existing UUID operation ID', async () => {
    const { provider, operationIds } = offlineProvider();
    const operationId = '8f4938eb-6fd6-4e96-b6ca-267c437952a8';
    await expect(provider.sendEmail({ ...message, operationId })).rejects.toThrow('EMAIL_HTTP_400');
    expect(operationIds).toEqual([operationId]);
  });

  it('omits the operation ID for ordinary email so ACS can generate it', async () => {
    const { provider, operationIds } = offlineProvider();
    await expect(provider.sendEmail(message)).rejects.toThrow('EMAIL_HTTP_400');
    expect(operationIds).toEqual([undefined]);
  });
});
