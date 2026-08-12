/**
 * Server-component session resolution.
 *
 * Shared by the (admin) layout and RSC pages that need the authenticated
 * session during server rendering (e.g. the dashboard landing). Extracted
 * from src/app/(admin)/layout.tsx so pages do not duplicate the
 * cookie + constrained bootstrap repository lookup.
 */

import { cookies } from 'next/headers';

import { BootstrapRepository } from '@/lib/auth/bootstrapRepository';
import { SESSION_CONFIG } from '@/lib/constants';

const bootstrapRepository = new BootstrapRepository();

export async function getServerComponentSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_CONFIG.COOKIE_NAME)?.value;

  if (!sessionToken) {
    return null;
  }

  const session = await bootstrapRepository.resolveSession(sessionToken);
  if (!session) {
    return null;
  }

  return {
    id: session.sessionId,
    userId: session.userId,
    organizationId: session.organizationId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastActiveAt: session.lastActiveAt,
    user: session.user,
    organization: {
      id: session.organization.id,
      name: session.organization.name,
      slug: session.organization.slug,
      isActive: true as const,
    },
    role: session.organization.role,
  };
}
