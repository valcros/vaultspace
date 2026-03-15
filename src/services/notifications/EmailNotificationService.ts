/**
 * Email Notification Service (F003)
 *
 * Sends email notifications for document events.
 * Called from API routes or background jobs after events occur.
 */

import type { EmailProvider } from '@/providers/types';
import { db } from '@/lib/db';

export interface NotificationConfig {
  emailProvider: EmailProvider;
  fromAddress: string;
  appUrl: string;
}

export interface DocumentViewedEvent {
  organizationId: string;
  roomId: string;
  documentId: string;
  viewerEmail?: string;
}

export interface DocumentUploadedEvent {
  organizationId: string;
  roomId: string;
  documentId: string;
  uploaderId?: string;
}

export interface AccessRevokedEvent {
  organizationId: string;
  roomId: string;
  targetUserId: string;
}

export interface InvitationEvent {
  email: string;
  inviterName: string;
  organizationName: string;
  role: string;
  invitationUrl: string;
  expiresAt: Date;
}

export class EmailNotificationService {
  private config: NotificationConfig;

  constructor(config: NotificationConfig) {
    this.config = config;
  }

  /**
   * Notify admins when a document is viewed
   */
  async notifyDocumentViewed(event: DocumentViewedEvent): Promise<void> {
    try {
      const adminsToNotify = await this.getAdminsForRoom(
        event.organizationId,
        event.roomId,
        'emailOnDocumentViewed'
      );

      if (adminsToNotify.length === 0) {
        return;
      }

      const document = await db.document.findFirst({
        where: {
          id: event.documentId,
          organizationId: event.organizationId,
        },
        select: { name: true },
      });

      if (!document) {
        return;
      }

      const viewerEmail = event.viewerEmail || 'Anonymous viewer';
      const viewTime = new Date().toLocaleString();

      for (const admin of adminsToNotify) {
        await this.sendEmail({
          to: admin.email,
          subject: 'Document Viewed: ' + document.name,
          html: this.buildDocumentViewedEmail({
            recipientName: admin.name,
            documentName: document.name,
            viewerEmail,
            viewTime,
            roomUrl: this.config.appUrl + '/rooms/' + event.roomId,
          }),
        });
      }
    } catch (error) {
      console.error('[EmailNotification] Document viewed notification error:', error);
    }
  }

  /**
   * Notify admins when a document is uploaded
   */
  async notifyDocumentUploaded(event: DocumentUploadedEvent): Promise<void> {
    try {
      const adminsToNotify = await this.getAdminsForRoom(
        event.organizationId,
        event.roomId,
        'emailOnDocumentUploaded'
      );

      if (adminsToNotify.length === 0) {
        return;
      }

      const document = await db.document.findFirst({
        where: {
          id: event.documentId,
          organizationId: event.organizationId,
        },
        select: {
          name: true,
          fileSize: true,
          mimeType: true,
        },
      });

      if (!document) {
        return;
      }

      // Get uploader info if available
      let uploaderName = 'Unknown user';
      if (event.uploaderId) {
        const uploader = await db.user.findUnique({
          where: { id: event.uploaderId },
          select: { firstName: true, lastName: true },
        });
        if (uploader) {
          uploaderName = ((uploader.firstName || '') + ' ' + (uploader.lastName || '')).trim() || 'Unknown user';
        }
      }

      const fileSize = this.formatFileSize(Number(document.fileSize));

      for (const admin of adminsToNotify) {
        await this.sendEmail({
          to: admin.email,
          subject: 'Document Uploaded: ' + document.name,
          html: this.buildDocumentUploadedEmail({
            recipientName: admin.name,
            documentName: document.name,
            uploaderName,
            fileSize,
            fileType: document.mimeType || 'Unknown',
            roomUrl: this.config.appUrl + '/rooms/' + event.roomId,
          }),
        });
      }
    } catch (error) {
      console.error('[EmailNotification] Document uploaded notification error:', error);
    }
  }

