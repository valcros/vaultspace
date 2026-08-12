/**
 * Public Organization Branding API (F033, F001)
 *
 * GET /api/public/branding - Get organization branding from custom domain/subdomain
 *
 * Used by public pages to display organization-specific branding
 * without requiring authentication.
 */

import { NextRequest, NextResponse } from 'next/server';

// This route uses request headers, so it must be dynamic
export const dynamic = 'force-dynamic';
import { getRequestContext, resolveOrganizationFromHeaders } from '@/lib/middleware';

/**
 * GET /api/public/branding
 * Get organization branding based on custom domain or subdomain headers
 *
 * PRE-RLS BOOTSTRAP: public endpoint that resolves one active organization
 * through the reviewed organization function and returns only its accepted
 * public branding projection.
 */
export async function GET(request: NextRequest) {
  try {
    const { customDomain } = getRequestContext(request);

    // Try to resolve organization from custom domain/subdomain
    const resolved = await resolveOrganizationFromHeaders(customDomain);

    if (!resolved) {
      // No custom domain detected - return default/empty branding
      return NextResponse.json({
        branding: null,
        detected: false,
      });
    }

    return NextResponse.json({
      branding: {
        name: resolved.name,
        slug: resolved.slug,
        logoUrl: resolved.logoUrl,
        primaryColor: resolved.primaryColor,
        faviconUrl: resolved.faviconUrl,
      },
      detected: true,
    });
  } catch {
    console.error(
      JSON.stringify({
        component: 'public-branding',
        event: 'organization_lookup_failed',
        outcome: 'error',
      })
    );
    return NextResponse.json({ error: 'Failed to get branding' }, { status: 500 });
  }
}
