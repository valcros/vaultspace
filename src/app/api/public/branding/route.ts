/**
 * Public Organization Branding API (F033, F001)
 *
 * GET /api/public/branding - Get organization branding from custom domain/subdomain
 *
 * Used by public pages to display organization-specific branding
 * without requiring authentication.
 */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';

// This route uses request headers, so it must be dynamic
export const dynamic = 'force-dynamic';
import {
  getRequestContext,
  resolveOrganizationFromHeaders,
} from '@/lib/middleware';

/**
 * GET /api/public/branding
 * Get organization branding based on custom domain or subdomain headers
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

    // Fetch organization branding
    const organization = await db.organization.findUnique({
      where: { id: resolved.organizationId },
      select: {
        name: true,
        slug: true,
        logoUrl: true,
        primaryColor: true,
        faviconUrl: true,
      },
    });

    if (!organization) {
      return NextResponse.json({
        branding: null,
        detected: false,
      });
    }

    return NextResponse.json({
      branding: organization,
      detected: true,
    });
  } catch (error) {
    console.error('[PublicBrandingAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get branding' },
      { status: 500 }
    );
  }
}
