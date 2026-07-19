/**
 * Server-component session resolution.
 *
 * Shared by the (admin) layout and RSC pages that need the authenticated
 * session during server rendering (e.g. the dashboard landing). Extracted
 * from src/app/(admin)/layout.tsx so pages do not duplicate the
 * cookie + bootstrapDb lookup.
 */

import { cookies } from 'next/headers';

import { bootstrapDb } from '@/lib/db';
import { SESSION_CONFIG } from '@/lib/constants';

export async function getServerComponentSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_CONFIG.COOKIE_NAME)?.value;

  if (!sessionToken) {
    return null;
  }

  // Uses bootstrapDb (admin connection, BYPASSRLS) for the session lookup +
  // user JOIN. The regular `db` client's pool can carry stale
  // app.current_org_id from prior requests, which makes the bootstrap RLS
  // policies on users evaluate false and the JOIN return nothing.
  const session = await bootstrapDb.session.findFirst({
    where: {
      token: sessionToken,
      expiresAt: { gt: new Date() },
      isActive: true,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
        },
      },
    },
  });

  if (!session || !session.user.isActive || !session.organizationId) {
    return null;
  }

  // Same rationale for the org lookup — pre-context bootstrap.
  const organization = await bootstrapDb.organization.findUnique({
    where: { id: session.organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
    },
  });

  if (!organization || !organization.isActive) {
    return null;
  }

  // Resolve the caller's org role (ADMIN | VIEWER) so the admin shell and pages
  // can gate admin-only UI. Uses bootstrapDb for the same pre-context reason as
  // the lookups above; the membership must be active.
  const membership = await bootstrapDb.userOrganization.findUnique({
    where: {
      organizationId_userId: {
        organizationId: session.organizationId,
        userId: session.userId,
      },
    },
    select: { role: true, isActive: true },
  });

  if (!membership || !membership.isActive) {
    return null;
  }

  // Re-state organizationId so the returned type carries the non-null
  // narrowing from the guard above.
  return {
    ...session,
    organizationId: session.organizationId,
    organization,
    role: membership.role,
  };
}
