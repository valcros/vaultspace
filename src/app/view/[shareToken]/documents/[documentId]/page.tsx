'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface DocumentInfo {
  id: string;
  name: string;
  mimeType: string;
  pageCount: number;
  previewUrl: string;
  downloadEnabled: boolean;
  watermarkText: string | null;
}

export default function ViewerDocumentPage() {
  const params = useParams();
  const router = useRouter();
  const shareToken = params['shareToken'] as string;
  const documentId = params['documentId'] as string;

  const [document, setDocument] = React.useState<DocumentInfo | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [zoom, setZoom] = React.useState(100);
  const [rotation, setRotation] = React.useState(0);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const viewerRef = React.useRef<HTMLDivElement>(null);

  const fetchDocument = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/view/${shareToken}/documents/${documentId}`);
      const data = await response.json();

      if (!response.ok) {
        router.push(`/view/${shareToken}/documents`);
        return;
      }

      setDocument(data.document);
    } catch (error) {
      console.error('Failed to fetch document:', error);
      router.push(`/view/${shareToken}/documents`);
    } finally {
      setIsLoading(false);
    }
  }, [shareToken, documentId, router]);

  React.useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  const handleZoomIn = () => {
    setZoom(Math.min(zoom + 25, 200));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom - 25, 50));
  };

  const handleRotate = () => {
    setRotation((rotation + 90) % 360);
  };

  const handlePrevPage = () => {
    setCurrentPage(Math.max(currentPage - 1, 1));
  };

  const handleNextPage = () => {
    if (document) {
      setCurrentPage(Math.min(currentPage + 1, document.pageCount));
    }
  };

  const handleFullscreen = () => {
    if (!isFullscreen && viewerRef.current) {
      viewerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else if (isFullscreen) {
      globalThis.document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  const handleDownload = () => {
    window.open(`/api/view/${shareToken}/documents/${documentId}/download`, '_blank');
  };

  const handleBack = () => {
    router.push(`/view/${shareToken}/documents`);
  };

  // Handle fullscreen change events
  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!globalThis.document.fullscreenElement);
    };

    globalThis.document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      globalThis.document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Handle keyboard navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setCurrentPage((prev) => Math.max(prev - 1, 1));
      } else if (e.key === 'ArrowRight') {
        if (document) {
          setCurrentPage((prev) => Math.min(prev + 1, document.pageCount));
        }
      } else if (e.key === 'Escape' && isFullscreen) {
        globalThis.document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [document, isFullscreen]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-900 flex flex-col">
        <div className="border-b border-neutral-700 bg-neutral-800">
          <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <Skeleton className="h-6 w-48 bg-neutral-700" />
            <Skeleton className="h-8 w-32 bg-neutral-700" />
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="w-[600px] h-[800px] bg-neutral-800" />
        </div>
      </div>
    );
  }

  if (!document) {
    return null;
  }

  return (
    <div ref={viewerRef} className="min-h-screen bg-neutral-900 flex flex-col">
      {/* Header */}
      <div className="border-b border-neutral-700 bg-neutral-800 sticky top-0 z-20">
        <div className="max-w-screen-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Left: Back & Title */}
            <div className="flex items-center gap-4 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="text-neutral-300 hover:text-white hover:bg-neutral-700"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div className="h-6 w-px bg-neutral-600" />
              <h1 className="text-white font-medium truncate">{document.name}</h1>
            </div>

            {/* Center: Page Navigation */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="text-neutral-300 hover:text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-neutral-300 text-sm min-w-[80px] text-center">
                {currentPage} / {document.pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNextPage}
                disabled={currentPage === document.pageCount}
                className="text-neutral-300 hover:text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Right: Controls */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleZoomOut}
                disabled={zoom <= 50}
                className="text-neutral-300 hover:text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-neutral-300 text-sm min-w-[50px] text-center">
                {zoom}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleZoomIn}
                disabled={zoom >= 200}
                className="text-neutral-300 hover:text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <div className="h-6 w-px bg-neutral-600 mx-2" />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRotate}
                className="text-neutral-300 hover:text-white hover:bg-neutral-700"
              >
                <RotateCw className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFullscreen}
                className="text-neutral-300 hover:text-white hover:bg-neutral-700"
              >
                {isFullscreen ? (
                  <X className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
              {document.downloadEnabled && (
                <>
                  <div className="h-6 w-px bg-neutral-600 mx-2" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownload}
                    className="text-neutral-300 hover:text-white hover:bg-neutral-700"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Document Viewer */}
      <div className="flex-1 overflow-auto p-8 flex items-start justify-center">
        <div
          className="relative bg-white shadow-2xl"
          style={{
            transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
            transformOrigin: 'top center',
            transition: 'transform 0.2s ease',
          }}
        >
          {/* Document Preview Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${document.previewUrl}?page=${currentPage}`}
            alt={`Page ${currentPage} of ${document.name}`}
            className="max-w-none"
            style={{ width: '800px' }}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
          />

          {/* Watermark Overlay */}
          {document.watermarkText && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
              <div
                className="text-4xl font-bold text-neutral-400/20 transform -rotate-45 whitespace-nowrap select-none"
                style={{
                  textShadow: '0 0 20px rgba(0,0,0,0.1)',
                }}
              >
                {Array(10)
                  .fill(document.watermarkText)
                  .map((text, i) => (
                    <div key={i} className="py-16">
                      {text}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-700 bg-neutral-800">
        <div className="max-w-screen-2xl mx-auto px-4 py-2 text-center text-xs text-neutral-500">
          Use arrow keys to navigate • Protected by VaultSpace
        </div>
      </div>
    </div>
  );
}
