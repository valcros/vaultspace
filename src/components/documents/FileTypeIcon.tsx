'use client';

import {
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  FileCode,
  Presentation,
} from 'lucide-react';
import { clsx } from 'clsx';

interface FileTypeIconProps {
  mimeType: string;
  className?: string;
}

/**
 * Renders a colored, type-specific file icon based on MIME type.
 * Helps users visually scan and identify file types at a glance.
 */
export function FileTypeIcon({ mimeType, className }: FileTypeIconProps) {
  const size = clsx('h-5 w-5', className);

  // PDF
  if (mimeType === 'application/pdf') {
    return <FileText className={clsx(size, 'text-red-500')} />;
  }

  // Spreadsheets
  if (
    mimeType.includes('spreadsheet') ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'text/csv'
  ) {
    return <FileSpreadsheet className={clsx(size, 'text-green-600')} />;
  }

  // Word documents
  if (mimeType.includes('wordprocessing') || mimeType === 'application/msword') {
    return <FileText className={clsx(size, 'text-blue-500')} />;
  }

  // Presentations
  if (mimeType.includes('presentation') || mimeType === 'application/vnd.ms-powerpoint') {
    return <Presentation className={clsx(size, 'text-orange-500')} />;
  }

  // Images
  if (mimeType.startsWith('image/')) {
    return <ImageIcon className={clsx(size, 'text-purple-500')} />;
  }

  // Code / structured text
  if (
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'text/xml' ||
    mimeType === 'text/html' ||
    mimeType === 'text/yaml' ||
    mimeType === 'text/markdown'
  ) {
    return <FileCode className={clsx(size, 'text-amber-600')} />;
  }

  // Plain text
  if (mimeType.startsWith('text/')) {
    return <FileText className={clsx(size, 'text-neutral-500')} />;
  }

  // Fallback
  return <File className={clsx(size, 'text-neutral-400')} />;
}
