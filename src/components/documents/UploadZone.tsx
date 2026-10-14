'use client';

/**
 * Drag-and-Drop Upload Zone Component (F007)
 *
 * HTML5 drag-and-drop file upload with progress tracking.
 * Supports folder structure preservation when dropping folders.
 */

import React, { useCallback, useState, useRef } from 'react';

import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES } from '@/lib/rooms/folderImport';

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

/**
 * Extension to MIME type mapping for files browsers don't recognize.
 * Used as fallback when file.type is empty or application/octet-stream.
 */
const EXTENSION_MIME_MAP: Record<string, string> = {
  eps: 'application/postscript',
  ai: 'application/illustrator',
  dxf: 'application/dxf',
};

/**
 * Get file extension from filename (lowercase, without dot).
 */
function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? (parts.pop() || '').toLowerCase() : '';
}

export function UploadZone({
  roomId,
  folderId,
  onUploadComplete,
  onUploadError,
  maxFileSize = DEFAULT_MAX_SIZE,
  acceptedTypes = [],
  multiple = true,
  className = '',
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    fileCount: number;
    newFolders: string[];
    existingFolderCount: number;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importRejections, setImportRejections] = useState<
    Array<{ sourcePath: string; reason: string }>
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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
      // No type restriction by default: a data room accepts any file type,
      // whether or not the app can preview it. A caller may pass a non-empty
      // acceptedTypes to restrict a specific picker.
      if (acceptedTypes.length === 0) {
        return null;
      }
      // Check MIME type directly first
      if (acceptedTypes.includes(file.type)) {
        return null;
      }
      // Fall back to extension-based check for files browsers don't recognize
      const ext = getFileExtension(file.name);
      const mimeFromExt = EXTENSION_MIME_MAP[ext];
      if (mimeFromExt && acceptedTypes.includes(mimeFromExt)) {
        return null;
      }
      return 'File type not supported';
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
              path: path ? `${path}/${file.name}` : file.name,
              progress: 0,
              status: error ? 'error' : 'pending',
              error: error || undefined,
            });
          } else if (entry.isDirectory) {
            const dirEntry = entry as FileSystemDirectoryEntry;
            const reader = dirEntry.createReader();
            while (true) {
              const subEntries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
                reader.readEntries(resolve, reject);
              });
              if (subEntries.length === 0) {
                break;
              }
              for (const subEntry of subEntries) {
                await processEntry(subEntry, path ? `${path}/${entry.name}` : entry.name);
              }
            }
          }
        };

        for (const entry of entries) {
          await processEntry(entry, '');
        }
        if (entries.length === 0) {
          for (let i = 0; i < items.length; i++) {
            const file = (items[i] as DataTransferItem | undefined)?.getAsFile();
            if (!file) {
              continue;
            }
            const error = validateFile(file);
            uploadFiles.push({
              file,
              path: file.name,
              progress: 0,
              status: error ? 'error' : 'pending',
              error: error || undefined,
            });
          }
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
            path: file.webkitRelativePath || file.name,
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

  const reviewFolderImport = useCallback(
    async (uploadList: UploadFile[]) => {
      setImportPreview(null);
      setImportError(null);
      setImportRejections([]);
      if (
        uploadList.length > MAX_IMPORT_FILES ||
        uploadList.reduce((sum, item) => sum + item.file.size, 0) > MAX_IMPORT_BYTES
      ) {
        setImportError(
          `Folder imports are limited to ${MAX_IMPORT_FILES} files and ${MAX_IMPORT_BYTES / 1024 / 1024} MB per batch.`
        );
        return;
      }
      if (uploadList.some((item) => item.status === 'error')) {
        setImportError('Remove files with errors before importing the folder.');
        return;
      }
      setIsReviewing(true);
      try {
        const response = await fetch(`/api/rooms/${roomId}/documents/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parentFolderId: folderId ?? null,
            files: uploadList.map((item) => ({
              name: item.file.name,
              size: item.file.size,
              path: item.path,
            })),
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          setImportError(data.error?.message ?? 'Folder import cannot proceed.');
          setImportRejections(data.error?.details?.rejections ?? []);
          return;
        }
        setImportPreview(data.preview);
      } catch (error) {
        setImportError('Could not review this folder import. Try again.');
        onUploadError?.(error as Error);
      } finally {
        setIsReviewing(false);
      }
    },
    [roomId, folderId, onUploadError]
  );

  const importFolder = useCallback(async () => {
    if (!importPreview || isUploading) {
      return;
    }
    setIsUploading(true);
    setImportError(null);
    setImportRejections([]);
    try {
      const formData = new FormData();
      if (folderId) {
        formData.append('parentFolderId', folderId);
      }
      for (const item of files) {
        formData.append('file', item.file);
        formData.append('path', item.path);
      }
      const response = await fetch(`/api/rooms/${roomId}/documents/import`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        setImportError(data.error?.message ?? 'Folder import failed. Nothing was added.');
        setImportRejections(data.error?.details?.rejections ?? []);
        setImportPreview(null);
        return;
      }
      setFiles((previous) =>
        previous.map((item) => ({ ...item, status: 'success', progress: 100 }))
      );
      setImportPreview(null);
      onUploadComplete?.(
        (data.documents ?? []).map((document: { id: string; name: string }) => ({
          documentId: document.id,
          name: document.name,
        }))
      );
    } catch (error) {
      setImportError('Folder import failed. Check the room before retrying.');
      onUploadError?.(error as Error);
    } finally {
      setIsUploading(false);
    }
  }, [files, folderId, importPreview, isUploading, onUploadComplete, onUploadError, roomId]);

  const handleSelection = useCallback(
    async (uploadList: UploadFile[]) => {
      setFiles(uploadList);
      setImportError(null);
      setImportRejections([]);
      if (uploadList.length === 0) {
        setImportError('No files were found in this selection.');
        return;
      }
      if (uploadList.some((item) => item.path.includes('/'))) {
        await reviewFolderImport(uploadList);
      } else {
        setImportPreview(null);
        await uploadFiles(uploadList);
      }
    },
    [reviewFolderImport, uploadFiles]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;

      try {
        const uploadList = await processFileList(e.dataTransfer.items);
        await handleSelection(uploadList);
      } catch (error) {
        setImportError('Could not read the dropped files. Try choosing the folder instead.');
        onUploadError?.(error as Error);
      }
    },
    [processFileList, handleSelection, onUploadError]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        try {
          const uploadList = await processFileList(e.target.files);
          await handleSelection(uploadList);
        } catch (error) {
          setImportError('Could not read the selected files. Try again.');
          onUploadError?.(error as Error);
        }
      }
    },
    [processFileList, handleSelection, onUploadError]
  );

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setImportPreview(null);
    setImportError(null);
    setImportRejections([]);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  }, []);

  return (
    <div className={className}>
      <div
        className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors duration-200 ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'} ${isUploading ? 'opacity-50' : ''} `}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={
            acceptedTypes.length > 0
              ? [...acceptedTypes, ...Object.keys(EXTENSION_MIME_MAP).map((ext) => `.${ext}`)].join(
                  ','
                )
              : undefined
          }
          onChange={handleFileSelect}
          className="hidden"
          aria-label="Choose files to upload"
        />
        <input
          ref={(element) => {
            folderInputRef.current = element;
            element?.setAttribute('webkitdirectory', '');
          }}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          aria-label="Choose a folder to import"
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
          <div className="flex flex-wrap justify-center gap-3 text-sm">
            <button
              type="button"
              onClick={handleClick}
              disabled={isUploading || isReviewing}
              className="font-medium text-blue-600 underline hover:text-blue-800 disabled:opacity-50"
            >
              Choose files
            </button>
            {multiple && (
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={isUploading || isReviewing}
                className="font-medium text-blue-600 underline hover:text-blue-800 disabled:opacity-50"
              >
                Choose folder
              </button>
            )}
            <span className="text-gray-600">or drag files or folders here</span>
          </div>
          <p className="text-xs text-gray-500">
            Up to {Math.round(maxFileSize / 1024 / 1024)}MB per file
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Most file types are accepted. Preview availability depends on the format.
          </p>
          {multiple && (
            <p className="text-xs text-gray-500">
              Folder imports: up to {MAX_IMPORT_FILES} files and {MAX_IMPORT_BYTES / 1024 / 1024} MB
              per batch.
            </p>
          )}
        </div>
      </div>

      {isReviewing && (
        <p role="status" className="mt-3 text-sm text-gray-600">
          Reviewing folder structure...
        </p>
      )}
      {importError && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <p>{importError}</p>
          {importRejections.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {importRejections.map((item, index) => (
                <li key={`${item.sourcePath}-${index}`}>
                  {item.sourcePath}: {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {importPreview && (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-gray-800">
          <p className="font-medium">
            Import preview: {importPreview.fileCount} files, {importPreview.newFolders.length} new
            folders
          </p>
          {importPreview.existingFolderCount > 0 && (
            <p>{importPreview.existingFolderCount} existing folders will be reused.</p>
          )}
          {importPreview.newFolders.length > 0 && (
            <ul className="mt-2 max-h-32 list-disc overflow-y-auto pl-5">
              {importPreview.newFolders.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          )}
          <p className="mt-2">
            If validation or upload fails, no documents or folders are added. Files are scanned
            after import before they can be previewed.
          </p>
          <button
            type="button"
            onClick={importFolder}
            disabled={isUploading}
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isUploading ? 'Importing...' : `Import ${importPreview.fileCount} files`}
          </button>
        </div>
      )}

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
                      {file.path !== file.file.name && ` • ${file.path}`}
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
