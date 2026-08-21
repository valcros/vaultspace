import { redirect } from 'next/navigation';

import { getServerComponentSession } from '@/lib/auth/serverComponentSession';

export default async function NotificationTemplatesSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerComponentSession();
  if (!session || session.role !== 'ADMIN') {
    redirect('/settings');
  }

  return children;
}
