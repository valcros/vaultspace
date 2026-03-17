/**
 * Logout API (F004)
 *
 * POST /api/auth/logout - End user session
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { db } from '@/lib/db';
import { SESSION_CONFIG } from '@/lib/constants';
import { clearSessionCookie } from '@/lib/middleware';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_CONFIG.COOKIE_NAME)?.value;

    if (sessionToken) {
      // Delete session from database
      await db.session.deleteMany({
        where: { token: sessionToken },
      });
    }

    // Clear session cookie
    await clearSessionCookie();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LogoutAPI] Error:', error);
    // Still clear cookie even if database operation fails
    await clearSessionCookie();
    return NextResponse.json({ success: true });
  }
}
