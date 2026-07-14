import { redirect } from 'next/navigation';

import { getServerComponentSession } from '@/lib/auth/serverComponentSession';
import { withOrgContext } from '@/lib/db';
import { DockShell } from '@/components/layout/dock-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerComponentSession();

  if (!session) {
    redirect('/auth/login');
  }

  const user = {
    name: `${session.user.firstName} ${session.user.lastName}`,
    email: session.user.email,
  };

  // Resolve org branding so the shell shows the organization you are working in.
  const org = await withOrgContext(session.organizationId, (tx) =>
    tx.organization.findUnique({
      where: { id: session.organizationId },
      select: { name: true, logoUrl: true },
    })
  ).catch(() => null);

  const organization = {
    name: org?.name ?? session.organization.name,
    logoUrl: org?.logoUrl ?? null,
  };

  return (
    <DockShell user={user} organization={organization}>
      {children}
    </DockShell>
  );
}
