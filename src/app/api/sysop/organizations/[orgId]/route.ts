import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requirePlatformOperator, getRequestContext } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { bootstrapDb as db } from '@/lib/db';
import { captureSecurityAudit } from '@/lib/audit/securityAudit';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({ isActive: z.boolean() });

/**
 * PATCH /api/sysop/organizations/[orgId]  { isActive }
 *
 * Enable or disable an organization. Disabling is reversible and takes effect
 * immediately: the session resolver INNER JOINs on organization.isActive, so a
 * disabled org's users lose both API and page access on their next request.
 *
 * The write goes through the SECURITY DEFINER function sysop_set_organization_active
 * because bootstrapDb's role cannot UPDATE organizations.isActive directly.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  try {
    const session = await requirePlatformOperator();
    const { orgId } = await context.params;
    const { isActive } = patchSchema.parse(await request.json());

    // Self-lockout guard: an operator must not disable an org they belong to —
    // checked across ALL of their memberships, not just the current session org.
    if (!isActive) {
      const ownMembership = await db.userOrganization.findFirst({
        where: { userId: session.userId, organizationId: orgId },
        select: { id: true },
      });
      if (ownMembership) {
        return NextResponse.json(
          { error: 'You cannot disable an organization you belong to.' },
          { status: 409 }
        );
      }
    }

    const rows = await db.$queryRaw<
      Array<{ org_id: string; org_name: string; org_slug: string; is_active: boolean }>
    >`SELECT * FROM public.sysop_set_organization_active(${orgId}, ${isActive})`;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    const org = rows[0]!;

    // Audit under the OPERATOR's org (never the target org — an org-scoped event
    // written under a deleted/target org can be cascade-erased); target in metadata.
    const reqContext = getRequestContext(request);
    await captureSecurityAudit({
      organizationId: session.organizationId,
      eventType: isActive ? 'ORG_ENABLED' : 'ORG_DISABLED',
      actorType: 'ADMIN',
      actorId: session.userId,
      actorEmail: session.user?.email ?? null,
      requestId: reqContext.requestId,
      description: `Organization ${isActive ? 'enabled' : 'disabled'} by platform operator`,
      metadata: {
        targetOrgId: org.org_id,
        targetOrgSlug: org.org_slug,
        targetOrgName: org.org_name,
      },
    });

    return NextResponse.json({
      id: org.org_id,
      name: org.org_name,
      slug: org.org_slug,
      isActive: org.is_active,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    console.error('SysOp org PATCH error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
