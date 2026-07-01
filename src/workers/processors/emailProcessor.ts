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
const EMAIL_TEMPLATES: Record<
  string,
  (data: Record<string, unknown>) => { subject: string; html: string; text?: string }
> = {
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
    subject: `Reset your ${data['organizationName'] || 'VaultSpace'} password`,
    html: `
      <h1>Password Reset Request</h1>
      <p>Hi ${data['userName'] || 'User'},</p>
      <p>You requested to reset your password. Click the link below to proceed:</p>
      <a href="${data['resetUrl']}">Reset Password</a>
      <p>This link expires in ${data['expiresIn'] || '1 hour'}.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `,
    text: `Reset your password at: ${data['resetUrl']}. This link expires in ${
      data['expiresIn'] || '1 hour'
    }.`,
  }),

  'room-digest': (data) => ({
    subject: `${titleCase(String(data['period'] || 'weekly'))} digest: ${data['roomName'] || 'Room'}`,
    html: buildRoomDigestEmail(data),
    text: buildRoomDigestText(data),
  }),

  welcome: (data) => ({
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

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function buildRoomDigestEmail(data: Record<string, unknown>): string {
  const summary = asRecord(data['summary']);
  const topDocuments = asRecordArray(data['topDocuments']);
  const recentQuestions = asRecordArray(data['recentQuestions']);
  const viewerActivity = asRecordArray(data['viewerActivity']);
  const roomUrl = escapeHtml(data['roomUrl']);

  const statRows = [
    ['Documents uploaded', summary['documentsUploaded']],
    ['Documents viewed', summary['documentsViewed']],
    ['Documents downloaded', summary['documentsDownloaded']],
    ['Unique viewers', summary['uniqueViewers']],
    ['Questions submitted', summary['questionsSubmitted']],
    ['Questions answered', summary['questionsAnswered']],
    ['New share links', summary['newShareLinks']],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding: 6px 0; color: #475569;">${label}</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(
          value ?? 0
        )}</td></tr>`
    )
    .join('');

  const topDocumentRows =
    topDocuments.length > 0
      ? topDocuments
          .map(
            (doc) =>
              `<li>${escapeHtml(doc['name'])}: ${escapeHtml(doc['views'] ?? 0)} views, ${escapeHtml(
                doc['downloads'] ?? 0
              )} downloads</li>`
          )
          .join('')
      : '<li>No document views or downloads in this period.</li>';

  const questionRows =
    recentQuestions.length > 0
      ? recentQuestions
          .map(
            (question) =>
              `<li>${escapeHtml(question['subject'])} (${escapeHtml(question['status'])})</li>`
          )
          .join('')
      : '<li>No questions in this period.</li>';

  const viewerRows =
    viewerActivity.length > 0
      ? viewerActivity
          .slice(0, 10)
          .map(
            (viewer) =>
              `<li>${escapeHtml(viewer['email'])}: ${escapeHtml(viewer['views'] ?? 0)} sessions</li>`
          )
          .join('')
      : '<li>No viewer sessions in this period.</li>';

  return [
    '<div style="font-family: sans-serif; max-width: 640px; margin: 0 auto;">',
    `<h2 style="color: #1e293b;">${titleCase(String(data['period'] || 'weekly'))} Room Digest</h2>`,
    `<p>Hello ${escapeHtml(data['recipientName'] || 'Admin')},</p>`,
    `<p>Activity summary for <strong>${escapeHtml(data['roomName'])}</strong>.</p>`,
    `<p style="color: #64748b;">${escapeHtml(data['from'])} through ${escapeHtml(data['to'])}</p>`,
    '<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">',
    statRows,
    '</table>',
    '<h3 style="color: #334155;">Top documents</h3>',
    `<ul>${topDocumentRows}</ul>`,
    '<h3 style="color: #334155;">Recent questions</h3>',
    `<ul>${questionRows}</ul>`,
    '<h3 style="color: #334155;">Viewer activity</h3>',
    `<ul>${viewerRows}</ul>`,
    roomUrl
      ? `<p><a href="${roomUrl}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Open Room</a></p>`
      : '',
    '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />',
    '<p style="color: #64748b; font-size: 12px;">Manage notification preferences in account settings.</p>',
    '</div>',
  ].join('\n');
}

function buildRoomDigestText(data: Record<string, unknown>): string {
  const summary = asRecord(data['summary']);
  return [
    `${titleCase(String(data['period'] || 'weekly'))} digest: ${data['roomName'] || 'Room'}`,
    `${data['from'] || ''} through ${data['to'] || ''}`,
    `Documents uploaded: ${summary['documentsUploaded'] ?? 0}`,
    `Documents viewed: ${summary['documentsViewed'] ?? 0}`,
    `Documents downloaded: ${summary['documentsDownloaded'] ?? 0}`,
    `Unique viewers: ${summary['uniqueViewers'] ?? 0}`,
    `Questions submitted: ${summary['questionsSubmitted'] ?? 0}`,
    `Questions answered: ${summary['questionsAnswered'] ?? 0}`,
    `New share links: ${summary['newShareLinks'] ?? 0}`,
    data['roomUrl'] ? `Open room: ${data['roomUrl']}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

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
  const appUrl = process.env['APP_URL'];
  if (!appUrl) {
    throw new Error('[EmailProcessor] APP_URL environment variable is required');
  }
  return new EmailNotificationService({
    emailProvider: providers.email,
    fromAddress: process.env['SMTP_FROM'] || 'noreply@vaultspace.local',
    appUrl,
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
