/**
 * Webhooks API (F053)
 *
 * GET  /api/settings/webhooks - List all webhooks for org
 * POST /api/settings/webhooks - Create a new webhook
 */

import { randomBytes } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

import { WEBHOOK_EVENT_TYPES } from '@/lib/constants/webhookEvents';

/**
 * GET /api/settings/webhooks
 * List all webhooks for the current organization
 */
export async function GET() {
  try {
    const session = await requireAuth();

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const webhooks = await withOrgContext(session.organizationId, async (tx) => {
      return tx.webhook.findMany({
        where: {
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
        orderBy: { createdAt: 'desc' },
      });
    });

    return NextResponse.json({
      webhooks,
      availableEventTypes: WEBHOOK_EVENT_TYPES,
    });
  } catch (error) {
    console.error('[WebhooksAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list webhooks' }, { status: 500 });
  }
}

/**
 * POST /api/settings/webhooks
 * Create a new webhook
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { url, description, eventTypes, roomId } = body;

    // Validate URL
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return NextResponse.json({ error: 'URL must use HTTP or HTTPS protocol' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    if (url.length > 500) {
      return NextResponse.json({ error: 'URL must be 500 characters or less' }, { status: 400 });
    }

    // Validate eventTypes
    if (eventTypes && !Array.isArray(eventTypes)) {
      return NextResponse.json({ error: 'eventTypes must be an array' }, { status: 400 });
    }

    // Validate description
    if (description && typeof description === 'string' && description.length > 255) {
      return NextResponse.json(
        { error: 'Description must be 255 characters or less' },
        { status: 400 }
      );
    }

    // Generate secret: 32 random bytes as hex (64 chars)
    const secret = randomBytes(32).toString('hex');

    const webhook = await withOrgContext(session.organizationId, async (tx) => {
      // If roomId provided, verify it belongs to this org
      if (roomId) {
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

      return tx.webhook.create({
        data: {
          organizationId: session.organizationId,
          url,
          secret,
          description: description || null,
          eventTypes: eventTypes || [],
          roomId: roomId || null,
        },
        select: {
          id: true,
          createdAt: true,
          url: true,
          secret: true, // Only returned on creation
          description: true,
          eventTypes: true,
          roomId: true,
          isActive: true,
          room: {
            select: { id: true, name: true },
          },
        },
      });
    });

    if ('error' in webhook) {
      return NextResponse.json({ error: webhook.error }, { status: webhook.status });
    }

    return NextResponse.json({ webhook }, { status: 201 });
  } catch (error) {
    console.error('[WebhooksAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
  }
}
