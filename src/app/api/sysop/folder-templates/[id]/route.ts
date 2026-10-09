import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext, requirePlatformOperator } from '@/lib/middleware';
import {
  SystemRoomTemplateError,
  systemRoomTemplateService,
} from '@/services/SystemRoomTemplateService';
import { readTemplateInput, templateHttpError } from '@/lib/rooms/templateManagementHttp';
export const dynamic = 'force-dynamic';
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePlatformOperator();
    const { id } = await context.params;
    const { input, expectedRevision } = await readTemplateInput(request);
    if (!expectedRevision) {
      throw new SystemRoomTemplateError(409, 'Reload the template before saving');
    }
    const template = await systemRoomTemplateService.update(id, input, expectedRevision, {
      actorUserId: session.userId,
      requestId: getRequestContext(request).requestId,
    });
    return NextResponse.json({ template });
  } catch (error) {
    return templateHttpError(error);
  }
}
