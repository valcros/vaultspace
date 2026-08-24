import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requirePlatformOperator, getRequestContext } from '@/lib/middleware';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { bootstrapDb as db } from '@/lib/db';
import { captureSecurityAudit } from '@/lib/audit/securityAudit';
import {
  getProtectedOrganizationSlugs,
  ProtectedOrganizationConfigurationError,
} from '@/lib/sysop/protectedOrgs';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 50;

const bodySchema = z.object({
  dryRun: z.boolean().optional().default(true),
  confirmIds: z.array(z.string()).optional(),
});

/**
 * POST /api/sysop/organizations/bulk-disable  { dryRun?, confirmIds? }
 *
 * Disable (reversible) the junk self-registered orgs: isActive=true AND 0 rooms
 * AND <=1 user, excluding the keep-list and the operator's own orgs.
 * dryRun (default) returns the candidate list without mutating. To execute, send
 * dryRun:false WITH the reviewed confirmIds; the server re-derives the eligible
 * set and disables only ids present in BOTH (closes the dry-run→execute TOCTOU).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requirePlatformOperator();
    const { dryRun, confirmIds } = bodySchema.parse(await request.json().catch(() => ({})));

    // Resolve the keep-list to immutable IDs + the operator's own org IDs.
    const [keepOrgs, operatorMemberships] = await Promise.all([
      db.organization.findMany({
        where: { slug: { in: getProtectedOrganizationSlugs() } },
        select: { id: true },
      }),
      db.userOrganization.findMany({
        where: { userId: session.userId },
        select: { organizationId: true },
      }),
    ]);
    const protectedIds = new Set<string>([
      ...keepOrgs.map((o) => o.id),
      ...operatorMemberships.map((m) => m.organizationId),
    ]);

    // Structural classifier: explicitly active, zero rooms, <=1 member.
    // (bootstrapDb is also RLS-filtered to active orgs; isActive:true is belt-and-
    // suspenders so the intent is not implicit.)
    const candidates = await db.organization.findMany({
      where: { isActive: true, rooms: { none: {} } },
      select: { id: true, name: true, slug: true, _count: { select: { users: true } } },
    });
    const eligible = candidates.filter((o) => o._count.users <= 1 && !protectedIds.has(o.id));

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        count: eligible.length,
        organizations: eligible.map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
        protectedCount: protectedIds.size,
      });
    }

    // Execute: only disable ids the operator reviewed AND that are still eligible.
    if (!confirmIds || confirmIds.length === 0) {
      return NextResponse.json(
        { error: 'confirmIds is required to execute (send the reviewed dry-run ids).' },
        { status: 400 }
      );
    }
    const uniqueConfirmIds = Array.from(new Set(confirmIds));
    const eligibleById = new Map(eligible.map((o) => [o.id, o]));
    const toDisable = uniqueConfirmIds.filter((id) => eligibleById.has(id));
    const skipped = uniqueConfirmIds.filter((id) => !eligibleById.has(id));

    const reqContext = getRequestContext(request);
    const disabled: string[] = [];
    const failed: string[] = [];
    const auditFailed: string[] = [];

    for (let i = 0; i < toDisable.length; i += BATCH_SIZE) {
      const batch = toDisable.slice(i, i + BATCH_SIZE);
      for (const id of batch) {
        try {
          const updated = await db.organization.update({
            where: { id },
            data: { isActive: false },
            select: { slug: true, name: true },
          });
          disabled.push(id);
          const outcome = await captureSecurityAudit({
            organizationId: session.organizationId,
            eventType: 'ORG_DISABLED',
            actorType: 'ADMIN',
            actorId: session.userId,
            actorEmail: session.user?.email ?? null,
            requestId: reqContext.requestId,
            description: 'Organization disabled via bulk cleanup by platform operator',
            metadata: {
              targetOrgId: id,
              targetOrgSlug: updated.slug,
              targetOrgName: updated.name,
              bulk: true,
            },
          });
          if (outcome === 'failed') {
            auditFailed.push(id);
          }
        } catch (batchError) {
          console.error('SysOp bulk-disable item error:', id, batchError);
          failed.push(id);
        }
      }
    }

    return NextResponse.json({
      dryRun: false,
      disabled,
      disabledCount: disabled.length,
      skipped,
      failed,
      auditFailed,
    });
  } catch (error) {
    if (error instanceof ProtectedOrganizationConfigurationError) {
      console.error('SysOp bulk-disable protection configuration error:', error.message);
      return NextResponse.json(
        { error: 'Organization protection is not configured. No changes were applied.' },
        { status: 503 }
      );
    }
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
    console.error('SysOp bulk-disable error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
