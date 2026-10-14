/** @vitest-environment jsdom */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PreviewDialog } from './PreviewDialog';

const room = { name: 'Demo room', enableWatermark: false, watermarkTemplate: null };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockPreview(contentType: string, totalPages = 1) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(new Blob(['preview'], { type: contentType }), {
        headers: { 'content-type': contentType, 'x-total-pages': String(totalPages) },
      })
    )
  );
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:preview-page'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  return fetchMock;
}

describe('converted document preview', () => {
  it('fits a wide PNG slide within the dialog and preserves page navigation', async () => {
    const fetchMock = mockPreview('image/png', 2);
    render(
      <PreviewDialog
        open
        onOpenChange={vi.fn()}
        roomId="room-1"
        doc={{
          id: 'doc-1',
          name: 'deck.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }}
        room={room}
        onDownload={vi.fn()}
      />
    );

    const preview = await screen.findByRole('img', { name: 'Page 1 of 2: deck.pptx' });
    expect(preview.className).toContain('max-w-full');
    expect(screen.queryByTitle('deck.pptx')).toBeNull();
    let resolveNext!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveNext = resolve))
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('page=2')));
    expect(screen.queryByRole('img')).toBeNull();
    await act(async () => {
      resolveNext(
        new Response(new Blob(['next page'], { type: 'image/png' }), {
          headers: { 'content-type': 'image/png', 'x-total-pages': '2' },
        })
      );
    });
    expect(await screen.findByRole('img', { name: 'Page 2 of 2: deck.pptx' })).toBeTruthy();
  });

  it('keeps a converted PDF asset in an iframe', async () => {
    mockPreview('application/pdf');
    render(
      <PreviewDialog
        open
        onOpenChange={vi.fn()}
        roomId="room-1"
        doc={{
          id: 'doc-2',
          name: 'report.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }}
        room={room}
        onDownload={vi.fn()}
      />
    );

    expect(await screen.findByTitle('report.docx')).toHaveAttribute('src', 'blob:preview-page');
    expect(screen.queryByRole('img', { name: /report\.docx/ })).toBeNull();
  });

  it('offers retry when a converted preview request fails temporarily', async () => {
    const fetchMock = mockPreview('image/png');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Temporary failure' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    );
    render(
      <PreviewDialog
        open
        onOpenChange={vi.fn()}
        roomId="room-1"
        doc={{
          id: 'doc-3',
          name: 'deck.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }}
        room={room}
        onDownload={vi.fn()}
      />
    );

    expect(await screen.findByText(/Preview could not be loaded/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(await screen.findByRole('img', { name: 'Page 1 of 1: deck.pptx' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
