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
      from: 'brightside@vaultspace.org',
    });

    expect(mockBeginSend).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress: 'brightside@vaultspace.org',
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
    ).rejects.toThrow('Email send failed with status: Failed');
  });
});
