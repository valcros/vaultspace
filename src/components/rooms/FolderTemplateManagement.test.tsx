/** @vitest-environment jsdom */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FolderTemplateManagement } from './FolderTemplateManagement';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('organization folder template management', () => {
  it('creates a reusable template through the organization endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init?.method) {
        return Promise.resolve(Response.json({ templates: [] }));
      }
      return Promise.resolve(
        Response.json({
          template: {
            id: 'org-new',
            revision: 'revision-1',
            name: 'Operations',
            description: '',
            category: 'custom',
            enabled: true,
            structure: { folders: [{ name: 'Legal', path: '/legal' }] },
          },
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FolderTemplateManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'New organization template' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name (required)' }), {
      target: { value: 'Operations' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Category (required)' }), {
      target: { value: 'custom' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Folder 1 name (required)' }), {
      target: { value: 'Legal' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Full path (required)' }), {
      target: { value: '/legal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save organization template' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/organization/folder-templates',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Operations',
          description: '',
          category: 'custom',
          enabled: true,
          structure: { folders: [{ name: 'Legal', path: '/legal' }] },
        }),
      })
    );
    expect(await screen.findByText(/Organization template saved/)).toBeTruthy();
  });

  it('preserves an edit after a revision conflict and offers reload', async () => {
    const template = {
      id: 'org-one',
      revision: 'revision-1',
      name: 'Operations',
      description: '',
      category: 'custom',
      enabled: true,
      structure: { folders: [{ name: 'Legal', path: '/legal' }] },
    };
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method
            ? Response.json({ error: 'changed' }, { status: 409 })
            : Response.json({ templates: [template] })
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<FolderTemplateManagement />);
    fireEvent.click(await screen.findByRole('button', { name: /Operations/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name (required)' }), {
      target: { value: 'Operations Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save organization template' }));
    expect(await screen.findByText(/Your draft is preserved/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Name (required)' })).toHaveAttribute(
      'value',
      'Operations Updated'
    );
    expect(screen.getByRole('button', { name: 'Reload latest template' })).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/organization/folder-templates/org-one',
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});
