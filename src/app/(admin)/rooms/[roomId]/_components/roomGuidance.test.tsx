/** @vitest-environment jsdom */
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { CreateLinkDialog } from './CreateLinkDialog';
import { EditPropertiesDialog } from './EditPropertiesDialog';

describe('room guidance dialogs', () => {
  it('names the link permission control and explains a paused room grant', () => {
    render(
      <CreateLinkDialog
        open
        onOpenChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(false)}
        isCreating={false}
        roomDownloadsAllowed={false}
      />
    );

    const permission = screen.getByRole('combobox', { name: 'Permission Level' });
    const hint = document.getElementById('linkPermissionHelp');
    expect(permission.getAttribute('aria-describedby')).toBe(hint?.id);
    expect(hint?.textContent).toContain('Downloads require permission');
    fireEvent.click(permission);
    fireEvent.click(screen.getByRole('option', { name: 'View & Download' }));
    expect(hint?.textContent).toContain('Downloads are currently paused for this room');
    expect(screen.getByLabelText('Expiration Date (optional)')).toHaveAttribute(
      'aria-describedby',
      'linkExpiryHelp'
    );
  });

  it('names editable properties and states that stored expiry dates are inactive', () => {
    render(
      <EditPropertiesDialog
        doc={{
          id: 'doc-1',
          name: 'Example.pdf',
          tags: ['review'],
          category: null,
          expiresAt: '2026-11-01T00:00:00.000Z',
          expiryAction: 'DELETE',
        }}
        roomId="room-1"
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onSaveTags={vi.fn()}
      />
    );

    expect(screen.getByRole('combobox', { name: 'Category' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Tags' })).toHaveAttribute(
      'aria-describedby',
      'documentTagsHelp'
    );
    expect(screen.getByText(/Automatic document expiry is unavailable/)).toBeTruthy();
    expect(screen.queryByLabelText('Expiry Action')).toBeNull();
  });
});
