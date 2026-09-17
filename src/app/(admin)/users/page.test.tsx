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

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) =>
      React.createElement(
        'select',
        {
          'aria-label': 'Role',
          value,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
            onValueChange(event.target.value),
        },
        children
      ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => children,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => children,
    SelectItem: ({ value }: { value: string; children: React.ReactNode }) =>
      React.createElement('option', { value }, value),
  };
});

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
let inviteRequests: Array<Record<string, unknown>> = [];
let returnViewerConflict = false;

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
  inviteRequests = [];
  returnViewerConflict = false;
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
      if (url === '/api/users/invite' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        inviteRequests.push(body);
        if (returnViewerConflict && body['replaceViewerAccess'] !== true) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: 'Viewer access already exists',
              code: 'VIEWER_ACCESS_REPLACEMENT_REQUIRED',
              conflict: {
                pendingViewerInvitationCount: 0,
                viewerLinkCount: 1,
                roomNames: ['Series A'],
              },
            }),
          } as Response;
        }
        return { ok: true, status: 201, json: async () => ({ invitation: {} }) } as Response;
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

  it('confirms before replacing viewer access with an admin invitation', async () => {
    returnViewerConflict = true;
    render(
      <RoleProvider role="ADMIN">
        <UsersPage />
      </RoleProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Invite User' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Email Address'), {
      target: { value: 'viewer@example.com' },
    });

    const roleSelect = within(dialog).getByRole('combobox');
    fireEvent.change(roleSelect, { target: { value: 'ADMIN' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send Invitation' }));

    expect(
      await within(dialog).findByText('This email already has Viewer access.')
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Affected room: Series A/)).toBeInTheDocument();
    expect(inviteRequests).toEqual([{ email: 'viewer@example.com', role: 'ADMIN', roomIds: [] }]);

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Replace Viewer Access and Invite Admin' })
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(inviteRequests).toEqual([
      { email: 'viewer@example.com', role: 'ADMIN', roomIds: [] },
      {
        email: 'viewer@example.com',
        role: 'ADMIN',
        roomIds: [],
        replaceViewerAccess: true,
      },
    ]);
  });
});
