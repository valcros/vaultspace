'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Client-side org role context.
 *
 * The (admin) shell is shared by ADMIN and VIEWER org members. VIEWERs may view
 * rooms and documents but must not see admin controls (create room, invite,
 * share links, manage Q&A/checklist/calendar, users/groups/activity/messages).
 * This provider makes the authenticated org role available to client components
 * so they can hide admin-only affordances. It is defense-in-depth only: every
 * mutating admin API route also enforces authorization server-side.
 */

export type OrgRole = 'ADMIN' | 'VIEWER';

export interface Capabilities {
  canManageOrganizationSettings: boolean;
  canManageUsers: boolean;
  canAccessSysOp: boolean;
}

interface RoleContextValue {
  role: OrgRole;
  capabilities: Capabilities;
}

const viewerCapabilities: Capabilities = {
  canManageOrganizationSettings: false,
  canManageUsers: false,
  canAccessSysOp: false,
};

const RoleContext = React.createContext<RoleContextValue>({
  role: 'VIEWER',
  capabilities: viewerCapabilities,
});

export function RoleProvider({
  role,
  isPlatformOperator = false,
  children,
}: {
  role: OrgRole;
  isPlatformOperator?: boolean;
  children: React.ReactNode;
}) {
  const capabilities = React.useMemo<Capabilities>(
    () => ({
      canManageOrganizationSettings: role === 'ADMIN',
      canManageUsers: role === 'ADMIN',
      canAccessSysOp: isPlatformOperator,
    }),
    [isPlatformOperator, role]
  );

  return <RoleContext.Provider value={{ role, capabilities }}>{children}</RoleContext.Provider>;
}

/** Returns the authenticated org role. Defaults to the least-privileged 'VIEWER'. */
export function useRole(): OrgRole {
  return React.useContext(RoleContext).role;
}

/** Convenience: true when the authenticated org role is ADMIN. */
export function useIsAdmin(): boolean {
  return React.useContext(RoleContext).role === 'ADMIN';
}

/** Server-derived capabilities used only for navigation and UI affordances. */
export function useCapabilities(): Capabilities {
  return React.useContext(RoleContext).capabilities;
}

/**
 * Client-side guard for admin-only pages. Redirects VIEWERs to /dashboard.
 * Defense-in-depth for direct-URL access — the underlying admin APIs already
 * reject non-admins server-side. Returns true when the caller is an admin, so
 * a page can `if (!useRequireAdmin()) return null;` to avoid a content flash.
 */
export function useRequireAdmin(): boolean {
  const role = React.useContext(RoleContext).role;
  const router = useRouter();
  React.useEffect(() => {
    if (role !== 'ADMIN') {
      router.replace('/dashboard');
    }
  }, [role, router]);
  return role === 'ADMIN';
}
