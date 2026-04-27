import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { bootstrapDb } from '@/lib/db';
import { SESSION_CONFIG } from '@/lib/constants';
import { DockShell } from '@/components/layout/dock-shell';

async function getSession() {
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

  return { ...session, organization };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect('/auth/login');
  }

  const user = {
    name: `${session.user.firstName} ${session.user.lastName}`,
    email: session.user.email,
  };

  return <DockShell user={user}>{children}</DockShell>;
}
