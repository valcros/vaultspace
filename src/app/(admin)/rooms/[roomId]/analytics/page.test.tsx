/**
 * @vitest-environment jsdom
 *
 * Rendered UI acceptance test for the Analytics Correctness Fix.
 * One authenticated member and one share-link viewer must visibly appear in the
 * Room Analytics page, deduplicate to two rows, and show a unique-viewer total
 * of two, with access type and provenance rendered.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ roomId: 'room-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/rooms/room-1/analytics',
  useSearchParams: () => new URLSearchParams(),
}));

import RoomAnalyticsPage from './page';

const analyticsPayload = {
  summary: { totalDocuments: 1, totalViews: 12, uniqueViewers: 2, totalDownloads: 1 },
  auditReconciliation: {
    captureMode: 'SHADOW',
    operationalViewCount: 12,
    capturedViewEvents: 2,
    operationalDownloadCount: 1,
    capturedDownloadEvents: 0,
    viewDelta: 10,
    downloadDelta: 1,
    distinctViewers: 2,
    interpretation: 'Operational counters are a separate metric.',
  },
  topDocuments: [
    {
      id: 'doc-1',
      name: 'Deck.pdf',
      viewCount: 12,
      downloadCount: 1,
      lastViewedAt: null,
      createdAt: '2026-08-01T00:00:00Z',
    },
  ],
  recentViewers: [
    {
      email: 'mary@brightside.test',
      name: 'Mary Member',
      identityLabel: 'Account identity',
      accessType: 'member',
      provenance: 'native',
      auditStatus: 'shadow',
      timeSpent: null,
      lastActive: '2026-08-04T10:00:00Z',
    },
    {
      email: 'guest@partner.test',
      name: 'Guest Partner',
      identityLabel: 'Asserted email',
      accessType: 'share-link',
      provenance: 'inferred',
      auditStatus: 'inferred',
      timeSpent: 45,
      lastActive: '2026-08-04T09:00:00Z',
    },
  ],
  recentEvents: [],
  viewTimeline: [],
  period: { days: 30, startDate: '2026-07-06T00:00:00Z' },
};

const roomPayload = { room: { name: 'Series A Room' } };

beforeEach(() => {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/analytics') ? analyticsPayload : roomPayload;
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Room Analytics page — recent viewers rendering', () => {
  it('renders one member and one share-link viewer, deduplicated, with a unique total of two', async () => {
    render(<RoomAnalyticsPage />);

    // Wait for the async fetch + render to complete.
    await screen.findByText('Recent Viewers');

    // Exactly two viewer rows -> the member and the share-link viewer are
    // de-duplicated into distinct entries (no double-counting).
    const rows = screen.getAllByTestId('recent-viewer');
    expect(rows).toHaveLength(2);

    // Both viewers are visibly present.
    expect(screen.getByText('Mary Member')).toBeInTheDocument();
    expect(screen.getByText('Guest Partner')).toBeInTheDocument();

    // Per-row: member row shows Member; share-link row shows Share link.
    const memberRow = screen
      .getByText('Mary Member')
      .closest('[data-testid="recent-viewer"]') as HTMLElement;
    expect(within(memberRow).getByText('Member')).toBeInTheDocument();
    const guestRow = screen
      .getByText('Guest Partner')
      .closest('[data-testid="recent-viewer"]') as HTMLElement;
    expect(within(guestRow).getByText('Share link')).toBeInTheDocument();

    // Distinct-viewer total of two, kept separate from operational/captured counts.
    expect(screen.getByText(/Distinct viewers:\s*2/)).toBeInTheDocument();
    // Unique viewers summary card also reflects the merged distinct count.
    expect(screen.getByText(/2 distinct viewers/)).toBeInTheDocument();
  });
});
