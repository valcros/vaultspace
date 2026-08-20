/**
 * Email Verification delivery
 *
 * Builds and sends the verification link. Uses the default platform email
 * provider (a self-service registrant has no organization yet, so there is no
 * per-org sender). All interpolated values are HTML-escaped.
 */

import { getProviders } from '@/providers';
import { escapeHtml } from '@/lib/email/escapeHtml';

export class EmailVerificationDeliveryConfigurationError extends Error {
  readonly code = 'APP_URL_MISSING';
  constructor() {
    super('APP_URL is not configured');
    this.name = 'EmailVerificationDeliveryConfigurationError';
  }
}

export function buildEmailVerificationUrl(publicToken: string): string {
  const baseUrl = process.env['APP_URL'];
  if (!baseUrl || baseUrl.trim().length === 0) {
    throw new EmailVerificationDeliveryConfigurationError();
  }
  const url = new URL('/auth/verify-email', baseUrl);
  url.searchParams.set('token', publicToken);
  return url.toString();
}

export async function sendEmailVerificationEmail(params: {
  to: string;
  firstName: string;
  publicToken: string;
}): Promise<void> {
  const verifyUrl = buildEmailVerificationUrl(params.publicToken);
  const safeName = escapeHtml(params.firstName?.trim() || 'there');
  const safeUrl = escapeHtml(verifyUrl);

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #0f172a;">Verify your email</h2>
      <p style="color: #334155;">Hi ${safeName}, please confirm your email address to finish setting up your VaultSpace account.</p>
      <p style="margin: 24px 0;">
        <a href="${safeUrl}" style="background: #2563eb; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none;">Verify email</a>
      </p>
      <p style="color: #64748b; font-size: 13px;">This link expires in 24 hours. If you did not create a VaultSpace account, you can ignore this email.</p>
    </div>
  `.trim();

  await getProviders().email.sendEmail({
    to: params.to,
    subject: 'Verify your email for VaultSpace',
    html,
  });
}
