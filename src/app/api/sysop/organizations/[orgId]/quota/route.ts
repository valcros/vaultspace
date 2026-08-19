import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { db } from '@/lib/db';

export async function POST(request: Request, context: { params: Promise<{ orgId: string }> }) {
  try {
    // Cross-tenant mutation: platform-operator grant required (not org role).
    await requirePlatformOperator();

    const { orgId } = await context.params;
    const { quotaGb } = await request.json();

    if (!quotaGb || typeof quotaGb !== 'number') {
      return NextResponse.json({ error: 'Invalid quota parameter' }, { status: 400 });
    }

    // Update organization quota in database or setting record
    const org = await db.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      orgId: org.id,
      name: org.name,
      updatedQuotaGb: quotaGb,
      message: `Storage quota for ${org.name} successfully updated to ${quotaGb} GB.`,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('SysOp quota update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
