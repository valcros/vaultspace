import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPollUntilDone = vi.fn().mockResolvedValue({ status: 'Succeeded', id: 'message-1' });
const mockBeginSend = vi.fn().mockResolvedValue({ pollUntilDone: mockPollUntilDone });

vi.mock('@azure/communication-email', () => ({
  EmailClient: vi.fn().mockImplementation(() => ({
    beginSend: (...args: unknown[]) => mockBeginSend(...args),
  })),
  KnownEmailSendStatus: {
    Succeeded: 'Succeeded',
  },
}));

import { AzureCommunicationEmailProvider } from './AzureCommunicationEmailProvider';

describe('AzureCommunicationEmailProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPollUntilDone.mockResolvedValue({ status: 'Succeeded', id: 'message-1' });
    mockBeginSend.mockResolvedValue({ pollUntilDone: mockPollUntilDone });
  });

  it('passes the configured ACS sender address without display-name formatting', async () => {
    const provider = new AzureCommunicationEmailProvider({
      connectionString:
        'endpoint=https://acs-vaultspace-staging.unitedstates.communication.azure.com/;accesskey=test',
      senderAddress: 'noreply@vaultspace.org',
    });

    await provider.sendEmail({
      to: 'recipient@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
    });

    expect(mockBeginSend).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress: 'noreply@vaultspace.org',
      })
    );
  });

  it('overrides the sender address with a per-org `from` when provided', async () => {
    const provider = new AzureCommunicationEmailProvider({
      connectionString:
        'endpoint=https://acs-vaultspace-staging.unitedstates.communication.azure.com/;accesskey=test',
      senderAddress: 'noreply@vaultspace.org',
    });

    await provider.sendEmail({
      to: 'recipient@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      from: 'REDACTED@vaultspace.org',
    });

    expect(mockBeginSend).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress: 'REDACTED@vaultspace.org',
      })
    );
  });

  it('throws when ACS returns a non-succeeded send status', async () => {
    mockPollUntilDone.mockResolvedValue({ status: 'Failed', id: 'message-2' });
    const provider = new AzureCommunicationEmailProvider({
      connectionString:
        'endpoint=https://acs-vaultspace-staging.unitedstates.communication.azure.com/;accesskey=test',
      senderAddress: 'noreply@vaultspace.org',
    });

    await expect(
      provider.sendEmail({
        to: 'recipient@example.com',
        subject: 'Subject',
        html: '<p>Hello</p>',
      })
    ).rejects.toThrow('ACS_SEND_NOT_ACCEPTED');
  });

  it('uses the reset flow id as the ACS operation id for idempotent retries', async () => {
    const provider = new AzureCommunicationEmailProvider({
      connectionString:
        'endpoint=https://acs-vaultspace-staging.unitedstates.communication.azure.com/;accesskey=test',
      senderAddress: 'noreply@vaultspace.org',
    });

    await provider.sendEmail({
      to: 'recipient@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      operationId: '8f4938eb-6fd6-4e96-b6ca-267c437952a8',
    });

    expect(mockBeginSend).toHaveBeenCalledWith(expect.any(Object), {
      operationId: '8f4938eb-6fd6-4e96-b6ca-267c437952a8',
    });
  });
});
