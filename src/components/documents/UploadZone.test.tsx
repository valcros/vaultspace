/** @vitest-environment jsdom */
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { UploadZone } from './UploadZone';

describe('folder-preserving upload', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('reviews the original path and sends it with the file only after confirmation', async () => {
    const onComplete = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          preview: { fileCount: 1, newFolders: ['/Financials'], existingFolderCount: 0 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: [{ id: 'doc-1', name: 'a.pdf' }] }),
      });
    const file = new File(['content'], 'a.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Financials/a.pdf' });

    render(<UploadZone roomId="room-1" onUploadComplete={onComplete} />);
    fireEvent.change(screen.getByLabelText('Choose a folder to import'), {
      target: { files: [file] },
    });

    await screen.findByText('Import preview: 1 files, 1 new folders');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      parentFolderId: null,
      files: [{ name: 'a.pdf', size: 7, path: 'Financials/a.pdf' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 files' }));
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith([{ documentId: 'doc-1', name: 'a.pdf' }])
    );
    expect(screen.queryByRole('button', { name: 'Import 1 files' })).toBeNull();
    const formData = fetchMock.mock.calls[1]![1].body as FormData;
    expect(formData.get('path')).toBe('Financials/a.pdf');
    expect((formData.get('file') as File).name).toBe('a.pdf');
    expect(
      fetchMock.mock.calls.every((call) => call[0] === '/api/rooms/room-1/documents/import')
    ).toBe(true);
  });

  it('shows per-path depth errors and does not upload rejected selections', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: {
          message: 'One or more import paths exceed the maximum allowed depth of 3.',
          details: {
            rejections: [
              { sourcePath: 'A/B/C/D/a.pdf', reason: 'Folder path exceeds maximum depth' },
            ],
          },
        },
      }),
    });
    const file = new File(['x'], 'a.pdf');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'A/B/C/D/a.pdf' });

    render(<UploadZone roomId="room-1" />);
    fireEvent.change(screen.getByLabelText('Choose a folder to import'), {
      target: { files: [file] },
    });

    await screen.findByRole('alert');
    expect(screen.getByText(/A\/B\/C\/D\/a.pdf: Folder path exceeds maximum depth/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Import 1 files/ })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
