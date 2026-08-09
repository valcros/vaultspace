import { describe, expect, it } from 'vitest';

import type { EmailProvider } from '@/providers/types';

import { EmailNotificationService } from './EmailNotificationService';

// The four builders are pure (data -> html) and don't touch the provider/DB, so
// we can drive them directly. They receive user-controlled values (document /
// room / person / org names) that must be HTML-escaped before landing in another
// user's inbox (finding X2).
function makeService(): EmailNotificationService {
  return new EmailNotificationService({
    emailProvider: {} as EmailProvider,
    fromAddress: 'noreply@example.test',
    appUrl: 'https://example.test',
  });
}

const XSS = '<script>alert(1)</script>';
const IMG = '<img src=x onerror="alert(1)">';

function assertNeutralized(html: string) {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<img/i);
  expect(html).toContain('&lt;script&gt;');
}

describe('EmailNotificationService HTML builders — X2 escaping', () => {
  // Lead with the genuinely cross-user fields: a less-trusted user controls the
  // document name / uploader name, and these land in an ADMIN's notification inbox.
  it('escapes documentName + uploaderName in the document-uploaded email', () => {
    const html = (
      makeService() as never as {
        buildDocumentUploadedEmail: (d: Record<string, string>) => string;
      }
    ).buildDocumentUploadedEmail({
      recipientName: 'Admin',
      documentName: XSS,
      uploaderName: IMG,
      fileSize: '1 KB',
      fileType: 'application/pdf',
      roomUrl: 'https://example.test/rooms/abc?a=1&b=2',
    });
    assertNeutralized(html);
    // Legitimate link ampersands are HTML-encoded (clients decode them).
    expect(html).toContain('rooms/abc?a=1&amp;b=2');
  });

  it('escapes documentName in the document-viewed email', () => {
    const html = (
      makeService() as never as {
        buildDocumentViewedEmail: (d: Record<string, string>) => string;
      }
    ).buildDocumentViewedEmail({
      recipientName: 'Admin',
      documentName: XSS,
      viewerEmail: IMG,
      viewTime: 'now',
      roomUrl: 'https://example.test/rooms/abc',
    });
    assertNeutralized(html);
  });

  it('escapes roomName in the access-revoked email', () => {
    const html = (
      makeService() as never as {
        buildAccessRevokedEmail: (d: Record<string, string>) => string;
      }
    ).buildAccessRevokedEmail({ recipientName: 'User', roomName: XSS });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes inviterName + organizationName in the invitation email', () => {
    const html = (
      makeService() as never as {
        buildInvitationEmail: (d: Record<string, string>) => string;
      }
    ).buildInvitationEmail({
      inviterName: XSS,
      organizationName: IMG,
      role: 'VIEWER',
      invitationUrl: 'https://example.test/invite?t=x',
      expiryDate: '2026-01-01',
    });
    assertNeutralized(html);
  });
});
