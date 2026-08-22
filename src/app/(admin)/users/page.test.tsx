/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the Users-table action lifecycle. Saving an edit
 * refreshes the rows, so row actions must remain immediately usable without a
 * browser refresh.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { RoleProvider } from '@/components/layout/role-provider';
import UsersPage from './page';

let user = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'VIEWER' as const,
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

beforeEach(() => {
  user = {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    role: 'VIEWER',
    isActive: true,
    lastLoginAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/users' && init?.method === 'PATCH') {
        return { ok: false, json: async () => ({ error: 'Unexpected endpoint' }) } as Response;
      }
      if (url === '/api/users') {
        return {
          ok: true,
          json: async () => ({ users: [user], pendingInvitations: [], viewerLinkInvites: [] }),
        } as Response;
      }
      if (url === '/api/rooms?status=ACTIVE&limit=100') {
        return { ok: true, json: async () => ({ rooms: [] }) } as Response;
      }
      if (url === '/api/users/user-1/room-access') {
        return { ok: true, json: async () => ({ rooms: [] }) } as Response;
      }
      if (url === '/api/users/user-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        user = { ...user, ...body };
        return { ok: true, json: async () => ({}) } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Users page row actions', () => {
  it('keeps edit and secondary actions usable after an edit saves and refreshes rows', async () => {
    render(
      <RoleProvider role="ADMIN">
        <UsersPage />
      </RoleProvider>
    );

    const editButton = await screen.findByRole('button', { name: 'Edit Ada Lovelace' });
    fireEvent.click(editButton);

    const dialog = await screen.findByRole('dialog');
    const firstName = within(dialog).getByLabelText('First name');
    fireEvent.change(firstName, { target: { value: 'Augusta' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const refreshedEditButton = await screen.findByRole('button', {
      name: 'Edit Augusta Lovelace',
    });
    fireEvent.click(refreshedEditButton);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const moreActions = await screen.findByRole('button', {
      name: 'More actions for Augusta Lovelace',
    });
    moreActions.focus();
    fireEvent.keyDown(moreActions, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitem', { name: 'Send Email' })).toBeInTheDocument();
  });
});
