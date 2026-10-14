/** @vitest-environment jsdom */
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { StarterFolderPicker, type StarterFolderSelection } from './StarterFolderPicker';

function Harness() {
  const [selection, setSelection] = React.useState<StarterFolderSelection>({
    selectedFolderPaths: [],
    additionalFolders: [],
  });
  return (
    <>
      <StarterFolderPicker
        idPrefix="test-room"
        value={selection}
        onChange={setSelection}
        allowAdditionalFolders
      />
      <output data-testid="selection">{JSON.stringify(selection)}</output>
    </>
  );
}

describe('room creation folder picker', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          templates: [
            {
              id: 'test-template',
              revision: 'revision-1',
              name: 'Investor Data Room',
              description: 'Test structure',
              structure: {
                folders: [
                  { name: 'Financials', path: '/financials' },
                  { name: 'Historic', path: '/financials/historic' },
                ],
              },
            },
          ],
        }),
      })
    );
  });

  it('previews nested additions and removes custom descendants with their parent', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('radio', { name: /Investor Data Room/ }));

    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: '2026 Plans' } });
    fireEvent.change(screen.getByLabelText('Inside'), { target: { value: '/financials' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    expect(screen.getByTestId('selection').textContent).toContain('"parentPath":"/financials"');
    expect(screen.getByText('2026 Plans (room-specific)')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Board Drafts' } });
    fireEvent.change(screen.getByLabelText('Inside'), {
      target: { value: '/financials/2026 Plans' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));

    const preview = screen.getByRole('list', { name: 'Folder tree preview' });
    expect(within(preview).getByText('Board Drafts (room-specific)')).toBeTruthy();
    expect(within(preview).getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2026 Plans and its subfolders' }));
    expect(screen.getByTestId('selection').textContent).not.toContain('Board Drafts');
    expect(within(preview).getAllByRole('listitem')).toHaveLength(2);

    // Removing a template parent also removes room-specific children below it.
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: '2026 Plans' } });
    fireEvent.change(screen.getByLabelText('Inside'), { target: { value: '/financials' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Financials' }));
    await waitFor(() => {
      expect(screen.getByTestId('selection').textContent).not.toContain('2026 Plans');
    });
  });
});
