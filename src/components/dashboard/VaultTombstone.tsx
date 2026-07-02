'use client';

import * as React from 'react';

const VISIT_COUNT_KEY = 'vaultspace:landing-visits';
const FULL_TOMBSTONE_VISITS = 3;

interface VaultTombstoneProps {
  roomCount: number;
  documentCount: number;
  linkCount: number;
}

function useLandingVisitCount(): number {
  // Render the compact form on the server/first paint and upgrade after
  // hydration; a flash of the full plaque for veteran users reads worse than
  // a late upgrade for new ones.
  const [visits, setVisits] = React.useState<number>(FULL_TOMBSTONE_VISITS + 1);

  React.useEffect(() => {
    try {
      const count = Number(window.localStorage.getItem(VISIT_COUNT_KEY) ?? '0') + 1;
      window.localStorage.setItem(VISIT_COUNT_KEY, String(count));
      setVisits(count);
    } catch {
      // Storage unavailable: keep the compact form.
    }
  }, []);

  return visits;
}

/**
 * The landing's reason-for-being element, in the form finance already knows:
 * a deal tombstone. Square corners are deliberate (the one sanctioned
 * exception to radius discipline; tombstones are square). Early visits get
 * the full plaque; returning users get a one-line identity strip so live
 * work stays the page's headline.
 */
export function VaultTombstone({ roomCount, documentCount, linkCount }: VaultTombstoneProps) {
  const visits = useLandingVisitCount();

  const stats = `${roomCount} ${roomCount === 1 ? 'room' : 'rooms'} · ${documentCount} ${
    documentCount === 1 ? 'document' : 'documents'
  } · ${linkCount} shared ${linkCount === 1 ? 'link' : 'links'}`;

  if (visits > FULL_TOMBSTONE_VISITS) {
    return (
      <div className="border-y border-neutral-200 py-2.5 text-center dark:border-neutral-700">
        <p className="text-xs font-semibold uppercase tabular-nums tracking-[0.35em] text-neutral-500 dark:text-neutral-400">
          VaultSpace <span aria-hidden="true">·</span> {stats}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl border-2 border-slate-900 bg-white px-8 py-6 text-center dark:border-slate-200 dark:bg-slate-900">
      <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-neutral-500 dark:text-neutral-400">
        VaultSpace
      </p>
      <div className="mx-auto mt-3 border-t border-slate-300 dark:border-slate-600" />
      <p className="mt-4 font-display text-xl font-medium leading-snug text-slate-900 dark:text-slate-100">
        A secure data room for your most sensitive documents. Sealed, tracked, and shared on your
        terms.
      </p>
      <div className="mx-auto mt-4 border-t border-slate-300 dark:border-slate-600" />
      <p className="mt-3 text-sm tabular-nums text-neutral-600 dark:text-neutral-300">{stats}</p>
    </div>
  );
}
