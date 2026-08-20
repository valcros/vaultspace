import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requirePlatformOperator, getRequestContext } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { bootstrapDb as db } from '@/lib/db';
import { captureSecurityAudit } from '@/lib/audit/securityAudit';
import { PROTECTED_ORG_SLUGS } from '@/lib/sysop/protectedOrgs';

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

    // Disable-only guards (enabling a protected/own org is harmless).
    if (!isActive) {
      // Self-lockout: an operator must not disable an org they belong to —
      // checked across ALL of their memberships, not just the session org.
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

      // Keep-list: never disable a protected real org (enforced at THIS mutation
      // boundary, not only in bulk-disable). Resolved to immutable IDs.
      const protectedOrgs = await db.organization.findMany({
        where: { slug: { in: PROTECTED_ORG_SLUGS } },
        select: { id: true },
      });
      if (protectedOrgs.some((o) => o.id === orgId)) {
        return NextResponse.json(
          { error: 'This organization is protected and cannot be disabled.' },
          { status: 409 }
        );
      }
    }

    // Direct write via bootstrapDb (the DATABASE_URL_ADMIN role). ⚠️ Requires that
    // role to hold an UPDATE grant on organizations.isActive and to be able to
    // reach a disabled org for re-enable — validate at deploy (see migration notes).
    let org: { id: string; name: string; slug: string; isActive: boolean };
    try {
      org = await db.organization.update({
        where: { id: orgId },
        data: { isActive },
        select: { id: true, name: true, slug: true, isActive: true },
      });
    } catch (updateError) {
      if (
        updateError &&
        typeof updateError === 'object' &&
        'code' in updateError &&
        (updateError as { code?: string }).code === 'P2025'
      ) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }
      throw updateError;
    }

    // Audit under the OPERATOR's org (never the target org — an org-scoped event
    // written under a deleted/target org can be cascade-erased); target in metadata.
    const reqContext = getRequestContext(request);
    const auditOutcome = await captureSecurityAudit({
      organizationId: session.organizationId,
      eventType: isActive ? 'ORG_ENABLED' : 'ORG_DISABLED',
      actorType: 'ADMIN',
      actorId: session.userId,
      actorEmail: session.user?.email ?? null,
      requestId: reqContext.requestId,
      description: `Organization ${isActive ? 'enabled' : 'disabled'} by platform operator`,
      metadata: {
        targetOrgId: org.id,
        targetOrgSlug: org.slug,
        targetOrgName: org.name,
      },
    });

    // The audit record is authoritative for this privileged action. If it could
    // not be written, surface an error so the operator retries (the isActive
    // write is reversible and re-applying is safe).
    if (auditOutcome === 'failed') {
      return NextResponse.json(
        { error: 'The change was applied but its audit record failed to write. Please retry.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      isActive: org.isActive,
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
