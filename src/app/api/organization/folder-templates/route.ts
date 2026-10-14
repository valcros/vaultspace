import { NextRequest, NextResponse } from 'next/server';

import { requireAuth, getRequestContext } from '@/lib/middleware';
import { readTemplateInput, templateHttpError } from '@/lib/rooms/templateManagementHttp';
import { SystemRoomTemplateError } from '@/services/SystemRoomTemplateService';
import { organizationRoomTemplateService } from '@/services/OrganizationRoomTemplateService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();
    if (session.organization.role !== 'ADMIN') {
      throw new SystemRoomTemplateError(403, 'Organization administrator access required');
    }
    const templates = await organizationRoomTemplateService.list(session.organizationId, true);
    return NextResponse.json({ templates }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return templateHttpError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.organization.role !== 'ADMIN') {
      throw new SystemRoomTemplateError(403, 'Organization administrator access required');
    }
    const { input } = await readTemplateInput(request);
    const template = await organizationRoomTemplateService.create(input, {
      organizationId: session.organizationId,
      userId: session.userId,
      userEmail: session.user.email,
      requestId: getRequestContext(request).requestId,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return templateHttpError(error);
  }
}
