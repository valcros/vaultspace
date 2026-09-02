/** @vitest-environment jsdom */

import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockRouter = { push: mockPush, refresh: mockRefresh };

let searchParams = new URLSearchParams('token=evt-token');

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => searchParams,
}));

import VerifyEmailPage from './page';

describe('email verification page (gesture-gated)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams('token=evt-token');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does NOT consume the token on load and shows a confirm button', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<VerifyEmailPage />);

    // The scanner-defeating invariant: rendering the page issues no POST.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('button', { name: /confirm my email address/i })
    ).toBeInTheDocument();
  });

  it('consumes the token only on click and redirects to workspace setup on success', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'verified' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<VerifyEmailPage />);
    fireEvent.click(screen.getByRole('button', { name: /confirm my email address/i }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/email verified/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/verify-email',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'evt-token' }) })
    );
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(mockPush).toHaveBeenCalledWith('/onboarding/workspace');
  });

  it('issues only one POST even on a double click', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'verified' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<VerifyEmailPage />);
    const button = await screen.findByRole('button', { name: /confirm my email address/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(await screen.findByText(/email verified/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows an error and no button when the token is missing', async () => {
    searchParams = new URLSearchParams('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<VerifyEmailPage />);

    expect(await screen.findByText(/missing its token/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm my email address/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
