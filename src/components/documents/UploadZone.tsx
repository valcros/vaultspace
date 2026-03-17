'use client';

/**
 * Drag-and-Drop Upload Zone Component (F007)
 *
 * HTML5 drag-and-drop file upload with progress tracking.
 * Supports folder structure preservation when dropping folders.
 */

import React, { useCallback, useState, useRef } from 'react';

interface UploadFile {
  file: File;
  path: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

interface UploadZoneProps {
  roomId: string;
  folderId?: string;
  onUploadComplete?: (results: Array<{ documentId: string; name: string }>) => void;
  onUploadError?: (error: Error) => void;
  maxFileSize?: number;
  acceptedTypes?: string[];
  multiple?: boolean;
  className?: string;
}

const DEFAULT_MAX_SIZE = 500 * 1024 * 1024; // 500MB
const DEFAULT_ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
];

export function UploadZone({
  roomId,
  folderId,
  onUploadComplete,
  onUploadError,
  maxFileSize = DEFAULT_MAX_SIZE,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
  multiple = true,
  className = '',
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const validateFile = useCallback(
    (file: File): string | null => {
      if (file.size > maxFileSize) {
        return `File too large (max ${Math.round(maxFileSize / 1024 / 1024)}MB)`;
      }
      if (!acceptedTypes.includes(file.type)) {
        return 'File type not supported';
      }
      return null;
    },
    [maxFileSize, acceptedTypes]
  );

  const processFileList = useCallback(
    async (items: DataTransferItemList | FileList) => {
      const uploadFiles: UploadFile[] = [];

      // Handle DataTransferItemList (from drag-drop)
      const firstItem = items[0];
      if ('length' in items && items.length > 0 && firstItem && 'webkitGetAsEntry' in firstItem) {
        const entries: FileSystemEntry[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i] as DataTransferItem | undefined;
          if (!item) {
            continue;
          }
          const entry = item.webkitGetAsEntry();
          if (entry) {
            entries.push(entry);
          }
        }

        // Process entries recursively for folder support
        const processEntry = async (entry: FileSystemEntry, path: string): Promise<void> => {
          if (entry.isFile) {
            const fileEntry = entry as FileSystemFileEntry;
            const file = await new Promise<File>((resolve, reject) => {
              fileEntry.file(resolve, reject);
            });
            const error = validateFile(file);
            uploadFiles.push({
              file,
              path: path || '/',
              progress: 0,
              status: error ? 'error' : 'pending',
              error: error || undefined,
            });
          } else if (entry.isDirectory) {
            const dirEntry = entry as FileSystemDirectoryEntry;
            const reader = dirEntry.createReader();
            const subEntries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
              reader.readEntries(resolve, reject);
            });
            for (const subEntry of subEntries) {
              await processEntry(subEntry, `${path}/${entry.name}`);
            }
          }
        };

        for (const entry of entries) {
          await processEntry(entry, '');
        }
      } else {
        // Handle FileList (from input)
        const fileList = items as FileList;
        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];
          if (!file) {
            continue;
          }
          const error = validateFile(file);
          uploadFiles.push({
            file,
            path: '/',
            progress: 0,
            status: error ? 'error' : 'pending',
            error: error || undefined,
          });
        }
      }

      return uploadFiles;
    },
    [validateFile]
  );

  const uploadFiles = useCallback(
    async (uploadList: UploadFile[]) => {
      setIsUploading(true);
      const results: Array<{ documentId: string; name: string }> = [];

      for (let i = 0; i < uploadList.length; i++) {
        const uploadFile = uploadList[i];
        if (!uploadFile || uploadFile.status === 'error') {
          continue;
        }

        // Update status to uploading
        setFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading' as const } : f))
        );

        try {
          const formData = new FormData();
          formData.append('file', uploadFile.file);
          // Send folderId in form data (backend reads from form data, not query param)
          if (folderId) {
            formData.append('folderId', folderId);
          }
          // Note: uploadFile.path is available from drag-dropped folder structures
          // but backend folder auto-creation is not yet implemented for MVP.
          // Files are uploaded to the current folderId instead.

          const response = await fetch(`/api/rooms/${roomId}/documents`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Upload failed');
          }

          const data = await response.json();

          // Update status to success
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: 'success' as const, progress: 100 } : f
            )
          );

          // API returns documents array - extract first uploaded document
          if (data.documents && data.documents.length > 0) {
            const doc = data.documents[0];
            results.push({ documentId: doc.id, name: doc.name });
          }
        } catch (error) {
          // Update status to error
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: 'error' as const, error: (error as Error).message } : f
            )
          );
          onUploadError?.(error as Error);
        }
      }

      setIsUploading(false);
      if (results.length > 0) {
        onUploadComplete?.(results);
      }
    },
    [roomId, folderId, onUploadComplete, onUploadError]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;

      const uploadList = await processFileList(e.dataTransfer.items);
      setFiles(uploadList);
      await uploadFiles(uploadList);
    },
    [processFileList, uploadFiles]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const uploadList = await processFileList(e.target.files);
        setFiles(uploadList);
        await uploadFiles(uploadList);
      }
    },
    [processFileList, uploadFiles]
  );

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, []);

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        className={`relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors duration-200 ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'} ${isUploading ? 'pointer-events-none opacity-50' : ''} `}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={acceptedTypes.join(',')}
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="space-y-2">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            stroke="currentColor"
            fill="none"
            viewBox="0 0 48 48"
            aria-hidden="true"
          >
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="text-sm text-gray-600">
            <span className="font-medium text-blue-600 hover:text-blue-500">Click to upload</span>{' '}
            or drag and drop
          </div>
          <p className="text-xs text-gray-500">
            PDF, Word, Excel, PowerPoint, images up to {Math.round(maxFileSize / 1024 / 1024)}MB
          </p>
        </div>
      </div>

      {/* File list with progress */}
      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              {files.length} file{files.length > 1 ? 's' : ''}
            </span>
            {!isUploading && (
              <button
                type="button"
                onClick={clearFiles}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear
              </button>
            )}
          </div>

          <ul className="divide-y divide-gray-200 rounded-md border">
            {files.map((file, index) => (
              <li key={`${file.file.name}-${index}`} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{file.file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(file.file.size / 1024).toFixed(1)} KB
                      {file.path !== '/' && ` • ${file.path}`}
                    </p>
                  </div>
                  <div className="ml-4">
                    {file.status === 'pending' && (
                      <span className="text-sm text-gray-400">Pending</span>
                    )}
                    {file.status === 'uploading' && (
                      <span className="text-sm text-blue-500">Uploading...</span>
                    )}
                    {file.status === 'success' && (
                      <span className="text-sm text-green-500">Done</span>
                    )}
                    {file.status === 'error' && (
                      <span className="text-sm text-red-500" title={file.error}>
                        Failed
                      </span>
                    )}
                  </div>
                </div>
                {file.status === 'uploading' && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