  /**
   * Notify user when their access is revoked
   */
  async notifyAccessRevoked(event: AccessRevokedEvent): Promise<void> {
    try {
      const user = await db.user.findUnique({
        where: { id: event.targetUserId },
        select: { email: true, firstName: true },
      });

      const room = await db.room.findFirst({
        where: { id: event.roomId, organizationId: event.organizationId },
        select: { name: true },
      });

      if (!user || !room) {
        return;
      }

      // Check user's notification preferences
      const userOrg = await db.userOrganization.findFirst({
        where: {
          userId: event.targetUserId,
          organizationId: event.organizationId,
        },
      });

      if (userOrg) {
        const prefs = await db.notificationPreference.findUnique({
          where: { userOrganizationId: userOrg.id },
        });

        if (prefs && !prefs.emailOnAccessRevoked) {
          return;
        }
      }

      await this.sendEmail({
        to: user.email,
        subject: 'Access Revoked: ' + room.name,
        html: this.buildAccessRevokedEmail({
          recipientName: user.firstName || 'User',
          roomName: room.name,
        }),
      });
    } catch (error) {
      console.error('[EmailNotification] Access revoked notification error:', error);
    }
  }

  /**
   * Send team member invitation email
   */
  async sendInvitationEmail(event: InvitationEvent): Promise<void> {
    try {
      const expiryDate = event.expiresAt.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      await this.sendEmail({
        to: event.email,
        subject: 'Invitation to join ' + event.organizationName + ' on VaultSpace',
        html: this.buildInvitationEmail({
          inviterName: event.inviterName,
          organizationName: event.organizationName,
          role: event.role,
          invitationUrl: event.invitationUrl,
          expiryDate,
        }),
      });
    } catch (error) {
      console.error('[EmailNotification] Invitation email error:', error);
      throw error; // Re-throw so caller knows the email failed
    }
  }

