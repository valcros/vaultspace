/**
 * Console Email Provider
 *
 * Development provider that logs emails to console instead of sending.
 */

/* eslint-disable no-console */
import type { EmailOptions, EmailProvider } from '../types';

export class ConsoleEmailProvider implements EmailProvider {
  async sendEmail(options: EmailOptions): Promise<{ messageId: string }> {
    const messageId = `console-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    console.log('\n========== EMAIL ==========');
    console.log(`Message ID: ${messageId}`);
    console.log(`To: ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
    console.log(`Subject: ${options.subject}`);
    if (options.replyTo) {
      console.log(`Reply-To: ${options.replyTo}`);
    }
    console.log('--- HTML Body ---');
    console.log(options.html);
    if (options.text) {
      console.log('--- Plain Text ---');
      console.log(options.text);
    }
    if (options.attachments?.length) {
      console.log(`Attachments: ${options.attachments.map((a) => a.filename).join(', ')}`);
    }
    console.log('==============================\n');

    return { messageId };
  }
}
