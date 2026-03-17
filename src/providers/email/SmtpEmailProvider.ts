/**
 * SMTP Email Provider
 *
 * Sends emails via SMTP using nodemailer.
 */

import nodemailer, { type Transporter } from 'nodemailer';

import type { EmailOptions, EmailProvider } from '../types';

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  password?: string;
  from: string;
}

export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter;
  private from: string;

  constructor(config: SmtpConfig) {
    this.from = config.from;

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? config.port === 465,
      auth:
        config.user && config.password
          ? {
              user: config.user,
              pass: config.password,
            }
          : undefined,
    });
  }

  async sendEmail(options: EmailOptions): Promise<{ messageId: string }> {
    const result = await this.transporter.sendMail({
      from: this.from,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    return { messageId: result.messageId };
  }

  /**
   * Verify SMTP connection
   */
  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}
