/**
 * Azure Communication Services Email Provider
 *
 * Sends emails using Azure Communication Services (ACS).
 */

import { EmailClient, KnownEmailSendStatus } from '@azure/communication-email';

import type { EmailOptions, EmailProvider } from '../types';

export interface AzureCommunicationEmailConfig {
  connectionString: string;
  senderAddress: string;
}

export class AzureCommunicationEmailProvider implements EmailProvider {
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
      senderAddress: this.senderAddress,
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

    const poller = await this.client.beginSend(message);
    const result = await poller.pollUntilDone();

    if (result.status !== KnownEmailSendStatus.Succeeded) {
      throw new Error(`Email send failed with status: ${result.status}`);
    }

    return { messageId: result.id };
  }
}
