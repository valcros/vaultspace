import { NextRequest, NextResponse } from 'next/server';

import { requireAuth, getRequestContext } from '@/lib/middleware';
import { readTemplateInput, templateHttpError } from '@/lib/rooms/templateManagementHttp';
import { SystemRoomTemplateError } from '@/services/SystemRoomTemplateService';
import { organizationRoomTemplateService } from '@/services/OrganizationRoomTemplateService';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    if (session.organization.role !== 'ADMIN') {
      throw new SystemRoomTemplateError(403, 'Organization administrator access required');
    }
    const { id } = await context.params;
    const { input, expectedRevision } = await readTemplateInput(request);
    if (!expectedRevision) {
      throw new SystemRoomTemplateError(409, 'Reload the template before saving');
    }
    const template = await organizationRoomTemplateService.update(id, input, expectedRevision, {
      organizationId: session.organizationId,
      userId: session.userId,
      userEmail: session.user.email,
      requestId: getRequestContext(request).requestId,
    });
    return NextResponse.json({ template });
  } catch (error) {
    return templateHttpError(error);
  }
}
