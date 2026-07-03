/**
 * Dashboard landing (RSC).
 *
 * Server component: resolves the session and loads the landing data on the
 * server (no hydrate-then-fetch waterfall, no skeleton flash), then hands the
 * serialized payload to the DashboardLanding client child for interactivity
 * (greeting, tombstone visit counting, strips/cards).
 *
 * Errors from the data load surface to the (admin)/error.tsx boundary.
 */

import { redirect } from 'next/navigation';

import { getServerComponentSession } from '@/lib/auth/serverComponentSession';
import { getDashboardData } from '@/lib/dashboard-data';

import { DashboardLanding } from './DashboardLanding';

export default async function DashboardPage() {
  const session = await getServerComponentSession();

  // The (admin) layout already guards, but mirror its redirect so this page
  // never renders without an authenticated session.
  if (!session) {
    redirect('/auth/login');
  }

  // Tenant scope comes exclusively from the server-resolved session.
  const data = await getDashboardData({
    organizationId: session.organizationId,
    userId: session.userId,
  });

  return <DashboardLanding data={data} />;
}
