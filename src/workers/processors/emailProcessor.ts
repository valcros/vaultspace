/**
 * Email Job Processor
 *
 * Processes email sending jobs using the EmailProvider.
 * Also handles notification jobs for document events.
 */

import { Job } from 'bullmq';

import { getProviders } from '@/providers';
import { EmailNotificationService } from '@/services/notifications';

import type { EmailSendJobPayload, NotificationJobPayload } from '../types';

// Email templates - simplified for Phase 2
const EMAIL_TEMPLATES: Record<string, (data: Record<string, unknown>) => { subject: string; html: string; text?: string }> = {
  'room-invitation': (data) => ({
    subject: `You've been invited to ${data['roomName']}`,
    html: `
      <h1>You've been invited!</h1>
      <p>${data['inviterName']} has invited you to access the data room "${data['roomName']}".</p>
      <p>Click the link below to access the room:</p>
      <a href="${data['roomUrl']}">Access Room</a>
    `,
    text: `You've been invited to ${data['roomName']}. Visit: ${data['roomUrl']}`,
  }),

  'document-shared': (data) => ({
    subject: `${data['sharerName']} shared a document with you`,
    html: `
      <h1>Document Shared</h1>
      <p>${data['sharerName']} has shared "${data['documentName']}" with you.</p>
      <p>Click the link below to view the document:</p>
      <a href="${data['documentUrl']}">View Document</a>
    `,
    text: `${data['sharerName']} shared "${data['documentName']}". View it at: ${data['documentUrl']}`,
  }),

  'password-reset': (data) => ({
    subject: 'Reset your VaultSpace password',
    html: `
      <h1>Password Reset Request</h1>
      <p>You requested to reset your password. Click the link below to proceed:</p>
      <a href="${data['resetUrl']}">Reset Password</a>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `,
    text: `Reset your password at: ${data['resetUrl']}. This link expires in 1 hour.`,
  }),

  'welcome': (data) => ({
    subject: 'Welcome to VaultSpace',
    html: `
      <h1>Welcome to VaultSpace!</h1>
      <p>Hi ${data['userName']},</p>
      <p>Your account has been created successfully.</p>
      <p>Get started by exploring your dashboard:</p>
      <a href="${data['dashboardUrl']}">Go to Dashboard</a>
    `,
    text: `Welcome to VaultSpace, ${data['userName']}! Visit your dashboard: ${data['dashboardUrl']}`,
  }),
};

export async function processEmailJob(job: Job<EmailSendJobPayload>): Promise<void> {
  const { to, subject, template, data } = job.data;

  console.log(`[EmailProcessor] Sending email to ${Array.isArray(to) ? to.join(', ') : to}`);

  const providers = getProviders();

  try {
    let emailSubject = subject;
    let emailHtml = '';
    let emailText: string | undefined;

    // Use template if provided
    if (template && EMAIL_TEMPLATES[template]) {
      const rendered = EMAIL_TEMPLATES[template](data);
      emailSubject = rendered.subject;
      emailHtml = rendered.html;
      emailText = rendered.text;
    } else {
      // Fallback to raw HTML from data
      emailHtml = (data['html'] as string) || '';
      emailText = (data['text'] as string) || undefined;
    }

    // Send email
    const result = await providers.email.sendEmail({
      to,
      subject: emailSubject,
      html: emailHtml,
      text: emailText,
    });

    console.log(`[EmailProcessor] Email sent successfully: ${result.messageId}`);
  } catch (error) {
    console.error(`[EmailProcessor] Failed to send email:`, error);
    throw error;
  }
}

/**
 * Create notification service instance
 */
function createNotificationService(): EmailNotificationService {
  const providers = getProviders();
  return new EmailNotificationService({
    emailProvider: providers.email,
    fromAddress: process.env['SMTP_FROM'] || 'noreply@vaultspace.local',
    appUrl: process.env['APP_URL'] || 'http://localhost:3000',
  });
}

/**
 * Process document uploaded notification job
 */
export async function processDocumentUploadedNotification(
  job: Job<NotificationJobPayload>
): Promise<void> {
  const { organizationId, roomId, documentId, uploaderId } = job.data;
  console.log(`[EmailProcessor] Processing document upload notification for ${documentId}`);

  const notificationService = createNotificationService();
  await notificationService.notifyDocumentUploaded({
    organizationId,
    roomId,
    documentId,
    uploaderId,
  });

  console.log(`[EmailProcessor] Document upload notification sent for ${documentId}`);
}

/**
 * Process document viewed notification job
 */
export async function processDocumentViewedNotification(
  job: Job<NotificationJobPayload>
): Promise<void> {
  const { organizationId, roomId, documentId, viewerEmail } = job.data;
  console.log(`[EmailProcessor] Processing document view notification for ${documentId}`);

  const notificationService = createNotificationService();
  await notificationService.notifyDocumentViewed({
    organizationId,
    roomId,
    documentId,
    viewerEmail,
  });

  console.log(`[EmailProcessor] Document view notification sent for ${documentId}`);
}
