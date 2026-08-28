/** @vitest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react';
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

  it('consumes the token only on click and redirects on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'verified' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<VerifyEmailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /confirm my email address/i }));

    // Reaching the verified screen proves the POST fired and succeeded; the
    // redirect itself is behind a 1.2s delay and is not asserted here.
    expect(await screen.findByText(/email verified/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/verify-email',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'evt-token' }) })
    );
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