  /**
   * Get admins for a room who have the specified notification enabled
   */
  private async getAdminsForRoom(
    organizationId: string,
    roomId: string,
    preferenceField: 'emailOnDocumentViewed' | 'emailOnDocumentUploaded'
  ): Promise<Array<{ email: string; name: string }>> {
    // Get organization admins
    const orgAdmins = await db.userOrganization.findMany({
      where: {
        organizationId,
        role: 'ADMIN',
        isActive: true,
      },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    // Get room-level admins
    const roomAdmins = await db.roleAssignment.findMany({
      where: { organizationId, roomId, role: 'ADMIN', scopeType: 'ROOM' },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    const adminMap = new Map<string, { email: string; name: string }>();

    // Process org admins
    for (const oa of orgAdmins) {
      const prefs = await db.notificationPreference.findUnique({
        where: { userOrganizationId: oa.id },
      });
      const prefEnabled = prefs?.[preferenceField] ?? true;
      if (prefEnabled) {
        const name = ((oa.user.firstName || '') + ' ' + (oa.user.lastName || '')).trim() || 'Admin';
        adminMap.set(oa.user.id, { email: oa.user.email, name });
      }
    }

    // Process room admins (only if not already in map)
    for (const ra of roomAdmins) {
      if (!adminMap.has(ra.user.id)) {
        const userOrg = await db.userOrganization.findFirst({
          where: { userId: ra.user.id, organizationId },
        });
        if (userOrg) {
          const prefs = await db.notificationPreference.findUnique({
            where: { userOrganizationId: userOrg.id },
          });
          const prefEnabled = prefs?.[preferenceField] ?? true;
          if (prefEnabled) {
            const name = ((ra.user.firstName || '') + ' ' + (ra.user.lastName || '')).trim() || 'Admin';
            adminMap.set(ra.user.id, { email: ra.user.email, name });
          }
        }
      }
    }

    return Array.from(adminMap.values());
  }

  /**
   * Send email via provider
   * Note: from address is configured at provider level
   */
  private async sendEmail(options: { to: string; subject: string; html: string }): Promise<void> {
    await this.config.emailProvider.sendEmail({
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
  }

  /**
   * Build document viewed email HTML
   */
  private buildDocumentViewedEmail(data: {
    recipientName: string;
    documentName: string;
    viewerEmail: string;
    viewTime: string;
    roomUrl: string;
  }): string {
    return [
      '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">',
      '<h2 style="color: #1e293b;">Document Viewed</h2>',
      '<p>Hello ' + data.recipientName + ',</p>',
      '<p>A document in your data room has been viewed:</p>',
      '<div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">',
      '<p style="margin: 0;"><strong>Document:</strong> ' + data.documentName + '</p>',
      '<p style="margin: 8px 0 0;"><strong>Viewer:</strong> ' + data.viewerEmail + '</p>',
      '<p style="margin: 8px 0 0;"><strong>Time:</strong> ' + data.viewTime + '</p>',
      '</div>',
      '<p><a href="' + data.roomUrl + '" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Room</a></p>',
      '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />',
      '<p style="color: #64748b; font-size: 12px;">Manage notification preferences in account settings.</p>',
      '</div>',
    ].join('\n');
  }

  /**
   * Build document uploaded email HTML
   */
  private buildDocumentUploadedEmail(data: {
    recipientName: string;
    documentName: string;
    uploaderName: string;
    fileSize: string;
    fileType: string;
    roomUrl: string;
  }): string {
    return [
      '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">',
      '<h2 style="color: #1e293b;">Document Uploaded</h2>',
      '<p>Hello ' + data.recipientName + ',</p>',
      '<p>A new document has been uploaded to your data room:</p>',
      '<div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">',
      '<p style="margin: 0;"><strong>Document:</strong> ' + data.documentName + '</p>',
      '<p style="margin: 8px 0 0;"><strong>Uploaded by:</strong> ' + data.uploaderName + '</p>',
      '<p style="margin: 8px 0 0;"><strong>Size:</strong> ' + data.fileSize + '</p>',
      '<p style="margin: 8px 0 0;"><strong>Type:</strong> ' + data.fileType + '</p>',
      '</div>',
      '<p><a href="' + data.roomUrl + '" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Room</a></p>',
      '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />',
      '<p style="color: #64748b; font-size: 12px;">Manage notification preferences in account settings.</p>',
      '</div>',
    ].join('\n');
  }

  /**
   * Build access revoked email HTML
   */
  private buildAccessRevokedEmail(data: { recipientName: string; roomName: string }): string {
    return [
      '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">',
      '<h2 style="color: #1e293b;">Access Revoked</h2>',
      '<p>Hello ' + data.recipientName + ',</p>',
      '<p>Your access to the following data room has been revoked:</p>',
      '<div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">',
      '<p style="margin: 0;"><strong>Room:</strong> ' + data.roomName + '</p>',
      '</div>',
      '<p>If you believe this is an error, please contact the room administrator.</p>',
      '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />',
      '<p style="color: #64748b; font-size: 12px;">Manage notification preferences in account settings.</p>',
      '</div>',
    ].join('\n');
  }

  /**
   * Build invitation email HTML
   */
  private buildInvitationEmail(data: {
    inviterName: string;
    organizationName: string;
    role: string;
    invitationUrl: string;
    expiryDate: string;
  }): string {
    return [
      '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">',
      '<h2 style="color: #1e293b;">You\'ve Been Invited to VaultSpace</h2>',
      '<p>' + data.inviterName + ' has invited you to join <strong>' + data.organizationName + '</strong> as a ' + data.role.toLowerCase() + '.</p>',
      '<p>VaultSpace is a secure virtual data room for sharing confidential documents.</p>',
      '<div style="margin: 24px 0;">',
      '<a href="' + data.invitationUrl + '" style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">Accept Invitation</a>',
      '</div>',
      '<p style="color: #64748b; font-size: 14px;">This invitation expires on ' + data.expiryDate + '.</p>',
      '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />',
      '<p style="color: #94a3b8; font-size: 12px;">If you did not expect this invitation, you can safely ignore this email.</p>',
      '</div>',
    ].join('\n');
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    if (bytes < 1024 * 1024 * 1024) {
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }
}
