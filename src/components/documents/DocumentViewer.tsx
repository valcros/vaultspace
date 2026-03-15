'use client';

/**
 * In-Browser Document Viewer Component (F008)
 *
 * Renders document previews using react-pdf for PDFs
 * and images for other preview formats.
 * Mobile-responsive with touch support (F034).
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentViewerProps {
  documentId: string;
  versionId: string;
  previewUrl: string;
  mimeType: string;
  documentName: string;
  pageCount?: number;
  allowDownload?: boolean;
  onPageChange?: (page: number) => void;
  onViewComplete?: () => void;
  className?: string;
}

interface ViewerState {
  numPages: number;
  currentPage: number;
  scale: number;
  isLoading: boolean;
  error: string | null;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

export function DocumentViewer({
  documentId: _documentId,
  versionId: _versionId,
  previewUrl,
  mimeType,
  documentName,
  pageCount: initialPageCount,
  allowDownload = true,
  onPageChange,
  onViewComplete,
  className = '',
}: DocumentViewerProps) {
  const [state, setState] = useState<ViewerState>({
    numPages: initialPageCount ?? 0,
    currentPage: 1,
    scale: 1,
    isLoading: true,
    error: null,
  });

  const isPdf = mimeType === 'application/pdf';
  const isImage = mimeType.startsWith('image/');

  // Handle PDF load success
  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setState((prev) => ({
        ...prev,
        numPages,
        isLoading: false,
        error: null,
      }));
    },
    []
  );

  // Handle PDF load error
  const onDocumentLoadError = useCallback((error: Error) => {
    console.error('PDF load error:', error);
    setState((prev) => ({
      ...prev,
      isLoading: false,
      error: 'Failed to load document preview',
    }));
  }, []);

  // Page navigation
  const goToPage = useCallback(
    (page: number) => {
      const newPage = Math.max(1, Math.min(page, state.numPages));
      setState((prev) => ({ ...prev, currentPage: newPage }));
      onPageChange?.(newPage);
    },
    [state.numPages, onPageChange]
  );

  const nextPage = useCallback(() => {
    goToPage(state.currentPage + 1);
  }, [state.currentPage, goToPage]);

  const prevPage = useCallback(() => {
    goToPage(state.currentPage - 1);
  }, [state.currentPage, goToPage]);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setState((prev) => ({
      ...prev,
      scale: Math.min(prev.scale + SCALE_STEP, MAX_SCALE),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setState((prev) => ({
      ...prev,
      scale: Math.max(prev.scale - SCALE_STEP, MIN_SCALE),
    }));
  }, []);

  const resetZoom = useCallback(() => {
    setState((prev) => ({ ...prev, scale: 1 }));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          prevPage();
          break;
        case 'ArrowRight':
          nextPage();
          break;
        case '+':
        case '=':
          zoomIn();
          break;
        case '-':
          zoomOut();
          break;
        case '0':
          resetZoom();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextPage, prevPage, zoomIn, zoomOut, resetZoom]);

  // Track view completion
  useEffect(() => {
    if (!state.isLoading && state.numPages > 0 && state.currentPage === state.numPages) {
      onViewComplete?.();
    }
  }, [state.isLoading, state.numPages, state.currentPage, onViewComplete]);

  // Page input
  const [pageInput, setPageInput] = useState('');

  const handlePageInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  }, []);

  const handlePageInputSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const page = parseInt(pageInput, 10);
      if (!isNaN(page)) {
        goToPage(page);
      }
      setPageInput('');
    },
    [pageInput, goToPage]
  );

  // Render content based on type
  const renderContent = useMemo(() => {
    if (state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <svg
            className="w-16 h-16 text-gray-400 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="text-gray-600">{state.error}</p>
        </div>
      );
    }

    if (isPdf) {
      return (
        <Document
          file={previewUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          }
          className="flex justify-center"
        >
          <Page
            pageNumber={state.currentPage}
            scale={state.scale}
            className="shadow-lg"
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      );
    }

    if (isImage) {
      return (
        <div className="flex justify-center items-center h-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={documentName}
            className="max-w-full max-h-full object-contain"
            style={{ transform: `scale(${state.scale})` }}
            onLoad={() => setState((prev) => ({ ...prev, isLoading: false, numPages: 1 }))}
            onError={() =>
              setState((prev) => ({
                ...prev,
                isLoading: false,
                error: 'Failed to load image',
              }))
            }
          />
        </div>
      );
    }

    // Unsupported format
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <svg
          className="w-16 h-16 text-gray-400 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-gray-600 mb-4">Preview not available for this file type</p>
        {allowDownload && (
          <a
            href={previewUrl}
            download={documentName}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
          >
            Download File
          </a>
        )}
      </div>
    );
  }, [
    state.error,
    state.currentPage,
    state.scale,
    isPdf,
    isImage,
    previewUrl,
    documentName,
    allowDownload,
    onDocumentLoadSuccess,
    onDocumentLoadError,
  ]);

  return (
    <div className={`flex flex-col h-full bg-gray-100 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b shadow-sm">
        <div className="flex items-center space-x-2">
          <h2 className="text-sm font-medium text-gray-700 truncate max-w-xs">
            {documentName}
          </h2>
        </div>

        <div className="flex items-center space-x-4">
          {/* Page navigation */}
          {state.numPages > 1 && (
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={prevPage}
                disabled={state.currentPage <= 1}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <form onSubmit={handlePageInputSubmit} className="flex items-center">
                <input
                  type="text"
                  value={pageInput || state.currentPage}
                  onChange={handlePageInputChange}
                  onFocus={() => setPageInput(String(state.currentPage))}
                  onBlur={() => setPageInput('')}
                  className="w-12 text-center text-sm border rounded px-1 py-0.5"
                  aria-label="Current page"
                />
                <span className="text-sm text-gray-500 mx-1">/ {state.numPages}</span>
              </form>

              <button
                type="button"
                onClick={nextPage}
                disabled={state.currentPage >= state.numPages}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* Zoom controls */}
          <div className="flex items-center space-x-1 border-l pl-4">
            <button
              type="button"
              onClick={zoomOut}
              disabled={state.scale <= MIN_SCALE}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Zoom out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>

            <button
              type="button"
              onClick={resetZoom}
              className="text-sm text-gray-600 px-2 hover:bg-gray-100 rounded"
            >
              {Math.round(state.scale * 100)}%
            </button>

            <button
              type="button"
              onClick={zoomIn}
              disabled={state.scale >= MAX_SCALE}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Zoom in"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Download button */}
          {allowDownload && (
            <a
              href={previewUrl}
              download={documentName}
              className="p-1 rounded hover:bg-gray-100 border-l pl-4"
              aria-label="Download"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </a>
          )}
        </div>
      </div>

      {/* Document content */}
      <div className="flex-1 overflow-auto p-4">{renderContent}</div>

      {/* Loading overlay */}
      {state.isLoading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
        </div>
      )}
    </div>
  );
}
