'use client';

/**
 * Dock context-actions plumbing.
 *
 * Pages can publish a small set of "things you can do here" into the floating
 * dock, alongside the persistent global navigation. The contract is:
 *
 *   - Global nav (Dashboard, Rooms, Users, …) is owned by DockShell and never
 *     changes per page. Users always know where their map of the app is.
 *   - Quick actions (Search, Create Room) are dock-scoped utility commands.
 *   - Context actions are *resource-scoped commands* — e.g. on a room page,
 *     "Upload", "New Folder", "Invite Member", "Create Link". They appear
 *     between the global nav and the quick actions, separated visually so
 *     the user can tell what's permanent vs. temporary.
 *
 * Pages register actions with `useDockActions(actions)`. The hook clears
 * the actions on unmount, so navigating away automatically resets the dock
 * to its base state.
 */

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface DockContextAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Optional small numeric badge rendered on the icon */
  badge?: number;
  /** Optional disabled state, e.g. while a resource is loading */
  disabled?: boolean;
}

interface DockActionsContextValue {
  actions: DockContextAction[];
  setActions: (actions: DockContextAction[]) => void;
}

const DockActionsContext = React.createContext<DockActionsContextValue | undefined>(undefined);

export function DockActionsProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActions] = React.useState<DockContextAction[]>([]);

  const value = React.useMemo<DockActionsContextValue>(() => ({ actions, setActions }), [actions]);

  return <DockActionsContext.Provider value={value}>{children}</DockActionsContext.Provider>;
}

/** Read the currently-published actions. DockShell uses this to render them. */
export function useDockContextActions(): DockContextAction[] {
  const ctx = React.useContext(DockActionsContext);
  return ctx?.actions ?? [];
}

/**
 * Page-side hook: publish actions while the page is mounted.
 * Pass a stable array (memoized or from a reducer) to avoid churn.
 */
export function useDockActions(actions: DockContextAction[] | null): void {
  const ctx = React.useContext(DockActionsContext);

  React.useEffect(() => {
    if (!ctx) {
      return;
    }
    ctx.setActions(actions ?? []);
    return () => ctx.setActions([]);
    // We intentionally only re-run when the actions array identity changes;
    // pages are expected to memoize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);
}
