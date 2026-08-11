import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { bootstrapDb } from '@/lib/db';
import {
  evaluateLinkServe,
  type LinkPolicyAction,
  type LinkServeSession,
} from '@/lib/permissions/LinkPolicy';

export const viewerSessionBaseSelect = {
  id: true,
  createdAt: true,
  isActive: true,
  organizationId: true,
  roomId: true,
  linkId: true,
  link: {
    select: {
      id: true,
      slug: true,
      isActive: true,
      organizationId: true,
      roomId: true,
      expiresAt: true,
      permission: true,
      scope: true,
      scopedFolderId: true,
      scopedDocumentId: true,
      maxSessionMinutes: true,
      room: {
        select: {
          id: true,
          organizationId: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.ViewSessionSelect;

type ValidViewerSession<T extends LinkServeSession> = T & {
  link: NonNullable<T['link']>;
};

/**
 * PRE-RLS BOOTSTRAP: Resolve viewer session from its cookie-backed session token.
 * The session token proves the viewer already passed the share-link access flow.
 */
export async function getViewerSession<T extends Prisma.ViewSessionSelect>(
  shareToken: string,
  select: T
): Promise<Prisma.ViewSessionGetPayload<{ select: T }> | null> {
  const cookieStore = await cookies();
  const viewerToken = cookieStore.get(`viewer_${shareToken}`)?.value;

  if (!viewerToken) {
    return null;
  }

  return getViewerSessionByToken(viewerToken, select);
}

/** Resolve a viewer session when a trusted server-side caller already read the cookie token. */
export async function getViewerSessionByToken<T extends Prisma.ViewSessionSelect>(
  viewerToken: string,
  select: T
): Promise<Prisma.ViewSessionGetPayload<{ select: T }> | null> {
  return bootstrapDb.viewSession.findFirst({
    where: {
      sessionToken: viewerToken,
      isActive: true,
    },
    select,
  });
}

export function getViewerSessionGuardResponse(
  shareToken: string,
  session: LinkServeSession | null,
  action: LinkPolicyAction = 'view'
): NextResponse | null {
  const decision = evaluateLinkServe(shareToken, session, action);
  return decision.allowed
    ? null
    : NextResponse.json({ error: decision.message }, { status: decision.status });
}

export function requireViewerSession<T extends LinkServeSession>(
  shareToken: string,
  session: T | null,
  action: LinkPolicyAction = 'view'
): { response: NextResponse } | { session: ValidViewerSession<T> } {
  const response = getViewerSessionGuardResponse(shareToken, session, action);
  if (response) {
    return { response };
  }

  return {
    session: session as ValidViewerSession<T>,
  };
}
