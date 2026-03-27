/**
 * Next.js Middleware
 *
 * Handles:
 * - Custom domain resolution (F001)
 * - Rate limiting headers
 * - Security headers
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware configuration
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

/**
 * Main middleware function
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const hostname = request.headers.get('host') || '';

  const pathname = request.nextUrl.pathname;

  // Skip for localhost and development
  if (
    hostname.includes('localhost') ||
    hostname.startsWith('127.') ||
    hostname.startsWith('192.168.')
  ) {
    return addSecurityHeaders(response, pathname);
  }

  // Setup wizard enforcement — redirect to /setup if no org exists
  // Skip for setup page itself, API routes, and static assets
  if (
    !pathname.startsWith('/setup') &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/_next/') &&
    !pathname.includes('.')
  ) {
    try {
      const setupRes = await fetch(`${request.nextUrl.origin}/api/setup`, {
        headers: { Cookie: request.headers.get('cookie') || '' },
      });
      if (setupRes.ok) {
        const data = await setupRes.json();
        if (data.needsSetup) {
          return NextResponse.redirect(new URL('/setup', request.url));
        }
      }
    } catch {
      // If setup check fails, continue normally
    }
  }

  // Check for custom domain or subdomain
  const mainDomains = (
    process.env['MAIN_DOMAINS'] || 'vaultspace.org,vaultspace.app,vaultspace.local'
  ).split(',');
  const isMainDomain = mainDomains.some(
    (d) => hostname === d || hostname === 'www.' + d || hostname.includes('azurecontainerapps.io')
  );

  if (!isMainDomain) {
    // This could be a custom domain or subdomain (e.g., clientname.vaultspace.org)
    // Set header for downstream handlers to resolve organization
    response.headers.set('x-custom-host', hostname);

    // Extract subdomain if applicable
    for (const mainDomain of mainDomains) {
      if (hostname.endsWith('.' + mainDomain)) {
        const subdomain = hostname.replace('.' + mainDomain, '').split(':')[0];
        if (subdomain && subdomain !== 'www') {
          response.headers.set('x-org-slug', subdomain);

          // For subdomain requests to the root, redirect to the org's public viewer
          if (pathname === '/' || pathname === '') {
            const url = request.nextUrl.clone();
            url.pathname = `/org/${subdomain}`;
            return NextResponse.rewrite(url);
          }
        }
        break;
      }
    }
  }

  return addSecurityHeaders(response, pathname);
}

/**
 * Add security headers to response
 */
function addSecurityHeaders(response: NextResponse, pathname: string): NextResponse {
  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // X-Frame-Options: SAMEORIGIN for preview routes to allow iframe embedding
  // DENY for all other routes to prevent clickjacking
  const isPreviewRoute = pathname.includes('/documents/') && pathname.endsWith('/preview');
  response.headers.set('X-Frame-Options', isPreviewRoute ? 'SAMEORIGIN' : 'DENY');

  // Content Security Policy (basic)
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'"
  );

  return response;
}
