/**
 * Document Withdrawal API
 *
 * POST /api/rooms/:roomId/documents/:documentId/withdraw
 *
 * Withdraws a document (retires its accession number with a tombstone) or, with
 * { restore: true }, reverses the withdrawal. Distinct from delete (trash): a
 * withdrawn document stays in the room as a tombstone so its number still
 * resolves to "withdrawn".
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import { serializeBigInt } from '@/lib/serialization';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ roomId: string; documentId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { roomId, documentId } = await context.params;

    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const restore = body?.restore === true;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() || null : null;

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const document = await tx.document.findFirst({
        where: { id: documentId, roomId, organizationId: session.organizationId },
        select: { id: true },
      });
      if (!document) {
        return { error: 'Document not found', status: 404 };
      }

      const updated = await tx.document.update({
        where: { id: documentId },
        data: restore
          ? { withdrawnAt: null, withdrawnReason: null }
          : { withdrawnAt: new Date(), withdrawnReason: reason },
      });

      return { document: updated };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ document: serializeBigInt(result.document) });
  } catch (error) {
    console.error('[WithdrawAPI] POST error:', error);
    return NextResponse.json({ error: 'Failed to update withdrawal' }, { status: 500 });
  }
}
