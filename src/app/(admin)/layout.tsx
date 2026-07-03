import { redirect } from 'next/navigation';

import { getServerComponentSession } from '@/lib/auth/serverComponentSession';
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

  return <DockShell user={user}>{children}</DockShell>;
}
