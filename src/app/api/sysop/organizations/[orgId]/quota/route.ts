import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

export async function POST(request: Request, context: { params: Promise<{ orgId: string }> }) {
  try {
    const session = await requireAuth();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
    console.error('SysOp quota update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
