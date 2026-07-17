/**
 * Organization Branding API (F033)
 *
 * GET   /api/organization/branding - Get branding settings
 * PATCH /api/organization/branding - Update branding
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

import { isAuthenticationError } from '@/lib/errors';
import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

/**
 * Logos/favicons are stored inline as base64 data URLs and rendered in the admin
 * chrome and the public viewer, so bound their size. Downscale and recompress any
 * uploaded raster image; pass non-data URLs (and SVG) through unchanged.
 */
async function optimizeImageDataUrl(value: string, maxHeight: number): Promise<string> {
  if (!value.startsWith('data:image/') || value.startsWith('data:image/svg')) {
    return value;
  }
  try {
    const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (!match || !match[2]) {
      return value;
    }
    const input = Buffer.from(match[2], 'base64');
    const out = await sharp(input)
      .resize({ height: maxHeight, withoutEnlargement: true })
      .png({ compressionLevel: 9, quality: 82 })
      .toBuffer();
    return `data:image/png;base64,${out.toString('base64')}`;
  } catch {
    return value;
  }
}

/**
 * GET /api/organization/branding
 * Get organization branding settings
 */
export async function GET() {
  try {
    const session = await requireAuth();

    // Use RLS context for org-scoped queries
    const organization = await withOrgContext(session.organizationId, async (tx) => {
      return tx.organization.findUnique({
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
    });

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({ branding: organization });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[BrandingAPI] GET error:', error);
    return NextResponse.json({ error: 'Failed to get branding' }, { status: 500 });
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
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, logoUrl, primaryColor, faviconUrl } = body;

    // Validate name if provided
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return NextResponse.json({ error: 'Invalid organization name' }, { status: 400 });
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
          return NextResponse.json({ error: `Invalid ${field} URL` }, { status: 400 });
        }
      }
    }

    // Bound inline image sizes before storing.
    const optimizedLogo =
      logoUrl !== undefined && logoUrl ? await optimizeImageDataUrl(logoUrl, 200) : logoUrl;
    const optimizedFavicon =
      faviconUrl !== undefined && faviconUrl
        ? await optimizeImageDataUrl(faviconUrl, 64)
        : faviconUrl;

    const changedFields = [
      ...(name !== undefined ? ['name'] : []),
      ...(logoUrl !== undefined ? ['logoUrl'] : []),
      ...(primaryColor !== undefined ? ['primaryColor'] : []),
      ...(faviconUrl !== undefined ? ['faviconUrl'] : []),
    ];

    // Use RLS context for org-scoped queries
    const updatedOrg = await withOrgContext(session.organizationId, async (tx) => {
      const org = await tx.organization.update({
        where: { id: session.organizationId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(logoUrl !== undefined && { logoUrl: optimizedLogo || null }),
          ...(primaryColor !== undefined && { primaryColor }),
          ...(faviconUrl !== undefined && { faviconUrl: optimizedFavicon || null }),
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

      await tx.event.create({
        data: {
          organizationId: session.organizationId,
          eventType: 'ORGANIZATION_UPDATED',
          actorType: 'ADMIN',
          actorId: session.userId,
          actorEmail: session.user.email,
          description: 'Updated organization branding',
          metadata: { fields: changedFields },
        },
      });

      return org;
    });

    return NextResponse.json({ branding: updatedOrg });
  } catch (error) {
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[BrandingAPI] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update branding' }, { status: 500 });
  }
}
