/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

import WorkspaceSetupPage from './page';

describe('workspace setup page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows a recoverable error when its initial workspace request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

    render(<WorkspaceSetupPage />);

    expect(
      await screen.findByText('Unable to load workspace setup. Please refresh and try again.')
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
