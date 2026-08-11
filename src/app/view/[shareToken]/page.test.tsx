/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };

vi.mock('next/navigation', () => ({
  useParams: () => ({ shareToken: 'share-token' }),
  useRouter: () => mockRouter,
}));

import ViewerAccessPage from './page';

const linkInfo = {
  id: 'link-1',
  name: 'Synthetic Link',
  roomName: 'Synthetic Room',
  organizationName: 'Synthetic Org',
  organizationLogo: null,
  brandColor: null,
  requiresPassword: false,
  requiresEmail: false,
  ndaRequired: false,
  ndaText: null,
  expiresAt: null,
  isActive: true,
};

describe('viewer link admission page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a server-side admission before redirecting a gate-free link', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ link: linkInfo }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ViewerAccessPage />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/view/share-token/documents'));
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/view/share-token/info');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/view/share-token/access',
      expect.objectContaining({ method: 'POST', body: '{}' })
    );
  });

  it('does not redirect when the atomic admission is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ link: linkInfo }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Link has reached maximum views' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<ViewerAccessPage />);

    expect(await screen.findByText('Link has reached maximum views')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('redirects an existing admitted session without consuming another admission', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ link: { ...linkInfo, alreadyAdmitted: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ViewerAccessPage />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/view/share-token/documents'));
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/view/share-token/access',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
