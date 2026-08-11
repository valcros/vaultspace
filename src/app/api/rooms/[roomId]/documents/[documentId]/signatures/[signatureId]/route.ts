/**
 * E-Signature Action API (F046-F050)
 *
 * PATCH /api/rooms/:roomId/documents/:documentId/signatures/:signatureId
 *   - Sign or decline a signature request
 *   - Accessible by admin or the designated signer (matched by session email)
 */

import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/lib/middleware';
import { db, withOrgContext } from '@/lib/db';
import { canViewerLinkAccessDocument, type LinkServeSession } from '@/lib/permissions/LinkPolicy';
import {
  getViewerSessionByToken,
  requireViewerSession,
  viewerSessionBaseSelect,
} from '@/lib/viewerSession';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string; signatureId: string }>;
}

/**
 * PATCH /api/rooms/:roomId/documents/:documentId/signatures/:signatureId
 * Sign or decline a signature request.
 * Body: { action: 'sign' | 'decline', signatureData?, signatureType?, declineReason? }
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { roomId, documentId, signatureId } = await context.params;
    const body = await request.json();
    const { action, signatureData, signatureType, declineReason } = body;

    // Validate action
    if (!action || !['sign', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'action must be "sign" or "decline"' }, { status: 400 });
    }

    if (action === 'sign') {
      if (!signatureData || typeof signatureData !== 'string') {
        return NextResponse.json(
          { error: 'signatureData is required when signing' },
          { status: 400 }
        );
      }
      if (!signatureType || !['drawn', 'typed', 'uploaded'].includes(signatureType)) {
        return NextResponse.json(
          { error: 'signatureType must be "drawn", "typed", or "uploaded"' },
          { status: 400 }
        );
      }
    }

    // Determine the caller identity: admin session or viewer session
    const adminSession = await getSession();
    let callerEmail: string | null = null;
    let organizationId: string | null = null;
    let isAdmin = false;
    let viewerLink: NonNullable<LinkServeSession['link']> | null = null;

    if (adminSession) {
      callerEmail = adminSession.user.email;
      organizationId = adminSession.organizationId;
      isAdmin = adminSession.organization.role === 'ADMIN';
    }

    // If no admin session, try to find the signature request to get org context,
    // then check viewer session
    if (!adminSession) {
      // Look up the signature request without RLS to get the org context
      const sigReq = await db.signatureRequest.findFirst({
        where: { id: signatureId, roomId, documentId },
        select: { organizationId: true, signerEmail: true },
      });

      if (!sigReq) {
        return NextResponse.json({ error: 'Signature request not found' }, { status: 404 });
      }

      organizationId = sigReq.organizationId;

      // Check for viewer session via cookies
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();

      // Try all viewer cookies to find a matching session
      const allCookies = cookieStore.getAll();
      for (const cookie of allCookies) {
        if (cookie.name.startsWith('viewer_') && cookie.value) {
          const shareToken = cookie.name.slice('viewer_'.length);
          if (!shareToken) {
            continue;
          }
          const viewerSession = await getViewerSessionByToken(cookie.value, {
            ...viewerSessionBaseSelect,
            visitorEmail: true,
          });
          const sessionResult = requireViewerSession(shareToken, viewerSession);
          if (
            'session' in sessionResult &&
            sessionResult.session.organizationId === sigReq.organizationId &&
            sessionResult.session.roomId === roomId &&
            sessionResult.session.visitorEmail
          ) {
            callerEmail = sessionResult.session.visitorEmail;
            viewerLink = sessionResult.session.link;
            break;
          }
        }
      }
    }

    if (!callerEmail || !organizationId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Get client IP for audit
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';

    const result = await withOrgContext(organizationId, async (tx) => {
      // Fetch the signature request
      const signatureRequest = await tx.signatureRequest.findFirst({
        where: {
          id: signatureId,
          documentId,
          roomId,
          organizationId,
        },
      });

      if (!signatureRequest) {
        return { error: 'Signature request not found', status: 404 };
      }

      if (!isAdmin && viewerLink) {
        const document = await tx.document.findFirst({
          where: {
            id: documentId,
            roomId,
            organizationId,
            status: 'ACTIVE',
          },
          select: { id: true, folderId: true },
        });
        const inScope =
          document && (await canViewerLinkAccessDocument(tx, viewerLink, roomId, document));
        if (!inScope) {
          return { error: 'Not authorized to act on this signature request', status: 403 };
        }
      }

      // Authorization: admin can always act, signer can act on their own request
      if (!isAdmin && signatureRequest.signerEmail !== callerEmail!.toLowerCase()) {
        return { error: 'Not authorized to act on this signature request', status: 403 };
      }

      // Check status - only PENDING requests can be acted on
      if (signatureRequest.status !== 'PENDING') {
        return {
          error: `Signature request is already ${signatureRequest.status.toLowerCase()}`,
          status: 409,
        };
      }

      // Check expiry
      if (signatureRequest.expiresAt && signatureRequest.expiresAt < new Date()) {
        await tx.signatureRequest.update({
          where: { id: signatureId },
          data: { status: 'EXPIRED' },
        });
        return { error: 'Signature request has expired', status: 410 };
      }

      // Perform the action
      if (action === 'sign') {
        const updated = await tx.signatureRequest.update({
          where: { id: signatureId },
          data: {
            status: 'SIGNED',
            signedAt: new Date(),
            signatureData,
            signatureType,
            signatureIp: ip,
          },
        });
        return { signatureRequest: updated };
      } else {
        const updated = await tx.signatureRequest.update({
          where: { id: signatureId },
          data: {
            status: 'DECLINED',
            declinedAt: new Date(),
            declineReason: declineReason?.trim() || null,
          },
        });
        return { signatureRequest: updated };
      }
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ signatureRequest: result.signatureRequest });
  } catch (error) {
    console.error('[SignatureAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update signature request' }, { status: 500 });
  }
}
