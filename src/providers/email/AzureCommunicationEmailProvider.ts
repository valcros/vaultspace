/**
 * Azure Communication Services Email Provider
 *
 * Sends emails using Azure Communication Services (ACS).
 */

import { EmailClient, KnownEmailSendStatus } from '@azure/communication-email';
import { createHash } from 'node:crypto';

import type { EmailOptions, EmailProvider } from '../types';
import { EmailDeliveryError, normalizeEmailError } from './errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DNS_UUID_NAMESPACE = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');

/**
 * ACS requires a UUID, while durable verification/reset flows use CUIDs.
 * Use UUIDv5 with a fixed namespace/name so retries keep the same wire ID.
 * Keep the original flow ID in application records and encryption contexts;
 * ACS's returned message ID remains the delivery-event correlation key.
 */
function azureOperationId(flowId: string): string {
  if (UUID_PATTERN.test(flowId)) {
    return flowId;
  }

  const bytes = createHash('sha1')
    .update(DNS_UUID_NAMESPACE)
    .update(`vaultspace.org/email/operation/${flowId}`, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface AzureCommunicationEmailConfig {
  connectionString: string;
  senderAddress: string;
}

export class AzureCommunicationEmailProvider implements EmailProvider {
  readonly providerName = 'acs' as const;
  private client: EmailClient;
  private senderAddress: string;

  constructor(config: AzureCommunicationEmailConfig) {
    this.client = new EmailClient(config.connectionString);
    this.senderAddress = config.senderAddress;
  }

  async sendEmail(options: EmailOptions): Promise<{ messageId: string }> {
    const toRecipients = Array.isArray(options.to)
      ? options.to.map((email) => ({ address: email }))
      : [{ address: options.to }];

    const message = {
      // Per-org sender override (a verified sender username on the ACS domain);
      // its display name is configured in ACS. Falls back to the global sender.
      senderAddress: options.from ?? this.senderAddress,
      content: {
        subject: options.subject,
        html: options.html,
        plainText: options.text,
      },
      recipients: {
        to: toRecipients,
      },
      replyTo: options.replyTo ? [{ address: options.replyTo }] : undefined,
      attachments: options.attachments?.map((att) => ({
        name: att.filename,
        contentType: att.contentType ?? 'application/octet-stream',
        contentInBase64: Buffer.isBuffer(att.content)
          ? att.content.toString('base64')
          : Buffer.from(att.content).toString('base64'),
      })),
    };

    try {
      const poller = options.operationId
        ? await this.client.beginSend(message, {
            operationId: azureOperationId(options.operationId),
          })
        : await this.client.beginSend(message);
      const result = await poller.pollUntilDone();

      if (result.status !== KnownEmailSendStatus.Succeeded) {
        throw new EmailDeliveryError({
          code: 'ACS_SEND_NOT_ACCEPTED',
          provider: 'acs',
          retryable: true,
        });
      }

      return { messageId: result.id };
    } catch (error) {
      throw normalizeEmailError(error, 'acs');
    }
  }
}
