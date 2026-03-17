# EMAIL_TEMPLATES.md - VaultSpace Email Template Specification

**Document Version:** 1.0
**Feature IDs:** F003 (Email notifications), F043 (Notification preferences), F044 (Team member invite), F059 (Email infrastructure)
**Last Updated:** 2026-03-14
**Status:** Implementation-Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Email Infrastructure](#email-infrastructure)
3. [Template Engine Setup](#template-engine-setup)
4. [Base Layout & Styling](#base-layout--styling)
5. [Template Catalog](#template-catalog)
6. [Global Template Variables](#global-template-variables)
7. [Notification Preferences](#notification-preferences)
8. [Email Sending Rules](#email-sending-rules)
9. [Email Preview Route](#email-preview-route)
10. [Testing & Console Provider](#testing--console-provider)
11. [React Email Component Examples](#react-email-component-examples)
12. [Cross-References](#cross-references)

---

## Overview

VaultSpace sends **10 transactional email templates** to users across authentication, invitations, document updates, access control, and expiry notifications. All emails are:

- **Event-driven:** triggered by EventBus events (F102) or API actions
- **Background-processed:** sent via `email.send` BullMQ job (see JOB_SPECS.md)
- **User-configurable:** notification preferences stored per user (F043)
- **Branded:** org logo, primary color, and custom sender name per organization
- **Responsive:** mobile-friendly HTML with plain-text fallback
- **Signed:** generated using React Email for security and consistency

### Stakeholder Decisions

- **Email Provider:** SMTP with console fallback for development
- **Template Engine:** React Email (JSX-based, renders to HTML + plain text)
- **Branding:** Logo URL and primary color (hex) customizable per organization
- **Sender:** Configurable via `SMTP_FROM` (global per deployment, format: `"Display Name <address>"` or plain address)

---

## Email Infrastructure

### EmailProvider Interface

All email sending goes through the `EmailProvider` interface, defined in `src/lib/providers/email.ts`:

```typescript
/**
 * EmailProvider interface abstracts all email sending.
 * Implementations: SmtpEmailProvider (default), ConsoleEmailProvider (dev only)
 */
export interface EmailProvider {
  /**
   * Send a single email. Matches ARCHITECTURE.md canonical interface.
   * @param request - SendEmailRequest object
   * @returns SendEmailResult with id, status, optional error
   */
  send(request: SendEmailRequest): Promise<SendEmailResult>;

  /**
   * Send template-based email (for notifications).
   * Template rendering happens before calling this method.
   */
  sendTemplate(
    to: string,
    templateId: string,
    data: Record<string, string>
  ): Promise<SendEmailResult>;

  /**
   * Verify email address (optional async validation).
   */
  verifyEmail(email: string): Promise<boolean>;
}

interface SendEmailRequest {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string; // Plain text body
  html?: string; // HTML body (rendered from template)
  replyTo?: string;
  attachments?: EmailAttachment[];
}

interface SendEmailResult {
  id: string;
  status: 'sent' | 'failed' | 'queued';
  error?: string;
}

interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}
```

### Default Implementation: SmtpEmailProvider

**File:** `src/lib/providers/email/smtp.ts`

Connects to SMTP server configured via environment variables:

```typescript
interface SmtpEmailProvider extends EmailProvider {
  // Initialization
  constructor(config: {
    host: string; // SMTP_HOST
    port: number; // SMTP_PORT
    tls: boolean; // SMTP_TLS (true for TLS/SSL)
    auth: {
      user: string; // SMTP_USER
      pass: string; // SMTP_PASSWORD
    };
    from: string; // SMTP_FROM (e.g., "VaultSpace Admin <noreply@example.com>")
  });
}
```

**Environment Variables:**

```bash
# SMTP Configuration (canonical names from DEPLOYMENT.md)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_TLS=true                       # Require TLS for SMTP. Set "false" only for unencrypted local servers.
SMTP_USER=noreply@example.com
SMTP_PASSWORD=<password>
SMTP_FROM=noreply@vaultspace.local # Sender address for all emails

# Email Signature Block (optional)
EMAIL_SUPPORT_EMAIL=support@example.com
EMAIL_UNSUBSCRIBE_URL=https://example.com/email/unsubscribe
```

### Development Implementation: ConsoleEmailProvider

**File:** `src/lib/providers/email/console.ts`

For development and testing, logs emails to stdout instead of sending:

```typescript
export class ConsoleEmailProvider implements EmailProvider {
  async send(
    to: string,
    subject: string,
    htmlContent: string,
    plainTextContent: string,
    organizationId: string
  ): Promise<{ messageId: string }> {
    const messageId = generateUUID();

    console.log(`
════════════════════════════════════════════════════════════════
📧 EMAIL SENT (Development - Not Actually Sent)
════════════════════════════════════════════════════════════════
To:               ${to}
Subject:          ${subject}
Organization ID:  ${organizationId}
Message ID:       ${messageId}
────────────────────────────────────────────────────────────────
HTML Content:
${htmlContent}
────────────────────────────────────────────────────────────────
Plain Text Content:
${plainTextContent}
════════════════════════════════════════════════════════════════
    `);

    return { messageId };
  }
}
```

**Selection:** Determined by `EMAIL_PROVIDER` environment variable:

```typescript
// In src/lib/providers/factory.ts
function createEmailProvider(providerType: string): EmailProvider {
  switch (providerType) {
    case 'console':
      return new ConsoleEmailProvider();
    case 'smtp':
    default:
      return new SmtpEmailProvider({
        host: process.env.SMTP_HOST!,
        port: parseInt(process.env.SMTP_PORT || '587'),
        tls: process.env.SMTP_TLS !== 'false',
        auth: {
          user: process.env.SMTP_USER!,
          pass: process.env.SMTP_PASSWORD!,
        },
        from: process.env.SMTP_FROM || 'noreply@vaultspace.local',
      });
  }
}
```

---

## Template Engine Setup

### React Email Integration

Templates are written as **React Email components** (JSX), which renders to clean HTML + plain text. This provides:

- **Type safety:** TypeScript props for all template variables
- **Reusability:** shared layout components (header, footer, CTA button)
- **Testing:** easy to preview and validate
- **Maintainability:** single source of truth for layout and styling

**Installation:**

```bash
npm install react-email @react-email/components nodemailer
npm install -D @react-email/render
```

### Template Directory Structure

```
src/
  emails/
    base/
      Layout.tsx              # Shared HTML email wrapper
      Button.tsx              # Styled CTA button component
      Footer.tsx              # Organization footer with unsubscribe link
    templates/
      Welcome.tsx             # F-001: Welcome email
      EmailVerification.tsx    # F-002: Email verification
      PasswordReset.tsx        # F-003: Password reset link
      MagicLink.tsx            # F-004: Magic link login
      TeamInvitation.tsx       # F-005: Team member invitation
      DocumentUploaded.tsx     # F-006: New document notification
      DocumentUpdated.tsx      # F-007: Document version update
      RoomAccessGranted.tsx    # F-008: Access granted notification
      LinkAccessed.tsx         # F-009: Shared link accessed alert
      AccessExpiring.tsx       # F-010: Access expiry warning
    types.ts                   # Shared TypeScript interfaces for template props
```

### Base Layout Component

**File:** `src/emails/base/Layout.tsx`

```typescript
import React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Img,
  Section,
  Text,
  Link,
  Hr,
} from 'react-email';

export interface LayoutProps {
  children: React.ReactNode;
  orgName: string;
  orgLogo?: string;
  primaryColor?: string;
  footer?: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  orgName,
  orgLogo,
  primaryColor = '#3b82f6', // Tailwind blue-500 default
  footer,
}) => (
  <Html>
    <Head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>VaultSpace Notification</title>
      <style>{`
        * {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            "Helvetica Neue", Arial, sans-serif;
        }
        body {
          background-color: #f9fafb;
          padding: 20px 0;
        }
        .container {
          background-color: white;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          max-width: 600px;
          margin: 0 auto;
          overflow: hidden;
        }
        .header {
          background-color: ${primaryColor};
          padding: 20px;
          text-align: center;
        }
        .content {
          padding: 32px;
          color: #374151;
          line-height: 1.6;
        }
        .footer {
          background-color: #f3f4f6;
          padding: 16px 32px;
          font-size: 12px;
          color: #6b7280;
          border-top: 1px solid #e5e7eb;
        }
        a {
          color: ${primaryColor};
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        .button {
          display: inline-block;
          background-color: ${primaryColor};
          color: white;
          padding: 12px 24px;
          border-radius: 6px;
          font-weight: 600;
          text-decoration: none;
          margin: 20px 0;
        }
        .button:hover {
          opacity: 0.9;
        }
      `}</style>
    </Head>
    <Body>
      <Container>
        <Section className="header">
          {orgLogo && (
            <Img
              src={orgLogo}
              alt={orgName}
              height="40"
              style={{ marginBottom: '10px' }}
            />
          )}
          <Text style={{ color: 'white', margin: '0', fontSize: '18px' }}>
            {orgName}
          </Text>
        </Section>

        <Section className="content">{children}</Section>

        <Section className="footer">
          {footer || (
            <>
              <Text style={{ margin: '0 0 8px 0' }}>
                © {new Date().getFullYear()} {orgName}. All rights reserved.
              </Text>
              <Text style={{ margin: '0 0 4px 0' }}>
                Questions?{' '}
                <Link href="mailto:support@example.com">Contact support</Link>
              </Text>
              <Text style={{ margin: '0' }}>
                <Link href="{unsubscribeUrl}">Unsubscribe from these emails</Link>
              </Text>
            </>
          )}
        </Section>
      </Container>
    </Body>
  </Html>
);
```

### Button Component

**File:** `src/emails/base/Button.tsx`

```typescript
import React from 'react';
import { Button as EmailButton } from 'react-email';

export interface ButtonProps {
  href: string;
  label: string;
  primaryColor?: string;
}

export const Button: React.FC<ButtonProps> = ({
  href,
  label,
  primaryColor = '#3b82f6',
}) => (
  <EmailButton
    href={href}
    style={{
      display: 'inline-block',
      backgroundColor: primaryColor,
      color: 'white',
      padding: '12px 24px',
      borderRadius: '6px',
      fontWeight: '600',
      textDecoration: 'none',
      marginTop: '20px',
      marginBottom: '20px',
    }}
  >
    {label}
  </EmailButton>
);
```

### Types File

**File:** `src/emails/types.ts`

```typescript
/**
 * Global template context available to all email templates.
 * Populated from organization settings + user data.
 */
export interface EmailTemplateContext {
  // Organization branding
  appName: string; // "VaultSpace"
  appUrl: string; // "https://app.example.com"
  orgName: string; // Organization name
  orgLogo?: string; // Logo URL (HTTPS)
  primaryColor?: string; // Hex color (default: #3b82f6)

  // Recipient identity
  recipientName: string; // First name or full name
  recipientEmail: string; // Email address

  // System
  currentYear: number; // For copyright statements
  unsubscribeUrl?: string; // Personalized unsubscribe link
}

/**
 * Typed props for each email template.
 * Extends EmailTemplateContext for global variables.
 */
export interface WelcomeEmailProps extends EmailTemplateContext {
  verificationUrl: string;
}

export interface EmailVerificationProps extends EmailTemplateContext {
  verificationUrl: string;
  expiryMinutes: number;
}

export interface PasswordResetProps extends EmailTemplateContext {
  resetUrl: string;
  expiryHours: number;
}

export interface MagicLinkProps extends EmailTemplateContext {
  signInUrl: string;
  expiryMinutes: number;
}

export interface TeamInvitationProps extends EmailTemplateContext {
  inviterName: string;
  acceptInvitationUrl: string;
  expiryDays: number;
}

export interface DocumentUploadedProps extends EmailTemplateContext {
  roomName: string;
  documentName: string;
  viewUrl: string;
}

export interface DocumentUpdatedProps extends EmailTemplateContext {
  roomName: string;
  documentName: string;
  viewUrl: string;
  changesSummary?: string;
}

export interface RoomAccessGrantedProps extends EmailTemplateContext {
  roomName: string;
  openRoomUrl: string;
  accessLevel: 'view' | 'download' | 'admin';
}

export interface LinkAccessedProps extends EmailTemplateContext {
  roomName: string;
  visitorEmail: string;
  accessTime: string;
  viewerUrl?: string;
}

export interface AccessExpiringProps extends EmailTemplateContext {
  roomName: string;
  viewUrl: string;
  expiryTime: string;
}
```

---

## Base Layout & Styling

### HTML Email Best Practices

All templates follow responsive email standards:

1. **Inline CSS:** Critical styles are inlined; external stylesheets not supported by all clients
2. **Fallback fonts:** System fonts with sans-serif fallback
3. **Mobile-first:** 600px max-width container, flexible padding
4. **Accessible colors:** Text contrast >= 4.5:1
5. **Plain text:** Every HTML email includes a plain-text version (generated automatically by React Email)

### Responsive Width

```typescript
// All containers should use max-width: 600px for email clients
<Container style={{ maxWidth: '600px', margin: '0 auto' }}>
  {children}
</Container>
```

### Color Palette

- **Primary:** Customizable per organization (default: `#3b82f6` Tailwind blue-500)
- **Text:** Dark gray `#374151` for body, lighter `#6b7280` for secondary
- **Background:** White `#ffffff` for content, light gray `#f9fafb` for page
- **Accent:** Match primary color for CTAs and links

### Unsubscribe Footer

Every email includes a personalized unsubscribe link (for user configurable emails only). The link should point to:

```
GET /api/auth/unsubscribe?token={signedToken}&email={recipientEmail}&templateId={templateId}
```

---

## Template Catalog

All 10 MVP email templates below. Each includes trigger, variables, subject line, and React Email component structure.

### 1. Welcome Email

**Template ID:** `welcome`
**Feature ID:** F003, F016
**Trigger:** User completes registration (F004 creates user account)
**Recipient:** New user email address
**Subscribable:** Yes (users can disable in F043, but we recommend forcing)

**Subject Line:**

```
Welcome to {orgName} on VaultSpace
```

**Variables:**

```typescript
interface WelcomeEmailProps extends EmailTemplateContext {
  verificationUrl: string; // Email verification link
}
```

**Component:** `src/emails/templates/Welcome.tsx`

```typescript
import React from 'react';
import { Text, Link } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { WelcomeEmailProps } from '../types';

export const Welcome: React.FC<WelcomeEmailProps> = ({
  recipientName,
  orgName,
  orgLogo,
  primaryColor,
  verificationUrl,
  appUrl,
  currentYear,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      Welcome, {recipientName}!
    </Text>

    <Text style={{ margin: '16px 0' }}>
      You've been invited to collaborate on {orgName}'s secure data room on VaultSpace.
    </Text>

    <Text style={{ margin: '16px 0' }}>
      To get started, please verify your email address by clicking the button below:
    </Text>

    <Button
      href={verificationUrl}
      label="Verify Your Email"
      primaryColor={primaryColor}
    />

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      This link will expire in 24 hours. If you didn't create this account, please ignore this email.
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Once verified, you'll have immediate access to all shared documents and resources.
    </Text>
  </Layout>
);
```

**Plain Text Version:**

```
Welcome, {recipientName}!

You've been invited to collaborate on {orgName}'s secure data room on VaultSpace.

To get started, please verify your email address by visiting this link:
{verificationUrl}

This link will expire in 24 hours.

Once verified, you'll have immediate access to all shared documents and resources.

---
{orgName} | {appUrl}
```

---

### 2. Email Verification

**Template ID:** `email-verification`
**Feature ID:** F016
**Trigger:** User initiates email verification or re-verification (e.g., updated email address)
**Recipient:** Email address being verified
**Subscribable:** No (critical auth flow)

**Subject Line:**

```
Verify your email address
```

**Variables:**

```typescript
interface EmailVerificationProps extends EmailTemplateContext {
  verificationUrl: string;
  expiryMinutes: number; // Usually 24 hours = 1440 minutes
}
```

**Component:** `src/emails/templates/EmailVerification.tsx`

```typescript
import React from 'react';
import { Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { EmailVerificationProps } from '../types';

export const EmailVerification: React.FC<EmailVerificationProps> = ({
  recipientName,
  recipientEmail,
  orgName,
  orgLogo,
  primaryColor,
  verificationUrl,
  expiryMinutes,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      Verify Your Email Address
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Hi {recipientName},
    </Text>

    <Text style={{ margin: '16px 0' }}>
      We received a request to verify the email address <strong>{recipientEmail}</strong> for your VaultSpace account.
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Click the button below to verify this email address:
    </Text>

    <Button
      href={verificationUrl}
      label="Verify Email"
      primaryColor={primaryColor}
    />

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      This verification link expires in {expiryMinutes} minutes.
    </Text>

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      If you didn't request this verification, please ignore this email. Your email address won't be verified unless you click the link above.
    </Text>
  </Layout>
);
```

---

### 3. Password Reset

**Template ID:** `password-reset`
**Feature ID:** F016
**Trigger:** User requests password reset (forgot password)
**Recipient:** User email address
**Subscribable:** No (critical auth flow)

**Subject Line:**

```
Reset your password
```

**Variables:**

```typescript
interface PasswordResetProps extends EmailTemplateContext {
  resetUrl: string;
  expiryHours: number; // Usually 1 hour
}
```

**Component:** `src/emails/templates/PasswordReset.tsx`

```typescript
import React from 'react';
import { Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { PasswordResetProps } from '../types';

export const PasswordReset: React.FC<PasswordResetProps> = ({
  recipientName,
  orgName,
  orgLogo,
  primaryColor,
  resetUrl,
  expiryHours,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      Password Reset Request
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Hi {recipientName},
    </Text>

    <Text style={{ margin: '16px 0' }}>
      We received a request to reset the password for your VaultSpace account. Click the button below to create a new password:
    </Text>

    <Button
      href={resetUrl}
      label="Reset Password"
      primaryColor={primaryColor}
    />

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#dc2626' }}>
      <strong>Important:</strong> This link will only be valid for {expiryHours} hour(s). After that, you'll need to request a new password reset.
    </Text>

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      If you didn't request this password reset, please ignore this email. Your password will not be changed unless you click the link above.
    </Text>

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      For security reasons, never share this link with anyone.
    </Text>
  </Layout>
);
```

---

### 4. Magic Link (Passwordless Login)

**Template ID:** `magic-link`
**Feature ID:** F016
**Trigger:** User requests magic link login (or admin sends magic link for guest access)
**Recipient:** User email address
**Subscribable:** No (critical auth flow)

**Subject Line:**

```
Your login link for {orgName}
```

**Variables:**

```typescript
interface MagicLinkProps extends EmailTemplateContext {
  signInUrl: string;
  expiryMinutes: number; // Usually 15 minutes
}
```

**Component:** `src/emails/templates/MagicLink.tsx`

```typescript
import React from 'react';
import { Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { MagicLinkProps } from '../types';

export const MagicLink: React.FC<MagicLinkProps> = ({
  recipientName,
  orgName,
  orgLogo,
  primaryColor,
  signInUrl,
  expiryMinutes,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      Sign In to {orgName}
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Hi {recipientName},
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Click the button below to securely sign in to your {orgName} data room:
    </Text>

    <Button
      href={signInUrl}
      label="Sign In"
      primaryColor={primaryColor}
    />

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      This link expires in {expiryMinutes} minutes. If you didn't request this sign-in link, you can safely ignore this email.
    </Text>

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      Your sign-in link is unique to you. Do not share it with anyone.
    </Text>
  </Layout>
);
```

---

### 5. Team Invitation

**Template ID:** `team-invitation`
**Feature ID:** F044
**Trigger:** Admin invites team member (F044 creates invite record, EventBus emits `user.invited`)
**Recipient:** Invited user email address
**Subscribable:** No (critical business flow)

**Subject Line:**

```
{inviterName} invited you to {orgName}
```

**Variables:**

```typescript
interface TeamInvitationProps extends EmailTemplateContext {
  inviterName: string; // Name of admin who sent invitation
  acceptInvitationUrl: string; // Link to accept invitation
  expiryDays: number; // Invitation validity (usually 7 days)
}
```

**Component:** `src/emails/templates/TeamInvitation.tsx`

```typescript
import React from 'react';
import { Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { TeamInvitationProps } from '../types';

export const TeamInvitation: React.FC<TeamInvitationProps> = ({
  recipientName,
  recipientEmail,
  inviterName,
  orgName,
  orgLogo,
  primaryColor,
  acceptInvitationUrl,
  expiryDays,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      You're Invited to Join {orgName}
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Hi {recipientName},
    </Text>

    <Text style={{ margin: '16px 0' }}>
      <strong>{inviterName}</strong> has invited you to collaborate on {orgName}'s VaultSpace data room.
    </Text>

    <Text style={{ margin: '16px 0' }}>
      You'll be able to access shared documents, collaborate with team members, and participate in the secure data room.
    </Text>

    <Button
      href={acceptInvitationUrl}
      label="Accept Invitation"
      primaryColor={primaryColor}
    />

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      This invitation is valid for {expiryDays} days. After that, the link will expire and you'll need to request a new invitation.
    </Text>

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      If you don't recognize this invitation or believe you received it by mistake, please contact the team member who sent it.
    </Text>

    <Text style={{ margin: '16px 0' }}>
      <strong>Questions?</strong> Reply to this email or contact support at {recipientEmail}.
    </Text>
  </Layout>
);
```

---

### 6. Document Uploaded

**Template ID:** `document-uploaded`
**Feature ID:** F003, F121
**Trigger:** New document uploaded to a room (EventBus emits `document.uploaded`)
**Recipient:** Users with view access to room
**Subscribable:** Yes (F043)

**Subject Line:**

```
New document in {roomName}: {documentName}
```

**Variables:**

```typescript
interface DocumentUploadedProps extends EmailTemplateContext {
  roomName: string;
  documentName: string;
  viewUrl: string;
}
```

**Component:** `src/emails/templates/DocumentUploaded.tsx`

```typescript
import React from 'react';
import { Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { DocumentUploadedProps } from '../types';

export const DocumentUploaded: React.FC<DocumentUploadedProps> = ({
  recipientName,
  roomName,
  documentName,
  orgName,
  orgLogo,
  primaryColor,
  viewUrl,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      New Document Uploaded
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Hi {recipientName},
    </Text>

    <Text style={{ margin: '16px 0' }}>
      A new document has been added to the <strong>{roomName}</strong> data room:
    </Text>

    <Text style={{
      margin: '16px 0',
      padding: '12px 16px',
      backgroundColor: '#f3f4f6',
      borderLeft: `4px solid ${primaryColor}`,
      borderRadius: '4px',
    }}>
      <strong>{documentName}</strong>
    </Text>

    <Button
      href={viewUrl}
      label="View Document"
      primaryColor={primaryColor}
    />

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      You can now view and download this document from the {roomName} data room.
    </Text>
  </Layout>
);
```

---

### 7. Document Updated

**Template ID:** `document-updated`
**Feature ID:** F003, F121
**Trigger:** New version of document uploaded (EventBus emits `document.version.created`)
**Recipient:** Users with view access to document
**Subscribable:** Yes (F043)

**Subject Line:**

```
{documentName} was updated in {roomName}
```

**Variables:**

```typescript
interface DocumentUpdatedProps extends EmailTemplateContext {
  roomName: string;
  documentName: string;
  viewUrl: string;
  changesSummary?: string; // Optional: e.g., "Updated: Page 5"
}
```

**Component:** `src/emails/templates/DocumentUpdated.tsx`

```typescript
import React from 'react';
import { Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { DocumentUpdatedProps } from '../types';

export const DocumentUpdated: React.FC<DocumentUpdatedProps> = ({
  recipientName,
  roomName,
  documentName,
  orgName,
  orgLogo,
  primaryColor,
  viewUrl,
  changesSummary,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      Document Updated
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Hi {recipientName},
    </Text>

    <Text style={{ margin: '16px 0' }}>
      A document you have access to has been updated in the <strong>{roomName}</strong> data room:
    </Text>

    <Text style={{
      margin: '16px 0',
      padding: '12px 16px',
      backgroundColor: '#f3f4f6',
      borderLeft: `4px solid ${primaryColor}`,
      borderRadius: '4px',
    }}>
      <strong>{documentName}</strong>
      {changesSummary && <Text style={{ margin: '8px 0 0 0' }}>({changesSummary})</Text>}
    </Text>

    <Button
      href={viewUrl}
      label="View Changes"
      primaryColor={primaryColor}
    />

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      You can view the updated document and compare it with the previous version.
    </Text>
  </Layout>
);
```

---

### 8. Room Access Granted

**Template ID:** `room-access-granted`
**Feature ID:** F005, F019, F141
**Trigger:** User granted access to a room (EventBus emits `permission.granted`)
**Recipient:** User email address
**Subscribable:** Yes (F043)

**Subject Line:**

```
You now have access to {roomName}
```

**Variables:**

```typescript
interface RoomAccessGrantedProps extends EmailTemplateContext {
  roomName: string;
  openRoomUrl: string;
  accessLevel: 'view' | 'download' | 'admin'; // Indicates permission level
}
```

**Component:** `src/emails/templates/RoomAccessGranted.tsx`

```typescript
import React from 'react';
import { Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { RoomAccessGrantedProps } from '../types';

const accessLevelLabel = {
  view: 'View documents',
  download: 'Download documents',
  admin: 'Administer room',
};

export const RoomAccessGranted: React.FC<RoomAccessGrantedProps> = ({
  recipientName,
  roomName,
  orgName,
  orgLogo,
  primaryColor,
  openRoomUrl,
  accessLevel,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      Access Granted
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Hi {recipientName},
    </Text>

    <Text style={{ margin: '16px 0' }}>
      You now have access to <strong>{roomName}</strong>. Your permission level:
    </Text>

    <Text style={{
      margin: '16px 0',
      padding: '12px 16px',
      backgroundColor: '#f3f4f6',
      borderLeft: `4px solid ${primaryColor}`,
      borderRadius: '4px',
    }}>
      ✓ {accessLevelLabel[accessLevel]}
    </Text>

    <Button
      href={openRoomUrl}
      label="Open Room"
      primaryColor={primaryColor}
    />

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      Start exploring the documents and resources in the {roomName} data room now.
    </Text>
  </Layout>
);
```

---

### 9. Link Accessed (Admin Alert)

**Template ID:** `link-accessed`
**Feature ID:** F025, F121
**Trigger:** First access to a shared link (EventBus emits `link.accessed`); sent only to room admin
**Recipient:** Room admin email
**Subscribable:** Yes (F043) - but appears in admin activity digest, not standalone

**Subject Line:**

```
Someone accessed your shared link for {roomName}
```

**Variables:**

```typescript
interface LinkAccessedProps extends EmailTemplateContext {
  roomName: string;
  visitorEmail: string; // Email of person who accessed link (if provided)
  accessTime: string; // ISO timestamp of access
  viewerUrl?: string; // Link to view detailed analytics
}
```

**Component:** `src/emails/templates/LinkAccessed.tsx`

```typescript
import React from 'react';
import { Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { LinkAccessedProps } from '../types';

export const LinkAccessed: React.FC<LinkAccessedProps> = ({
  recipientName,
  roomName,
  visitorEmail,
  accessTime,
  orgName,
  orgLogo,
  primaryColor,
  viewerUrl,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      Shared Link Activity
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Hi {recipientName},
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Someone has accessed your shared link for <strong>{roomName}</strong>:
    </Text>

    <Text style={{
      margin: '16px 0',
      padding: '12px 16px',
      backgroundColor: '#f3f4f6',
      borderLeft: `4px solid ${primaryColor}`,
      borderRadius: '4px',
    }}>
      <Text style={{ margin: '0 0 8px 0' }}>
        <strong>Email:</strong> {visitorEmail}
      </Text>
      <Text style={{ margin: '0' }}>
        <strong>Accessed:</strong> {new Date(accessTime).toLocaleString()}
      </Text>
    </Text>

    {viewerUrl && (
      <Button
        href={viewerUrl}
        label="View Analytics"
        primaryColor={primaryColor}
      />
    )}

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      Monitor link access and engagement in the room analytics dashboard.
    </Text>
  </Layout>
);
```

---

### 10. Access Expiring Warning

**Template ID:** `access-expiring`
**Feature ID:** F022, F116
**Trigger:** Scheduled job checks expiry 24 hours before (EventBus emits `access.expiry.warning`)
**Recipient:** User about to lose access
**Subscribable:** No (critical security/business notification)

**Subject Line:**

```
Your access to {roomName} expires tomorrow
```

**Variables:**

```typescript
interface AccessExpiringProps extends EmailTemplateContext {
  roomName: string;
  viewUrl: string; // Link to room (if they want to act on it)
  expiryTime: string; // ISO timestamp of when access expires
}
```

**Component:** `src/emails/templates/AccessExpiring.tsx`

```typescript
import React from 'react';
import { Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { AccessExpiringProps } from '../types';

export const AccessExpiring: React.FC<AccessExpiringProps> = ({
  recipientName,
  roomName,
  orgName,
  orgLogo,
  primaryColor,
  viewUrl,
  expiryTime,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    <Text style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>
      Access Expiring Soon
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Hi {recipientName},
    </Text>

    <Text style={{ margin: '16px 0' }}>
      Your access to <strong>{roomName}</strong> will expire on:
    </Text>

    <Text style={{
      margin: '16px 0',
      padding: '12px 16px',
      backgroundColor: '#fef3c7',
      borderLeft: '4px solid #f59e0b',
      borderRadius: '4px',
    }}>
      <strong>{new Date(expiryTime).toLocaleString()}</strong>
    </Text>

    <Button
      href={viewUrl}
      label="View Room"
      primaryColor={primaryColor}
    />

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#6b7280' }}>
      If you need extended access, please contact the room administrator to request an extension or renewal.
    </Text>

    <Text style={{ margin: '16px 0', fontSize: '14px', color: '#dc2626' }}>
      <strong>After this date,</strong> you will no longer have access to the documents and resources in this room.
    </Text>
  </Layout>
);
```

---

## Global Template Variables

All templates have access to these **global variables**, populated from organization settings and user data:

```typescript
interface EmailTemplateContext {
  // App Identity
  appName: string; // Always "VaultSpace"
  appUrl: string; // e.g., "https://app.example.com"

  // Organization Branding
  orgName: string; // e.g., "Acme Inc."
  orgLogo?: string; // HTTPS URL to logo image
  primaryColor?: string; // Hex color, e.g., "#3b82f6" (default)

  // Recipient Identity
  recipientName: string; // First name or full name
  recipientEmail: string; // Email address (for unsubscribe)

  // System
  currentYear: number; // For copyright: new Date().getFullYear()
  unsubscribeUrl?: string; // Signed URL for safe unsubscribe
}
```

### Organization-Level Customization

Org logo and primary color stored in `Organization` table:

```prisma
model Organization {
  id                String @id @default(cuid())
  name              String
  logoUrl           String?        // URL to org logo (optional)
  primaryColor      String @default("#3b82f6")  // Hex color
  emailFromName     String?        // Org-specific sender name
  emailFrom         String?        // Org-specific sender email (override global)
  // ... other fields
}
```

**Loading in email service:**

```typescript
// In CoreService.ts email sending method
const org = await db.organization.findUnique({
  where: { id: organizationId },
  select: { name: true, logoUrl: true, primaryColor: true },
});

const context: EmailTemplateContext = {
  appName: 'VaultSpace',
  appUrl: process.env.APP_URL,
  orgName: org.name,
  orgLogo: org.logoUrl,
  primaryColor: org.primaryColor,
  recipientName: user.firstName || user.email,
  recipientEmail: user.email,
  currentYear: new Date().getFullYear(),
};
```

---

## Notification Preferences

### Feature F043: Notification Preferences

Users control which emails they receive. Stored in `UserNotificationPreference` table:

```prisma
model UserNotificationPreference {
  id                String    @id @default(cuid())
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  organizationId    String
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  // Template IDs that user wants to disable
  disabledTemplates String[]  @default([])  // e.g., ["document-uploaded", "link-accessed"]

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([userId, organizationId])
}
```

### Disableable vs. Non-Disableable

**Users CAN disable these emails (optional notifications):**

- `document-uploaded` - New document in room
- `document-updated` - Document version updated
- `link-accessed` - Shared link accessed (admin alert)

**Users CANNOT disable these emails (critical/required):**

- `welcome` - Initial onboarding
- `email-verification` - Email verification (auth)
- `password-reset` - Password reset (auth)
- `magic-link` - Magic link login (auth)
- `team-invitation` - Team invite (business)
- `room-access-granted` - Access grant notification (business)
- `access-expiring` - Access expiry warning (compliance/security)

### Admin-Level Defaults

Organization admins can set default notification preferences for new users:

```prisma
model Organization {
  // ... existing fields ...
  defaultNotificationPreferences String[] @default([])
  // Array of template IDs that are disabled by default for new users
}
```

### Checking Before Sending

Before sending an optional email, check user preferences:

```typescript
// In EmailService.sendDocumentUploaded()
async sendDocumentUploaded(
  userId: string,
  organizationId: string,
  roomName: string,
  documentName: string,
  viewUrl: string
): Promise<void> {
  // Check if user disabled this template
  const prefs = await db.userNotificationPreference.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });

  if (prefs?.disabledTemplates.includes('document-uploaded')) {
    return; // User opted out
  }

  // Send email
  const user = await db.user.findUnique({ where: { id: userId } });
  const props: DocumentUploadedProps = {
    // ... props
  };

  await this.send(user.email, 'document-uploaded', props);
}
```

---

## Email Sending Rules

### 1. Background Job Processing

**All emails sent via BullMQ job (not synchronously).**

```typescript
// In CoreService methods, emit email job, never send synchronously
await this.jobProvider.enqueue('normal', 'email.send', {
  templateId: 'document-uploaded',
  userId: userId,
  organizationId: organizationId,
  variables: {
    roomName,
    documentName,
    viewUrl,
  },
});

// Worker processes the job
// workers/general-worker.ts handles 'email.send' jobs
```

Job structure defined in JOB_SPECS.md:

```typescript
interface EmailSendJob {
  type: 'email.send';
  templateId: string; // "welcome", "document-uploaded", etc.
  userId: string; // Recipient user ID
  organizationId: string;
  variables: Record<string, any>; // Template-specific variables
}
```

### 2. Deduplication

Prevent email storms: same template + same recipient + same resource = throttle to **1 email per hour**.

```typescript
// In EmailService.send()
async send(
  templateId: string,
  userId: string,
  organizationId: string,
  resourceId?: string  // e.g., documentId, roomId
): Promise<void> {
  const cacheKey = `email:${templateId}:${userId}:${resourceId || 'global'}`;

  const recentlySent = await this.cacheProvider.get(cacheKey);
  if (recentlySent) {
    console.log(`Skipping email: recently sent. Key: ${cacheKey}`);
    return;
  }

  // Send email...
  await this.emailProvider.send(...);

  // Mark as sent (1 hour TTL)
  await this.cacheProvider.set(cacheKey, 'sent', 3600);
}
```

### 3. Batch Digest (Optional V1 Feature)

**Not required in MVP.** If more than 5 document notifications pending, batch into single digest email.

```typescript
// Pseudocode for V1 feature flag
if (pendingDocumentEmails > 5 && org.settings.enableDigestMode) {
  // Create single "Daily Digest" email with all 5+ documents
  // Send once per day instead of 5 separate emails
}
```

### 4. Quiet Hours (V1 Feature)

**Not in MVP.** In V1, respect user's timezone preference and don't send emails during sleep hours (e.g., 10 PM - 7 AM).

### 5. Email Retry Policy

Defined in JOB_SPECS.md for `email.send` jobs:

```typescript
// BullMQ queue configuration
{
  attempts: 3,                    // Retry up to 3 times
  backoff: {
    type: 'exponential',
    delay: 2000,                  // Start with 2s, double each retry
  },
  removeOnComplete: true,         // Clean up successful jobs
  removeOnFail: false,            // Keep failed jobs for debugging
}
```

---

## Email Preview Route

### Admin-Only Email Preview Endpoint

**Route:** `GET /api/admin/email-preview/:templateId`
**Auth:** Admin-only (verified via session/token)
**Purpose:** Render email template with sample data in browser

**Implementation:** `src/app/api/admin/email-preview/[templateId]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth';
import { renderAsync } from '@react-email/render';

// Sample data for each template
const templateSamples = {
  'welcome': {
    recipientName: 'John Doe',
    recipientEmail: 'john@example.com',
    orgName: 'Acme Inc.',
    orgLogo: 'https://example.com/logo.png',
    primaryColor: '#3b82f6',
    appName: 'VaultSpace',
    appUrl: 'https://app.example.com',
    currentYear: 2026,
    verificationUrl: 'https://app.example.com/verify/abc123',
  },
  'document-uploaded': {
    recipientName: 'Jane Smith',
    recipientEmail: 'jane@example.com',
    orgName: 'Acme Inc.',
    orgLogo: 'https://example.com/logo.png',
    primaryColor: '#3b82f6',
    appName: 'VaultSpace',
    appUrl: 'https://app.example.com',
    currentYear: 2026,
    roomName: 'Series A Funding',
    documentName: 'Cap Table v2.xlsx',
    viewUrl: 'https://app.example.com/rooms/abc123/documents/def456',
  },
  // ... other templates
};

export async function GET(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  // 1. Verify admin session
  const session = await requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { templateId } = params;
  const sampleData = templateSamples[templateId];

  if (!sampleData) {
    return NextResponse.json(
      { error: `Template not found: ${templateId}` },
      { status: 404 }
    );
  }

  // 2. Dynamically import template component
  const templateModule = await import(
    `@/emails/templates/${capitalize(camelCase(templateId))}`
  );
  const Template = templateModule.default;

  // 3. Render to HTML
  const html = await renderAsync(<Template {...sampleData} />);

  // 4. Return as HTML response
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
```

### Usage

Navigate to: `https://app.example.com/api/admin/email-preview/welcome`

Returns rendered HTML email in browser, making it easy to visually inspect templates.

---

## Testing & Console Provider

### Development Email Output

When `EMAIL_PROVIDER=console`, all emails logged to stdout with full formatting.

**Example output:**

```
════════════════════════════════════════════════════════════════
📧 EMAIL SENT (Development - Not Actually Sent)
════════════════════════════════════════════════════════════════
To:               john@example.com
Subject:          Welcome to Acme Inc. on VaultSpace
Organization ID:  org_abc123
Message ID:       msg_def456
────────────────────────────────────────────────────────────────
HTML Content:
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    ...
  </head>
  <body>
    ...
  </body>
</html>
────────────────────────────────────────────────────────────────
Plain Text Content:
Welcome, John!

You've been invited to collaborate on Acme Inc.'s secure data room.
...
════════════════════════════════════════════════════════════════
```

### Unit Tests for Email Templates

**File:** `src/emails/templates/__tests__/Welcome.test.tsx`

```typescript
import { render } from '@react-email/render';
import { Welcome } from '../Welcome';

describe('Welcome Template', () => {
  it('renders with all required props', async () => {
    const html = await render(
      <Welcome
        recipientName="Jane Doe"
        recipientEmail="jane@example.com"
        orgName="Test Org"
        appName="VaultSpace"
        appUrl="https://app.example.com"
        currentYear={2026}
        verificationUrl="https://app.example.com/verify/abc123"
      />
    );

    expect(html).toContain('Welcome, Jane Doe!');
    expect(html).toContain('Test Org');
    expect(html).toContain('https://app.example.com/verify/abc123');
  });

  it('uses org-provided logo when available', async () => {
    const html = await render(
      <Welcome
        recipientName="Jane"
        recipientEmail="jane@example.com"
        orgName="Test Org"
        orgLogo="https://example.com/logo.png"
        appName="VaultSpace"
        appUrl="https://app.example.com"
        currentYear={2026}
        verificationUrl="https://app.example.com/verify/abc123"
      />
    );

    expect(html).toContain('https://example.com/logo.png');
  });

  it('applies org primary color to buttons', async () => {
    const html = await render(
      <Welcome
        recipientName="Jane"
        recipientEmail="jane@example.com"
        orgName="Test Org"
        primaryColor="#ff0000"
        appName="VaultSpace"
        appUrl="https://app.example.com"
        currentYear={2026}
        verificationUrl="https://app.example.com/verify/abc123"
      />
    );

    expect(html).toContain('#ff0000');
  });
});
```

### Email Service Tests

**File:** `src/services/__tests__/email-service.test.ts`

```typescript
import { EmailService } from '../email-service';
import { ConsoleEmailProvider } from '@/lib/providers/email/console';

describe('EmailService', () => {
  let service: EmailService;
  let mockProvider: ConsoleEmailProvider;

  beforeEach(() => {
    mockProvider = new ConsoleEmailProvider();
    service = new EmailService(mockProvider);
  });

  it('respects notification preferences when sending optional emails', async () => {
    const userId = 'user_123';
    const orgId = 'org_123';

    // User disabled document-uploaded notifications
    await db.userNotificationPreference.create({
      data: {
        userId,
        organizationId: orgId,
        disabledTemplates: ['document-uploaded'],
      },
    });

    // Attempt to send document-uploaded email
    const spy = jest.spyOn(mockProvider, 'send');

    await service.sendDocumentUploaded(userId, orgId, 'Room', 'Doc', 'url');

    // Should not call provider
    expect(spy).not.toHaveBeenCalled();
  });

  it('deduplicates emails within 1 hour window', async () => {
    const userId = 'user_123';
    const orgId = 'org_123';
    const resourceId = 'doc_123';

    const spy = jest.spyOn(mockProvider, 'send');

    // First send
    await service.send('document-uploaded', userId, orgId, resourceId);
    expect(spy).toHaveBeenCalledTimes(1);

    // Second send (within 1 hour) should be skipped
    await service.send('document-uploaded', userId, orgId, resourceId);
    expect(spy).toHaveBeenCalledTimes(1); // Still 1, not 2

    // After cache expiry, should send again
    await cache.del(`email:document-uploaded:${userId}:${resourceId}`);
    await service.send('document-uploaded', userId, orgId, resourceId);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
```

---

## React Email Component Examples

### Full Example: Complete DocumentUploaded Template

**File:** `src/emails/templates/DocumentUploaded.tsx`

```typescript
import React from 'react';
import { Img, Link, Section, Text } from 'react-email';
import { Layout } from '../base/Layout';
import { Button } from '../base/Button';
import { DocumentUploadedProps } from '../types';

export const DocumentUploaded: React.FC<DocumentUploadedProps> = ({
  recipientName,
  roomName,
  documentName,
  viewUrl,
  orgName,
  orgLogo,
  primaryColor = '#3b82f6',
  appUrl,
  currentYear,
}) => (
  <Layout
    orgName={orgName}
    orgLogo={orgLogo}
    primaryColor={primaryColor}
  >
    {/* Heading */}
    <Text
      style={{
        fontSize: '24px',
        fontWeight: 'bold',
        margin: '0 0 16px 0',
        color: '#1f2937',
      }}
    >
      New Document Added
    </Text>

    {/* Greeting */}
    <Text style={{ fontSize: '16px', margin: '16px 0', color: '#374151' }}>
      Hi {recipientName},
    </Text>

    {/* Body */}
    <Text style={{ fontSize: '16px', margin: '16px 0', color: '#374151' }}>
      A new document has been uploaded to the{' '}
      <strong>{roomName}</strong> data room:
    </Text>

    {/* Document info box */}
    <Section
      style={{
        backgroundColor: '#f3f4f6',
        border: `2px solid ${primaryColor}`,
        borderRadius: '6px',
        padding: '16px',
        margin: '24px 0',
      }}
    >
      <Text style={{ margin: '0', fontWeight: 'bold', fontSize: '16px' }}>
        📄 {documentName}
      </Text>
    </Section>

    {/* CTA */}
    <Button
      href={viewUrl}
      label="View Document"
      primaryColor={primaryColor}
    />

    {/* Additional context */}
    <Text style={{ fontSize: '14px', margin: '16px 0', color: '#6b7280' }}>
      Start reviewing the documents in <strong>{roomName}</strong> now.
    </Text>

    {/* Help text */}
    <Text
      style={{
        fontSize: '12px',
        margin: '24px 0 0 0',
        color: '#9ca3af',
        fontStyle: 'italic',
      }}
    >
      If you'd prefer not to receive email notifications about document uploads,
      you can manage your preferences in your account settings.
    </Text>
  </Layout>
);

export default DocumentUploaded;
```

---

## Cross-References

- **F003** - Email notifications on document view/update
- **F016** - Email verification before access
- **F043** - Notification preferences per admin user
- **F044** - Team member invite and role assignment
- **F059** - Email infrastructure (this document)
- **F100** - Background job queue (JOB_SPECS.md)
- **F102** - Internal event bus (EVENT_MODEL.md)
- **F121** - Room activity summary dashboard
- **F141** - Centralized permission engine (PERMISSION_MODEL.md)

**Related Documents:**

- ARCHITECTURE.md - System design, provider pattern
- DEPLOYMENT.md - Environment variable configuration
- JOB_SPECS.md - Email.send job structure, retry policies
- PROVIDER_DEFAULTS.md - Provider implementations
- AUTH_AND_SESSIONS.md - User and session management

---

## Implementation Checklist

Before marking this spec as "complete," verify:

- [ ] EmailProvider interface defined with send(), sendTemplate(), verifyEmail() (matching ARCHITECTURE.md)
- [ ] SmtpEmailProvider implementation with SMTP configuration
- [ ] ConsoleEmailProvider implementation for development
- [ ] React Email templates created for all 10 email types
- [ ] Base Layout component with org logo and primary color
- [ ] Button component with customizable styling
- [ ] Email template types interface (TypeScript)
- [ ] Global variables injected into all templates
- [ ] User notification preferences table schema
- [ ] Email sending deduplication logic (1 hour per resource)
- [ ] email.send job handler in general-worker
- [ ] Email preview route (GET /api/admin/email-preview/:templateId)
- [ ] Console provider logs emails to stdout
- [ ] Unit tests for email templates
- [ ] Integration tests for EmailService
- [ ] ENV variables documented: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_TLS, SMTP_FROM
- [ ] Unsubscribe link generation and validation
- [ ] Audit trail of sent emails (optional: EventBus event emitted)

---

**Document Status:** Ready for implementation
**Last Review:** 2026-03-14
**Owner:** VaultSpace Core Team
