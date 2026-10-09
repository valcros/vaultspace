import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext, requirePlatformOperator } from '@/lib/middleware';
import { systemRoomTemplateService } from '@/services/SystemRoomTemplateService';
import { readTemplateInput, templateHttpError } from '@/lib/rooms/templateManagementHttp';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requirePlatformOperator();
    return NextResponse.json(
      { templates: await systemRoomTemplateService.list(true) },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return templateHttpError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const session = await requirePlatformOperator();
    const { input } = await readTemplateInput(request);
    const template = await systemRoomTemplateService.create(input, {
      actorUserId: session.userId,
      requestId: getRequestContext(request).requestId,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return templateHttpError(error);
  }
}
