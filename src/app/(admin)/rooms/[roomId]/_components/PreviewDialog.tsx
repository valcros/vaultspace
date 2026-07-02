'use client';

import * as React from 'react';
import { FileText, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TextPreviewRenderer } from '@/components/documents/TextPreviewRenderer';
import { WatermarkOverlay } from '@/components/documents/WatermarkOverlay';

// Types that can be previewed (inline or via client-side renderer)
// All types we can preview — inline, via Gotenberg conversion, or client-side rendering
const PREVIEWABLE_TYPES = [
  // Inline (served directly)
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/svg+xml',
  // Client-side rendered
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'text/yaml',
  'text/xml',
  'application/json',
  'application/xml',
  // Gotenberg conversion (office formats → PDF)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
  'application/msword', // DOC
  'application/vnd.ms-excel', // XLS
  'application/vnd.ms-powerpoint', // PPT
  'application/vnd.oasis.opendocument.text', // ODT
  'application/vnd.oasis.opendocument.spreadsheet', // ODS
  'application/vnd.oasis.opendocument.presentation', // ODP
  'application/vnd.oasis.opendocument.graphics', // ODG
  'application/vnd.ms-visio.drawing.main+xml', // VSDX
  'application/vnd.visio', // VSD
  'application/rtf',
  'application/epub+zip',
];

/** The subset of the room page's Document shape the preview reads. */
export interface PreviewDocument {
  id: string;
  name: string;
  mimeType: string;
}

/** The subset of the room page's Room shape the watermark overlay reads. */
export interface PreviewRoom {
  name: string;
  enableWatermark: boolean;
  watermarkTemplate: string | null;
}

export interface PreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  /** Document being previewed; set by the page before opening. */
  doc: PreviewDocument | null;
  room: PreviewRoom | null;
  /** Downloads the current document (page-level handler). */
  onDownload: () => void;
}

export function PreviewDialog({
  open,
  onOpenChange,
  roomId,
  doc,
  room,
  onDownload,
}: PreviewDialogProps) {
  // The preview URL / error derive purely from the document: previewable
  // types stream from the room preview endpoint, everything else shows the
  // download fallback (same logic the page-level handlePreview used to run).
  const previewUrl =
    doc && PREVIEWABLE_TYPES.includes(doc.mimeType)
      ? `/api/rooms/${roomId}/documents/${doc.id}/preview`
      : null;
  const previewError =
    doc && !PREVIEWABLE_TYPES.includes(doc.mimeType)
      ? 'Preview not available for this file type. Use download instead.'
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[95vw] max-w-6xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{doc?.name}</DialogTitle>
        </DialogHeader>
        <div className="relative h-[78vh] overflow-auto">
          {room?.enableWatermark && (
            <WatermarkOverlay
              template={room.watermarkTemplate || undefined}
              viewerEmail={undefined}
              viewerName="Admin Preview"
              roomName={room.name}
            />
          )}
          {previewError ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <FileText className="mb-4 h-16 w-16 text-neutral-300" />
              <p className="mb-4 text-neutral-500">{previewError}</p>
              {doc && (
                <Button onClick={onDownload}>
                  <Download className="mr-2 h-4 w-4" />
                  Download Instead
                </Button>
              )}
            </div>
          ) : previewUrl ? (
            doc?.mimeType === 'application/pdf' ? (
              <iframe src={previewUrl} className="h-full w-full border-0" title={doc?.name} />
            ) : doc?.mimeType.startsWith('image/') && doc?.mimeType !== 'image/svg+xml' ? (
              <div className="flex h-full items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt={doc?.name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : doc?.mimeType.startsWith('text/') ||
              doc?.mimeType === 'application/json' ||
              doc?.mimeType === 'application/xml' ||
              doc?.mimeType === 'image/svg+xml' ? (
              <TextPreviewFetcher
                url={previewUrl}
                mimeType={doc?.mimeType ?? 'text/plain'}
                fileName={doc?.name ?? 'file'}
              />
            ) : (
              <ConvertedPreview
                url={previewUrl}
                name={doc?.name ?? 'file'}
                onDownload={onDownload}
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
                <p className="text-neutral-500">Loading preview...</p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          {doc && (
            <Button variant="outline" onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Fetches a converted preview (e.g. PDF from Gotenberg) via blob URL.
 * Shows error UI if the server returns 404 or a JSON error response.
 */
function ConvertedPreview({
  url,
  name,
  onDownload,
}: {
  url: string;
  name: string;
  onDownload: () => void;
}) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetch(url)
      .then(async (res) => {
        if (cancelled) {
          return;
        }
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || ct.startsWith('application/json')) {
          setError(true);
          return;
        }
        const blob = await res.blob();
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <FileText className="mb-4 h-16 w-16 text-neutral-300" />
        <p className="mb-4 text-neutral-500">Preview not available for this file type</p>
        <Button onClick={onDownload}>
          <Download className="mr-2 h-4 w-4" />
          Download Instead
        </Button>
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  return <iframe src={blobUrl} className="h-full w-full border-0" title={name} />;
}

/**
 * Fetches text content from a URL then renders via TextPreviewRenderer
 */
function TextPreviewFetcher({
  url,
  mimeType,
  fileName,
}: {
  url: string;
  mimeType: string;
  fileName: string;
}) {
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error('Failed to load');
        }
        // Belt-and-suspenders: if server returns JSON but we expected a text file, treat as error
        const ct = res.headers.get('content-type') || '';
        if (ct.startsWith('application/json') && mimeType !== 'application/json') {
          throw new Error('Preview not available');
        }
        return res.text();
      })
      .then(setContent)
      .catch((err) => setError(err.message));
  }, [url, mimeType]);

  if (error) {
    return <div className="flex h-full items-center justify-center text-neutral-500">{error}</div>;
  }

  if (content === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  return <TextPreviewRenderer content={content} mimeType={mimeType} fileName={fileName} />;
}
