import { withOrgContext } from '@/lib/db';
import { getSession } from '@/lib/middleware/auth';

export interface AuthenticatedLinkMember {
  userId: string;
  organizationId: string;
  email: string;
  ndaOnFile: boolean;
}

/**
 * Resolve a trusted membership for a public-link request. An asserted email is
 * intentionally not accepted here: the caller must carry a valid VaultSpace
 * session for the exact organization that owns the link.
 */
export async function getAuthenticatedLinkMember(
  organizationId: string
): Promise<AuthenticatedLinkMember | null> {
  // Public-link pages are also rendered by test harnesses and unauthenticated
  // browsers that have no request cookie store. Those are simply not trusted
  // members, not server failures.
  let session;
  try {
    session = await getSession();
  } catch {
    return null;
  }
  if (!session || session.organizationId !== organizationId) {
    return null;
  }

  return withOrgContext(organizationId, async (tx) => {
    const membership = await tx.userOrganization.findFirst({
      where: {
        organizationId,
        userId: session.userId,
        isActive: true,
        archivedAt: null,
        user: { isActive: true },
      },
      select: { userId: true, organizationId: true, ndaOnFile: true, user: { select: { email: true } } },
    });
    if (!membership) {return null;}
    return {
      userId: membership.userId,
      organizationId: membership.organizationId,
      email: membership.user.email,
      ndaOnFile: membership.ndaOnFile,
    };
  });
}
