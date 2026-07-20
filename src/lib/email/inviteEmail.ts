/**
 * Viewer invitation email.
 *
 * Builds the subject + HTML body for an invitation to a data room, including the
 * inviter, an optional personal message, and the (email-gated) access link.
 */

export interface InviteEmailParams {
  roomName: string;
  inviterName: string;
  inviteeName?: string | null;
  message?: string | null;
  link: string;
  expiresAt?: Date | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInviteEmail(params: InviteEmailParams): { subject: string; html: string } {
  const { roomName, inviterName, inviteeName, message, link, expiresAt } = params;
  const greeting = inviteeName ? `Hello ${escapeHtml(inviteeName)},` : 'Hello,';
  const expiryLine = expiresAt
    ? `<p style="color:#6b7280;font-size:13px;">This invitation expires on ${expiresAt.toLocaleDateString(
        'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' }
      )}.</p>`
    : '';
  const messageBlock = message
    ? `<div style="margin:16px 0;padding:12px 16px;border-left:3px solid #2563eb;background:#f8fafc;color:#334155;font-size:14px;white-space:pre-wrap;">${escapeHtml(
        message
      )}</div>`
    : '';

  const subject = `You've been invited to ${roomName}`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1e;">
  <h2 style="font-size:18px;margin:0 0 4px;">${escapeHtml(roomName)}</h2>
  <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">Confidential data room access</p>
  <p style="font-size:14px;">${greeting}</p>
  <p style="font-size:14px;">${escapeHtml(
    inviterName
  )} has invited you to access this confidential data room.</p>
  ${messageBlock}
  <p style="margin:20px 0;">
    <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;">Open the data room</a>
  </p>
  <p style="color:#6b7280;font-size:12px;">Access is granted to your email address and is subject to a non-disclosure agreement on entry. Please do not forward this link.</p>
  ${expiryLine}
</div>`;

  return { subject, html };
}

/**
 * Reminder email for a still-unopened invitation. Same branding as the invite,
 * with a gentle nudge and the (unchanged) access link. Sent by the scheduled
 * invitation lifecycle job at 48h and again at 1 week after the invite.
 */
export function buildReminderEmail(params: InviteEmailParams): { subject: string; html: string } {
  const { roomName, inviterName, inviteeName, message, link, expiresAt } = params;
  const greeting = inviteeName ? `Hello ${escapeHtml(inviteeName)},` : 'Hello,';
  const expiryLine = expiresAt
    ? `<p style="color:#6b7280;font-size:13px;">This invitation expires on ${expiresAt.toLocaleDateString(
        'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' }
      )}. After that the link will stop working.</p>`
    : '';
  const messageBlock = message
    ? `<div style="margin:16px 0;padding:12px 16px;border-left:3px solid #2563eb;background:#f8fafc;color:#334155;font-size:14px;white-space:pre-wrap;">${escapeHtml(
        message
      )}</div>`
    : '';

  const subject = `Reminder: your invitation to ${roomName}`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1e;">
  <h2 style="font-size:18px;margin:0 0 4px;">${escapeHtml(roomName)}</h2>
  <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">Confidential data room access</p>
  <p style="font-size:14px;">${greeting}</p>
  <p style="font-size:14px;">This is a reminder that ${escapeHtml(
    inviterName
  )} invited you to access this confidential data room, and your invitation is still open.</p>
  ${messageBlock}
  <p style="margin:20px 0;">
    <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;">Open the data room</a>
  </p>
  <p style="color:#6b7280;font-size:12px;">Access is granted to your email address and is subject to a non-disclosure agreement on entry. Please do not forward this link.</p>
  ${expiryLine}
</div>`;

  return { subject, html };
}
