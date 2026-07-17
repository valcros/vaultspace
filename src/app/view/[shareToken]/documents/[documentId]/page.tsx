'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Clock,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
} from 'lucide-react';

import { WatermarkOverlay } from '@/components/documents/WatermarkOverlay';

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
  viewerEmail: string | null;
  viewerName: string | null;
}

interface DocumentVersion {
  id: string;
  versionNumber: number;
  size: number;
  createdAt: string;
  isCurrent: boolean;
  pageCount: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  const [versions, setVersions] = React.useState<DocumentVersion[] | null>(null);
  const [showVersionPanel, setShowVersionPanel] = React.useState(false);
  const [activeVersionId, setActiveVersionId] = React.useState<string | null>(null);
  const [activeTotalPages, setActiveTotalPages] = React.useState<number | null>(null);
  const viewerRef = React.useRef<HTMLDivElement>(null);
  const touchStartRef = React.useRef<{ x: number; y: number; dist: number } | null>(null);

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

  // Silently probe version history -- shows the History button only when the
  // room has allowViewerVersionHistory enabled (403 = feature off, no button).
  React.useEffect(() => {
    fetch(`/api/view/${shareToken}/documents/${documentId}/versions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { versions?: DocumentVersion[] } | null) => {
        if (data?.versions && data.versions.length > 1) {
          setVersions(data.versions);
        }
      })
      .catch(() => {});
  }, [shareToken, documentId]);

  const handleZoomIn = () => {
    setZoom(Math.min(zoom + 25, 200));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom - 25, 50));
  };

  const handleRotate = () => {
    setRotation((rotation + 90) % 360);
  };

  // Page count for the currently-displayed version (historical or current)
  const effectivePageCount =
    activeVersionId && activeTotalPages !== null ? activeTotalPages : (document?.pageCount ?? 1);

  // Preview URL — pass versionId when viewing a historical version
  const previewSrc = document
    ? `${document.previewUrl}?page=${currentPage}${activeVersionId ? `&versionId=${activeVersionId}` : ''}`
    : '';

  const handleSwitchVersion = React.useCallback((version: DocumentVersion) => {
    if (version.isCurrent) {
      setActiveVersionId(null);
      setActiveTotalPages(null);
    } else {
      setActiveVersionId(version.id);
      setActiveTotalPages(version.pageCount > 0 ? version.pageCount : 1);
    }
    setCurrentPage(1);
    setShowVersionPanel(false);
  }, []);

  const handleReturnToCurrent = React.useCallback(() => {
    setActiveVersionId(null);
    setActiveTotalPages(null);
    setCurrentPage(1);
  }, []);

  const handlePrevPage = React.useCallback(() => {
    setCurrentPage((page) => Math.max(page - 1, 1));
  }, []);

  const handleNextPage = React.useCallback(() => {
    setCurrentPage((page) => Math.min(page + 1, effectivePageCount));
  }, [effectivePageCount]);

  // Touch gesture handlers for mobile
  const handleTouchStart = React.useCallback((e: React.TouchEvent) => {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length === 1 && t0) {
      touchStartRef.current = { x: t0.clientX, y: t0.clientY, dist: 0 };
    } else if (e.touches.length === 2 && t0 && t1) {
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      touchStartRef.current = { x: 0, y: 0, dist: Math.sqrt(dx * dx + dy * dy) };
    }
  }, []);

  const handleTouchEnd = React.useCallback(
    (e: React.TouchEvent) => {
      const ct = e.changedTouches[0];
      if (!touchStartRef.current || !document || !ct) {
        return;
      }
      if (e.changedTouches.length === 1 && touchStartRef.current.dist === 0) {
        const dx = ct.clientX - touchStartRef.current.x;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(ct.clientY - touchStartRef.current.y);
        // Swipe horizontally (min 50px, more horizontal than vertical)
        if (absDx > 50 && absDx > absDy * 1.5) {
          if (dx > 0) {
            handlePrevPage();
          } else {
            handleNextPage();
          }
        }
      }
      touchStartRef.current = null;
    },
    [document, handlePrevPage, handleNextPage]
  );

  const handleTouchMove = React.useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartRef.current && touchStartRef.current.dist > 0) {
      const t0 = e.touches[0]!;
      const t1 = e.touches[1]!;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const scale = newDist / touchStartRef.current.dist;
      if (scale > 1.2) {
        setZoom((z) => Math.min(z + 25, 200));
        touchStartRef.current.dist = newDist;
      } else if (scale < 0.8) {
        setZoom((z) => Math.max(z - 25, 50));
        touchStartRef.current.dist = newDist;
      }
    }
  }, []);

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
        setCurrentPage((prev) => Math.min(prev + 1, effectivePageCount));
      } else if (e.key === 'Escape' && isFullscreen) {
        globalThis.document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [document, isFullscreen, effectivePageCount]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-neutral-900">
        <div className="border-b border-slate-700 bg-slate-950/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-3">
            <Skeleton className="h-6 w-48 bg-slate-800" />
            <Skeleton className="h-8 w-32 bg-slate-800" />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Skeleton className="h-[80vh] w-full max-w-[600px] bg-slate-900" />
        </div>
      </div>
    );
  }

  if (!document) {
    return null;
  }

  return (
    <div ref={viewerRef} className="flex min-h-screen flex-col bg-neutral-900">
      {/* Header */}
      <div className="bg-slate-950/88 sticky top-0 z-20 border-b border-slate-700 backdrop-blur-xl">
        <div className="mx-auto max-w-screen-2xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Left: Back & Title */}
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white"
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Back</span>
              </Button>
              <div className="hidden h-6 w-px bg-slate-700 sm:block" />
              <h1 className="max-w-[120px] truncate font-medium text-white sm:max-w-none">
                {document.name}
              </h1>
            </div>

            {/* Center: Page Navigation */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[80px] text-center text-sm text-slate-300">
                {currentPage} / {effectivePageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNextPage}
                disabled={currentPage === effectivePageCount}
                className="rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Right: Controls */}
            <div className="flex items-center gap-1">
              {/* Zoom controls hidden on mobile */}
              <div className="hidden items-center gap-1 sm:flex">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomOut}
                  disabled={zoom <= 50}
                  className="rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                  aria-label="Zoom out"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="min-w-[50px] text-center text-sm text-slate-300">{zoom}%</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomIn}
                  disabled={zoom >= 200}
                  className="rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                  aria-label="Zoom in"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <div className="mx-2 h-6 w-px bg-slate-700" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRotate}
                  className="rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white"
                  aria-label="Rotate"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFullscreen}
                className="rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white"
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullscreen ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              {document.downloadEnabled && (
                <>
                  <div className="mx-2 h-6 w-px bg-slate-700" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownload}
                    className="rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </>
              )}
              {versions && (
                <>
                  <div className="mx-2 h-6 w-px bg-slate-700" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowVersionPanel((v) => !v)}
                    className="rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white"
                    aria-label="Version history"
                  >
                    <Clock className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">History</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Historical version banner */}
      {activeVersionId && (
        <div className="z-10 flex items-center justify-center gap-3 bg-amber-600/20 px-4 py-2 text-sm text-amber-300">
          <span>
            Viewing v{versions?.find((v) => v.id === activeVersionId)?.versionNumber} — this is not
            the current version
          </span>
          <button
            onClick={handleReturnToCurrent}
            className="rounded-lg bg-amber-500/20 px-3 py-0.5 text-xs font-medium text-amber-200 hover:bg-amber-500/30"
          >
            Back to current
          </button>
        </div>
      )}

      {/* Document Viewer */}
      <div
        className="flex flex-1 items-start justify-center overflow-auto p-4 sm:p-8"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        <div className="rounded-xl border border-neutral-200 bg-neutral-100 p-3 shadow-md dark:border-neutral-700 dark:bg-neutral-800 sm:p-4">
          <div
            className="relative overflow-hidden rounded-[1.1rem] bg-white shadow-2xl"
            style={{
              transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
              transformOrigin: 'top center',
              transition: 'transform 0.2s ease',
            }}
          >
            {/* Document Preview Image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc}
              alt={`Page ${currentPage} of ${document.name}`}
              className="w-full max-w-[800px]"
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
            />

            {/* Watermark Overlay (F023) */}
            {document.watermarkText && (
              <WatermarkOverlay
                template={document.watermarkText}
                viewerEmail={document.viewerEmail ?? undefined}
                viewerName={document.viewerName ?? undefined}
              />
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-slate-950/82 border-t border-slate-700">
        <div className="mx-auto max-w-screen-2xl px-4 py-2 text-center text-xs text-slate-400">
          Use arrow keys to navigate • Protected by VaultSpace
        </div>
      </div>

      {/* Version History Panel */}
      {showVersionPanel && versions && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-80 flex-col border-l border-slate-700 bg-slate-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Version History</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowVersionPanel(false)}
              className="rounded-xl text-slate-400 hover:text-white"
              aria-label="Close version history"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {versions.map((v) => {
              const isActive = activeVersionId === v.id || (v.isCurrent && !activeVersionId);
              return (
                <div
                  key={v.id}
                  className={`space-y-1.5 rounded-xl border p-3 ${isActive ? 'border-blue-600 bg-blue-950/40' : 'border-slate-800'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">v{v.versionNumber}</span>
                    <div className="flex items-center gap-1.5">
                      {v.isCurrent && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                          Current
                        </span>
                      )}
                      {!isActive && (
                        <button
                          onClick={() => handleSwitchVersion(v)}
                          className="rounded-lg bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-200 hover:bg-slate-600"
                        >
                          View
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    {new Date(v.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatSize(v.size)}
                    {v.pageCount > 0 && ` · ${v.pageCount}p`}
                  </p>
                  {document.downloadEnabled && (
                    <a
                      href={`/api/view/${shareToken}/documents/${documentId}/download?versionId=${v.id}`}
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                      download
                    >
                      <Download className="h-3 w-3" />
                      Download v{v.versionNumber}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
