import type { NextRequest } from 'next/server';

/** Require an explicit browser Origin for cookie-backed identity mutations. */
export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }
  try {
    const browserOrigin = new URL(origin);
    if (browserOrigin.origin !== origin) {
      return false;
    }

    // Azure Container Apps terminates TLS before forwarding to Next.js. The
    // internal request URL can therefore differ from the browser's origin.
    const host = request.headers.get('host');
    const forwardedProto = request.headers.get('x-forwarded-proto');
    if (host && forwardedProto) {
      if (forwardedProto !== 'http' && forwardedProto !== 'https') {
        return false;
      }
      return browserOrigin.origin === new URL(`${forwardedProto}://${host}`).origin;
    }

    return browserOrigin.origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}
