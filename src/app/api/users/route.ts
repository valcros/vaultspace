/**
 * Users Collection API (F052)
 *
 * GET /api/users - List organization users
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuthFromRequest } from '@/lib/middleware';
import { db } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/users
 * List all users in the organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthFromRequest(request);

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Get all users in the organization
    const userOrgs = await db.userOrganization.findMany({
      where: {
        organizationId: session.organizationId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            createdAt: true,
            lastLoginAt: true,
            isActive: true,
          },
        },
      },
      orderBy: {
        user: { firstName: 'asc' },
      },
    });

    // Also get pending invitations
    const invitations = await db.invitation.findMany({
      where: {
        organizationId: session.organizationId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      users: userOrgs.map((uo) => ({
        id: uo.user.id,
        email: uo.user.email,
        firstName: uo.user.firstName,
        lastName: uo.user.lastName,
        role: uo.role,
        isActive: uo.isActive && uo.user.isActive,
        createdAt: uo.user.createdAt.toISOString(),
        lastLoginAt: uo.user.lastLoginAt?.toISOString() || null,
      })),
      pendingInvitations: invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        createdAt: inv.createdAt.toISOString(),
        expiresAt: inv.expiresAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[UsersAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to list users' },
      { status: 500 }
    );
  }
}
