/**
 * One-time self-service workspace setup.
 *
 * This is the only user-facing mutation allowed to replace an internal
 * provisional organization slug with a public tenant-routing subdomain.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';
import {
  INITIAL_SELF_SERVICE_ROOM_SLUG,
  isClaimableWorkspaceSlug,
  isProvisionalWorkspaceSlug,
  normalizeWorkspaceSlug,
  suggestWorkspaceSlug,
} from '@/lib/organizations/workspaceSetup';

export const dynamic = 'force-dynamic';

const workspaceSetupSchema = z.object({
  organizationName: z.string().trim().min(1).max(255),
  workspaceSlug: z.string().trim().min(3).max(63),
  roomName: z.string().trim().min(1).max(255),
});

class WorkspaceSetupConflictError extends Error {}

function noStoreJson(body: Record<string, unknown>, init: { status?: number } = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function getEligibleStarterRoom(tx: Prisma.TransactionClient, organizationId: string) {
  const [roomCount, starterRoom] = await Promise.all([
    tx.room.count({ where: { organizationId } }),
    tx.room.findFirst({
      where: {
        organizationId,
        slug: INITIAL_SELF_SERVICE_ROOM_SLUG,
        status: 'DRAFT',
      },
      select: { id: true, name: true },
    }),
  ]);
  return roomCount === 1 ? starterRoom : null;
}

export async function GET() {
  try {
    const session = await requireAuth();
    const result = await withOrgContext(session.organizationId, async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: session.organizationId },
        select: {
          name: true,
          slug: true,
          workspaceUrlClaimEligible: true,
          workspaceUrlClaimedAt: true,
        },
      });
      if (!organization) {
        return null;
      }
      const starterRoom = await getEligibleStarterRoom(tx, session.organizationId);
      const onboardingRequired =
        session.organization.role === 'ADMIN' &&
        organization.workspaceUrlClaimEligible &&
        organization.workspaceUrlClaimedAt === null &&
        isProvisionalWorkspaceSlug(organization.slug) &&
        starterRoom !== null;
      return { organization, starterRoom, onboardingRequired };
    });

    if (!result) {
      return noStoreJson({ error: 'Organization not found' }, { status: 404 });
    }
    return noStoreJson({
      onboardingRequired: result.onboardingRequired,
      organization: result.onboardingRequired
        ? {
            name: result.organization.name,
            suggestedSlug: suggestWorkspaceSlug(result.organization.name),
          }
        : null,
      starterRoom: result.onboardingRequired ? result.starterRoom : null,
    });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return noStoreJson({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[WorkspaceSetupAPI] GET error:', error);
    return noStoreJson({ error: 'Failed to load workspace setup' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.organization.role !== 'ADMIN') {
      return noStoreJson({ error: 'Admin access required' }, { status: 403 });
    }
    const input = workspaceSetupSchema.parse(await request.json());
    const workspaceSlug = normalizeWorkspaceSlug(input.workspaceSlug);
    if (!isClaimableWorkspaceSlug(workspaceSlug)) {
      return noStoreJson(
        {
          error:
            'Choose 3 to 63 lowercase letters, numbers, or hyphens. The URL cannot start or end with a hyphen or use a reserved name.',
        },
        { status: 400 }
      );
    }

    const result = await withOrgContext(session.organizationId, async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: session.organizationId },
        select: { slug: true, workspaceUrlClaimEligible: true, workspaceUrlClaimedAt: true },
      });
      if (
        !organization ||
        !organization.workspaceUrlClaimEligible ||
        organization.workspaceUrlClaimedAt !== null ||
        !isProvisionalWorkspaceSlug(organization.slug)
      ) {
        throw new WorkspaceSetupConflictError('WORKSPACE_URL_ALREADY_CLAIMED');
      }
      const starterRoom = await getEligibleStarterRoom(tx, session.organizationId);
      if (!starterRoom) {
        throw new WorkspaceSetupConflictError('WORKSPACE_SETUP_NO_LONGER_ELIGIBLE');
      }

      const now = new Date();
      const organizationUpdate = await tx.organization.updateMany({
        where: {
          id: session.organizationId,
          slug: organization.slug,
          workspaceUrlClaimEligible: true,
          workspaceUrlClaimedAt: null,
        },
        data: {
          name: input.organizationName,
          slug: workspaceSlug,
          workspaceUrlClaimedAt: now,
        },
      });
      if (organizationUpdate.count !== 1) {
        throw new WorkspaceSetupConflictError('WORKSPACE_URL_ALREADY_CLAIMED');
      }
      const roomUpdate = await tx.room.updateMany({
        where: {
          id: starterRoom.id,
          organizationId: session.organizationId,
          slug: INITIAL_SELF_SERVICE_ROOM_SLUG,
          status: 'DRAFT',
        },
        data: { name: input.roomName },
      });
      if (roomUpdate.count !== 1) {
        throw new WorkspaceSetupConflictError('WORKSPACE_SETUP_NO_LONGER_ELIGIBLE');
      }
      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          roomId: starterRoom.id,
          eventType: 'ORGANIZATION_UPDATED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          description: 'Claimed workspace URL and configured initial draft room',
          metadata: { fields: ['name', 'slug', 'workspaceUrlClaimedAt', 'initialRoomName'] },
        },
      });
      return { organizationName: input.organizationName, workspaceSlug, roomId: starterRoom.id };
    });

    return noStoreJson({
      workspace: {
        name: result.organizationName,
        slug: result.workspaceSlug,
        url: `https://${result.workspaceSlug}.vaultspace.org`,
      },
      room: { id: result.roomId },
    });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return noStoreJson({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return noStoreJson(
        { error: error.issues[0]?.message ?? 'Invalid workspace setup' },
        { status: 400 }
      );
    }
    if (error instanceof WorkspaceSetupConflictError) {
      return noStoreJson(
        {
          error:
            error.message === 'WORKSPACE_URL_ALREADY_CLAIMED'
              ? 'This workspace URL has already been claimed.'
              : 'Workspace setup is only available for an untouched starter draft room.',
        },
        { status: 409 }
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return noStoreJson({ error: 'That workspace URL is already in use.' }, { status: 409 });
    }
    console.error('[WorkspaceSetupAPI] POST error:', error);
    return noStoreJson({ error: 'Failed to set up workspace' }, { status: 500 });
  }
}
