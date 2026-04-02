/**
 * E-Signature API (F046-F050)
 *
 * GET  /api/rooms/:roomId/documents/:documentId/signatures - List signature requests
 * POST /api/rooms/:roomId/documents/:documentId/signatures - Create signature request
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

/**
 * GET /api/rooms/:roomId/documents/:documentId/signatures
 * List signature requests for a document (admin only)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Admin-only endpoint
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Verify document exists
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      // Get all signature requests for this document
      const signatureRequests = await tx.signatureRequest.findMany({
        where: {
          documentId,
          roomId,
          organizationId: session.organizationId,
        },
        include: {
          requestedBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { signatureRequests };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ signatureRequests: result.signatureRequests });
  } catch (error) {
    console.error('[SignatureAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to list signature requests' }, { status: 500 });
  }
}

/**
 * POST /api/rooms/:roomId/documents/:documentId/signatures
 * Create a new signature request (admin only)
 * Body: { signerEmail, signerName?, expiresAt? }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    // Admin-only endpoint
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { signerEmail, signerName, expiresAt } = body;

    // Validate required fields
    if (!signerEmail || typeof signerEmail !== 'string') {
      return NextResponse.json({ error: 'signerEmail is required' }, { status: 400 });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(signerEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // Validate expiresAt if provided
    let expiresAtDate: Date | undefined;
    if (expiresAt) {
      expiresAtDate = new Date(expiresAt);
      if (isNaN(expiresAtDate.getTime())) {
        return NextResponse.json({ error: 'Invalid expiresAt date' }, { status: 400 });
      }
      if (expiresAtDate <= new Date()) {
        return NextResponse.json({ error: 'expiresAt must be in the future' }, { status: 400 });
      }
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      // Verify room access
      const room = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
        },
      });

      if (!room) {
        return { error: 'Room not found', status: 404 };
      }

      // Verify document exists
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          roomId,
          organizationId: session.organizationId,
        },
      });

      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      // Check for existing pending request for the same signer on this document
      const existingRequest = await tx.signatureRequest.findFirst({
        where: {
          documentId,
          signerEmail: signerEmail.toLowerCase().trim(),
          status: 'PENDING',
          organizationId: session.organizationId,
        },
      });

      if (existingRequest) {
        return { error: 'A pending signature request already exists for this signer', status: 409 };
      }

      // Create signature request
      const signatureRequest = await tx.signatureRequest.create({
        data: {
          organizationId: session.organizationId,
          roomId,
          documentId,
          requestedByUserId: session.userId,
          signerEmail: signerEmail.toLowerCase().trim(),
          signerName: signerName?.trim() || null,
          expiresAt: expiresAtDate || null,
        },
        include: {
          requestedBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      return { signatureRequest };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ signatureRequest: result.signatureRequest }, { status: 201 });
  } catch (error) {
    console.error('[SignatureAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to create signature request' }, { status: 500 });
  }
}
