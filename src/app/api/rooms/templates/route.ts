import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { isAuthenticationError } from '@/lib/errors';
import { withOrgContext } from '@/lib/db';
import { systemRoomTemplateService } from '@/services/SystemRoomTemplateService';
import { legacyTemplateProjection } from '@/lib/rooms/templateCatalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();
    const templates = await withOrgContext(session.organizationId, async (tx) => {
      const catalog = await systemRoomTemplateService.list(true, tx);
      const system = catalog.filter((t) => t.enabled);
      const legacy = await tx.roomTemplate.findMany({
        where: { organizationId: session.organizationId },
        orderBy: { name: 'asc' },
      });
      // All system IDs, including disabled ones, are reserved by the global catalog.
      const reserved = new Set(catalog.map((t) => t.id));
      return [
        ...system,
        ...legacy.filter((t) => !reserved.has(t.id)).map(legacyTemplateProjection),
      ];
    });
    return NextResponse.json({ templates }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to load folder templates' }, { status: 500 });
  }
}

/** Organization-owned template authoring is deferred. Global authoring lives under /api/sysop. */
export async function POST() {
  try {
    await requireAuth();
  } catch (error) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: isAuthenticationError(error) ? 401 : 500 }
    );
  }
  return NextResponse.json(
    {
      error:
        'Template authoring is available only in the SysOp control panel. Organization custom templates are not yet available.',
    },
    { status: 403 }
  );
}
