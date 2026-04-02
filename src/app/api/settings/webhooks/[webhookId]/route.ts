/**
 * Single Webhook API (F053)
 *
 * GET    /api/settings/webhooks/:webhookId - Get webhook detail
 * PATCH  /api/settings/webhooks/:webhookId - Update webhook
 * DELETE /api/settings/webhooks/:webhookId - Delete webhook
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ webhookId: string }>;
}

/**
 * GET /api/settings/webhooks/:webhookId
 * Get single webhook detail (secret is NOT returned)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { webhookId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const webhook = await withOrgContext(session.organizationId, async (tx) => {
      return tx.webhook.findFirst({
        where: {
          id: webhookId,
          organizationId: session.organizationId,
        },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          url: true,
          description: true,
          eventTypes: true,
          roomId: true,
          isActive: true,
          lastTriggeredAt: true,
          failureCount: true,
          room: {
            select: { id: true, name: true },
          },
        },
      });
    });

    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    return NextResponse.json({ webhook });
  } catch (error) {
    console.error('[WebhookAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get webhook' }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/webhooks/:webhookId
 * Update webhook properties
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { webhookId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { url, description, eventTypes, roomId, isActive } = body;

    // Validate URL if provided
    if (url !== undefined) {
      if (!url || typeof url !== 'string') {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
      }
      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          return NextResponse.json(
            { error: 'URL must use HTTP or HTTPS protocol' },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
      }
      if (url.length > 500) {
        return NextResponse.json({ error: 'URL must be 500 characters or less' }, { status: 400 });
      }
    }

    if (eventTypes !== undefined && !Array.isArray(eventTypes)) {
      return NextResponse.json({ error: 'eventTypes must be an array' }, { status: 400 });
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description === 'string' &&
      description.length > 255
    ) {
      return NextResponse.json(
        { error: 'Description must be 255 characters or less' },
        { status: 400 }
      );
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify webhook exists and belongs to org
      const existing = await tx.webhook.findFirst({
        where: {
          id: webhookId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Webhook not found', status: 404 };
      }

      // If roomId provided, verify it belongs to this org
      if (roomId !== undefined && roomId !== null) {
        const room = await tx.room.findFirst({
          where: {
            id: roomId,
            organizationId: session.organizationId,
          },
        });
        if (!room) {
          return { error: 'Room not found', status: 404 };
        }
      }

      const webhook = await tx.webhook.update({
        where: { id: webhookId },
        data: {
          ...(url !== undefined && { url }),
          ...(description !== undefined && { description: description || null }),
          ...(eventTypes !== undefined && { eventTypes }),
          ...(roomId !== undefined && { roomId: roomId || null }),
          ...(isActive !== undefined && { isActive }),
          // Reset failure count when re-enabling
          ...(isActive === true && { failureCount: 0 }),
        },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          url: true,
          description: true,
          eventTypes: true,
          roomId: true,
          isActive: true,
          lastTriggeredAt: true,
          failureCount: true,
          room: {
            select: { id: true, name: true },
          },
        },
      });

      return { webhook };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ webhook: result.webhook });
  } catch (error) {
    console.error('[WebhookAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 });
  }
}

/**
 * DELETE /api/settings/webhooks/:webhookId
 * Remove a webhook
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { webhookId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const existing = await tx.webhook.findFirst({
        where: {
          id: webhookId,
          organizationId: session.organizationId,
        },
      });

      if (!existing) {
        return { error: 'Webhook not found', status: 404 };
      }

      await tx.webhook.delete({
        where: { id: webhookId },
      });

      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[WebhookAPI] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
  }
}
