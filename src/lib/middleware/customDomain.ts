/**
 * Custom Domain Resolution Middleware (F001)
 *
 * Resolves custom domains to organization context.
 * Used by Next.js middleware to set organization context.
 */

import { db } from '@/lib/db';

export interface CustomDomainResult {
  organizationId: string;
  organizationSlug: string;
  isCustomDomain: boolean;
}

/**
 * Resolve a hostname to an organization
 * Returns null if no matching organization found
 */
export async function resolveCustomDomain(
  hostname: string
): Promise<CustomDomainResult | null> {
  // Skip localhost and IP addresses
  if (
    hostname === 'localhost' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.match(/^\d+\.\d+\.\d+\.\d+$/)
  ) {
    return null;
  }

  // Remove port if present
  const domain = hostname.split(':')[0] ?? hostname;

  // Skip the main application domain(s)
  const mainDomains = (process.env['MAIN_DOMAINS'] || 'vaultspace.app,vaultspace.local').split(',');
  if (mainDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return null;
  }

  try {
    // Look up organization by custom domain
    const organization = await db.organization.findFirst({
      where: {
        customDomain: domain,
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
      },
    });

    if (!organization) {
      return null;
    }

    return {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      isCustomDomain: true,
    };
  } catch (error) {
    console.error('[CustomDomain] Resolution error:', error);
    return null;
  }
}

/**
 * Extract organization slug from subdomain
 * e.g., "acme.vaultspace.app" -> "acme"
 */
export function extractSubdomain(hostname: string): string | null {
  const mainDomains = (process.env['MAIN_DOMAINS'] || 'vaultspace.app,vaultspace.local').split(',');
  
  for (const mainDomain of mainDomains) {
    if (hostname.endsWith(`.${mainDomain}`)) {
      const subdomain = hostname.replace(`.${mainDomain}`, '').split(':')[0];
      if (subdomain && subdomain !== 'www') {
        return subdomain;
      }
    }
  }
  
  return null;
}

/**
 * Resolve organization by subdomain
 */
export async function resolveSubdomain(
  hostname: string
): Promise<CustomDomainResult | null> {
  const subdomain = extractSubdomain(hostname);
  if (!subdomain) {
    return null;
  }

  try {
    const organization = await db.organization.findFirst({
      where: {
        slug: subdomain,
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
      },
    });

    if (!organization) {
      return null;
    }

    return {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      isCustomDomain: false,
    };
  } catch (error) {
    console.error('[Subdomain] Resolution error:', error);
    return null;
  }
}

/**
 * Main resolution function - tries custom domain first, then subdomain
 */
export async function resolveOrganizationFromHost(
  hostname: string
): Promise<CustomDomainResult | null> {
  // Try custom domain first
  const customDomainResult = await resolveCustomDomain(hostname);
  if (customDomainResult) {
    return customDomainResult;
  }

  // Try subdomain
  const subdomainResult = await resolveSubdomain(hostname);
  if (subdomainResult) {
    return subdomainResult;
  }

  return null;
}
