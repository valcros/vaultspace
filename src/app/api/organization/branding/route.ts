/**
 * Organization Branding API (F033)
 *
 * GET   /api/organization/branding - Get branding settings
 * PATCH /api/organization/branding - Update branding
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/organization/branding
 * Get organization branding settings
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const organization = await db.organization.findUnique({
      where: { id: session.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        primaryColor: true,
        faviconUrl: true,
      },
    });

    if (!organization) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ branding: organization });
  } catch (error) {
    console.error('[BrandingAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get branding' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/organization/branding
 * Update organization branding
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, logoUrl, primaryColor, faviconUrl } = body;

    // Validate name if provided
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return NextResponse.json(
        { error: 'Invalid organization name' },
        { status: 400 }
      );
    }

    // Validate primary color (hex format)
    if (primaryColor !== undefined) {
      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (!hexColorRegex.test(primaryColor)) {
        return NextResponse.json(
          { error: 'Invalid primary color format (use hex, e.g., #2563eb)' },
          { status: 400 }
        );
      }
    }

    // Validate URLs if provided
    const urlFields = { logoUrl, faviconUrl };
    for (const [field, value] of Object.entries(urlFields)) {
      if (value !== undefined && value !== null && value !== '') {
        try {
          new URL(value);
        } catch {
          return NextResponse.json(
            { error: `Invalid ${field} URL` },
            { status: 400 }
          );
        }
      }
    }

    // Update organization branding
    const updatedOrg = await db.organization.update({
      where: { id: session.organizationId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(logoUrl !== undefined && { logoUrl: logoUrl || null }),
        ...(primaryColor !== undefined && { primaryColor }),
        ...(faviconUrl !== undefined && { faviconUrl: faviconUrl || null }),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        primaryColor: true,
        faviconUrl: true,
      },
    });

    return NextResponse.json({ branding: updatedOrg });
  } catch (error) {
    console.error('[BrandingAPI] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update branding' },
      { status: 500 }
    );
  }
}
