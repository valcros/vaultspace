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

import { db } from '@/lib/db';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function OrgLandingPage({ params }: PageProps) {
  const { slug } = await params;

  // Look up organization by slug (no RLS — public lookup)
  const organization = await db.organization.findFirst({
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
