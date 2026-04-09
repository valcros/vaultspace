import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { db } from '@/lib/db';

export const viewerSessionBaseSelect = {
  id: true,
  createdAt: true,
  organizationId: true,
  link: {
    select: {
      slug: true,
      scope: true,
      scopedFolderId: true,
      scopedDocumentId: true,
      maxSessionMinutes: true,
    },
  },
} satisfies Prisma.ViewSessionSelect;

type ViewerSessionGuardable = {
  createdAt: Date;
  link: {
    slug: string | null;
    maxSessionMinutes: number | null;
  } | null;
};

type ValidViewerSession<T extends ViewerSessionGuardable> = T & {
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

  return db.viewSession.findFirst({
    where: {
      sessionToken: viewerToken,
    },
    select,
  });
}

export function getViewerSessionGuardResponse(
  shareToken: string,
  session: ViewerSessionGuardable | null
): NextResponse | null {
  if (!session || !session.link || session.link.slug !== shareToken) {
    return NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 });
  }

  if (session.link.maxSessionMinutes) {
    const elapsedMinutes = (Date.now() - session.createdAt.getTime()) / 1000 / 60;
    if (elapsedMinutes > session.link.maxSessionMinutes) {
      return NextResponse.json({ error: 'Session time limit exceeded' }, { status: 403 });
    }
  }

  return null;
}

export function requireViewerSession<T extends ViewerSessionGuardable>(
  shareToken: string,
  session: T | null
): { response: NextResponse } | { session: ValidViewerSession<T> } {
  const response = getViewerSessionGuardResponse(shareToken, session);
  if (response) {
    return { response };
  }

  return {
    session: session as ValidViewerSession<T>,
  };
}
