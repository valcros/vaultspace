/**
 * Notification Templates API (F029)
 *
 * GET   /api/settings/notification-templates - List all templates for org
 * PATCH /api/settings/notification-templates - Update a template by templateKey
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Default templates returned when org has no custom templates
const DEFAULT_TEMPLATES = [
  {
    templateKey: 'document_uploaded',
    subject: 'New document uploaded: {document_name}',
    bodyHtml:
      '<p>Hi {user_name},</p><p>A new document <strong>{document_name}</strong> has been uploaded to <strong>{room_name}</strong> in {org_name}.</p>',
    isActive: true,
  },
  {
    templateKey: 'question_submitted',
    subject: 'New question in {room_name}',
    bodyHtml:
      '<p>Hi {user_name},</p><p>A new question has been submitted in <strong>{room_name}</strong>:</p><blockquote>{question_text}</blockquote>',
    isActive: true,
  },
  {
    templateKey: 'access_approved',
    subject: 'Your access request has been approved',
    bodyHtml:
      '<p>Hi {user_name},</p><p>Your request to access <strong>{room_name}</strong> in {org_name} has been approved. You can now view the documents.</p>',
    isActive: true,
  },
  {
    templateKey: 'access_denied',
    subject: 'Access request update for {room_name}',
    bodyHtml:
      '<p>Hi {user_name},</p><p>Your request to access <strong>{room_name}</strong> in {org_name} has been reviewed and was not approved at this time.</p>',
    isActive: true,
  },
  {
    templateKey: 'link_accessed',
    subject: 'Share link accessed: {room_name}',
    bodyHtml:
      '<p>Hi {user_name},</p><p>Someone accessed a share link for <strong>{room_name}</strong> in {org_name}.</p><p>Viewer: {viewer_email}</p>',
    isActive: true,
  },
  {
    templateKey: 'nda_signed',
    subject: 'NDA signed for {room_name}',
    bodyHtml:
      '<p>Hi {user_name},</p><p>An NDA has been signed for <strong>{room_name}</strong> by {viewer_email}.</p>',
    isActive: true,
  },
];

/**
 * GET /api/settings/notification-templates
 * List all templates for org. If none exist, return defaults.
 */
export async function GET() {
  try {
    const session = await requireAuth();

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const templates = await withOrgContext(session.organizationId, async (tx) => {
      return tx.notificationTemplate.findMany({
        where: { organizationId: session.organizationId },
        orderBy: { templateKey: 'asc' },
      });
    });

    // If org has saved templates, merge with defaults (so new default templates appear)
    if (templates.length > 0) {
      const savedByKey = new Map(templates.map((t) => [t.templateKey, t]));
      const merged = DEFAULT_TEMPLATES.map((def) => {
        const saved = savedByKey.get(def.templateKey);
        if (saved) {
          return {
            templateKey: saved.templateKey,
            subject: saved.subject,
            bodyHtml: saved.bodyHtml,
            isActive: saved.isActive,
            isCustomized: true,
          };
        }
        return { ...def, isCustomized: false };
      });

      // Also include any org-specific templates not in defaults
      for (const t of templates) {
        if (!DEFAULT_TEMPLATES.find((d) => d.templateKey === t.templateKey)) {
          merged.push({
            templateKey: t.templateKey,
            subject: t.subject,
            bodyHtml: t.bodyHtml,
            isActive: t.isActive,
            isCustomized: true,
          });
        }
      }

      return NextResponse.json({ templates: merged });
    }

    // No saved templates - return defaults
    return NextResponse.json({
      templates: DEFAULT_TEMPLATES.map((t) => ({ ...t, isCustomized: false })),
    });
  } catch (error) {
    console.error('[NotificationTemplatesAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get notification templates' }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/notification-templates
 * Update a template by templateKey (upsert pattern)
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { templateKey, subject, bodyHtml, isActive } = body;

    if (!templateKey || typeof templateKey !== 'string') {
      return NextResponse.json({ error: 'templateKey is required' }, { status: 400 });
    }

    if (templateKey.length > 100) {
      return NextResponse.json(
        { error: 'templateKey must be 100 characters or less' },
        { status: 400 }
      );
    }

    // Build update data - only include fields that were provided
    const updateData: Record<string, unknown> = {};
    if (subject !== undefined) {
      if (typeof subject !== 'string' || subject.trim().length === 0) {
        return NextResponse.json({ error: 'Subject cannot be empty' }, { status: 400 });
      }
      updateData['subject'] = subject.trim();
    }
    if (bodyHtml !== undefined) {
      if (typeof bodyHtml !== 'string' || bodyHtml.trim().length === 0) {
        return NextResponse.json({ error: 'Body cannot be empty' }, { status: 400 });
      }
      updateData['bodyHtml'] = bodyHtml.trim();
    }
    if (isActive !== undefined) {
      updateData['isActive'] = Boolean(isActive);
    }

    // Find the default template for fallback values
    const defaultTemplate = DEFAULT_TEMPLATES.find((t) => t.templateKey === templateKey);

    // Upsert the template
    const template = await withOrgContext(session.organizationId, async (tx) => {
      return tx.notificationTemplate.upsert({
        where: {
          organizationId_templateKey: {
            organizationId: session.organizationId,
            templateKey,
          },
        },
        update: updateData,
        create: {
          organizationId: session.organizationId,
          templateKey,
          subject: (updateData['subject'] as string) || defaultTemplate?.subject || templateKey,
          bodyHtml: (updateData['bodyHtml'] as string) || defaultTemplate?.bodyHtml || '<p></p>',
          isActive: updateData['isActive'] !== undefined ? Boolean(updateData['isActive']) : true,
        },
      });
    });

    return NextResponse.json({
      template: {
        templateKey: template.templateKey,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        isActive: template.isActive,
        isCustomized: true,
      },
    });
  } catch (error) {
    console.error('[NotificationTemplatesAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update notification template' }, { status: 500 });
  }
}
