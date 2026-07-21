/**
 * Organization Landing Page
 *
 * Accessed via custom subdomain: clientname.vaultspace.org
 * The middleware rewrites / to /org/[slug] for subdomain requests.
 *
 * Shows the organization's branded landing page with available
 * public share links, or redirects to login if no public content.
 */

import { redirect } from 'next/navigation';

import { bootstrapDb } from '@/lib/db';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function OrgLandingPage({ params }: PageProps) {
  const { slug } = await params;

  // Public, pre-session org resolution: MUST use bootstrapDb (BYPASSRLS). The
  // regular `db` pool can carry a stale app.current_org_id, which makes the
  // org_bootstrap_lookup RLS policy return nothing -> "Organization Not Found".
  const organization = await bootstrapDb.organization.findFirst({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      primaryColor: true,
    },
  });

  if (!organization) {
    // Unknown org slug — show 404
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold text-neutral-900">Organization Not Found</h1>
          <p className="text-neutral-500">The organization &quot;{slug}&quot; does not exist.</p>
        </div>
      </div>
    );
  }

  // For now, redirect to the login page with the org context
  // Future: show public rooms, branded landing page
  redirect(`/auth/login?org=${organization.slug}`);
}
