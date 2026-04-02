/**
 * Public Access Request API (F027)
 *
 * POST /api/rooms/public/request-access - Submit an access request (no auth required)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';

// This route is public, no auth cookie needed but must be dynamic
export const dynamic = 'force-dynamic';

const requestAccessSchema = z.object({
  roomSlug: z.string().min(1).max(100),
  organizationSlug: z.string().min(1).max(100),
  email: z.string().email().max(255),
  name: z.string().max(255).optional(),
  reason: z.string().max(2000).optional(),
});

/**
 * POST /api/rooms/public/request-access
 * Submit an access request for a room (unauthenticated)
 *
 * PRE-RLS BOOTSTRAP: This is a public endpoint. It uses the global db client
 * to look up organization and room by slug, then creates the access request.
 * Only minimal fields are read from organization/room.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = requestAccessSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { roomSlug, organizationSlug, email, name, reason } = parsed.data;

    // PRE-RLS BOOTSTRAP: Look up org by slug (no org context yet)
    const organization = await db.organization.findFirst({
      where: {
        slug: organizationSlug,
        isActive: true,
      },
      select: { id: true, slug: true },
    });

    if (!organization) {
      // Return 404 to prevent existence disclosure
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Look up room by slug within the organization
    const room = await db.room.findFirst({
      where: {
        slug: roomSlug,
        organizationId: organization.id,
      },
      select: { id: true, status: true },
    });

    if (!room) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Only allow requests for ACTIVE rooms
    if (room.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'This room is not currently accepting access requests' },
        { status: 400 }
      );
    }

    // Check for existing pending request from the same email for this room
    const existingRequest = await db.accessRequest.findFirst({
      where: {
        roomId: room.id,
        organizationId: organization.id,
        requesterEmail: email.toLowerCase().trim(),
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      return NextResponse.json(
        { error: 'You already have a pending access request for this room' },
        { status: 409 }
      );
    }

    // Create the access request
    const accessRequest = await db.accessRequest.create({
      data: {
        organizationId: organization.id,
        roomId: room.id,
        requesterEmail: email.toLowerCase().trim(),
        requesterName: name?.trim() || null,
        reason: reason?.trim() || null,
      },
    });

    return NextResponse.json(
      {
        id: accessRequest.id,
        message: 'Access request submitted successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[AccessRequestPublicAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to submit access request' }, { status: 500 });
  }
}
