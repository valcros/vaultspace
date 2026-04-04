/**
 * File Type Utilities (F009)
 *
 * Multi-format support for PDF, DOCX, XLSX, PPTX, images, and more.
 * Provides file type detection, validation, and conversion strategy mapping.
 */

export interface SupportedFileType {
  ext: string;
  mimeType: string;
  category: FileCategory;
  previewable: boolean;
  conversionTool?: ConversionTool;
  outputFormat?: 'pdf' | 'png' | 'jpeg';
  estimatedProcessingTime?: number; // seconds
  tier: 1 | 2; // 1 = primary formats, 2 = secondary formats
}

export type FileCategory = 'PDF' | 'Office' | 'OfficeLegacy' | 'Image' | 'Text' | 'Data' | 'Vector' | 'CAD';

export type ConversionTool =
  | 'gotenberg'
  | 'imagemagick'
  | 'wkhtmltopdf'
  | 'libreoffice'
  | 'inkscape'
  | 'ghostscript'
  | 'dxf-parser';

/**
 * All supported file types for the VDR platform
 * Tier 1: Primary formats (PDF, modern Office, common images)
 * Tier 2: Secondary formats (legacy Office, less common formats)
 */
export const SUPPORTED_FILE_TYPES: SupportedFileType[] = [
  // PDF - Native support
  {
    ext: 'pdf',
    mimeType: 'application/pdf',
    category: 'PDF',
    previewable: true,
    estimatedProcessingTime: 5,
    tier: 1,
  },

  // Modern Office Formats (OOXML)
  {
    ext: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    category: 'Office',
    previewable: true,
    conversionTool: 'gotenberg',
    outputFormat: 'pdf',
    estimatedProcessingTime: 30,
    tier: 1,
  },
  {
    ext: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    category: 'Office',
    previewable: true,
    conversionTool: 'gotenberg',
    outputFormat: 'pdf',
    estimatedProcessingTime: 45,
    tier: 1,
  },
  {
    ext: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    category: 'Office',
    previewable: true,
    conversionTool: 'gotenberg',
    outputFormat: 'pdf',
    estimatedProcessingTime: 40,
    tier: 1,
  },

  // Legacy Office Formats
  {
    ext: 'doc',
    mimeType: 'application/msword',
    category: 'OfficeLegacy',
    previewable: true,
    conversionTool: 'gotenberg',
    outputFormat: 'pdf',
    estimatedProcessingTime: 40,
    tier: 2,
  },
  {
    ext: 'xls',
    mimeType: 'application/vnd.ms-excel',
    category: 'OfficeLegacy',
    previewable: true,
    conversionTool: 'gotenberg',
    outputFormat: 'pdf',
    estimatedProcessingTime: 50,
    tier: 2,
  },
  {
    ext: 'ppt',
    mimeType: 'application/vnd.ms-powerpoint',
    category: 'OfficeLegacy',
    previewable: true,
    conversionTool: 'gotenberg',
    outputFormat: 'pdf',
    estimatedProcessingTime: 50,
    tier: 2,
  },

  // Images
  {
    ext: 'png',
    mimeType: 'image/png',
    category: 'Image',
    previewable: true,
    conversionTool: 'imagemagick',
    outputFormat: 'pdf',
    estimatedProcessingTime: 10,
    tier: 1,
  },
  {
    ext: 'jpg',
    mimeType: 'image/jpeg',
    category: 'Image',
    previewable: true,
    conversionTool: 'imagemagick',
    outputFormat: 'pdf',
    estimatedProcessingTime: 10,
    tier: 1,
  },
  {
    ext: 'jpeg',
    mimeType: 'image/jpeg',
    category: 'Image',
    previewable: true,
    conversionTool: 'imagemagick',
    outputFormat: 'pdf',
    estimatedProcessingTime: 10,
    tier: 1,
  },
  {
    ext: 'gif',
    mimeType: 'image/gif',
    category: 'Image',
    previewable: true,
    conversionTool: 'imagemagick',
    outputFormat: 'pdf',
    estimatedProcessingTime: 15,
    tier: 2,
  },
  {
    ext: 'webp',
    mimeType: 'image/webp',
    category: 'Image',
    previewable: true,
    conversionTool: 'imagemagick',
    outputFormat: 'pdf',
    estimatedProcessingTime: 10,
    tier: 2,
  },
  {
    ext: 'tiff',
    mimeType: 'image/tiff',
    category: 'Image',
    previewable: true,
    conversionTool: 'imagemagick',
    outputFormat: 'pdf',
    estimatedProcessingTime: 60, // Longer due to OCR
    tier: 1,
  },
  {
    ext: 'tif',
    mimeType: 'image/tiff',
    category: 'Image',
    previewable: true,
    conversionTool: 'imagemagick',
    outputFormat: 'pdf',
    estimatedProcessingTime: 60,
    tier: 1,
  },
  {
    ext: 'svg',
    mimeType: 'image/svg+xml',
    category: 'Image',
    previewable: true,
    conversionTool: 'inkscape',
    outputFormat: 'pdf',
    estimatedProcessingTime: 20,
    tier: 2,
  },

  // Text formats
  {
    ext: 'txt',
    mimeType: 'text/plain',
    category: 'Text',
    previewable: true,
    conversionTool: 'wkhtmltopdf',
    outputFormat: 'pdf',
    estimatedProcessingTime: 5,
    tier: 1,
  },
  {
    ext: 'rtf',
    mimeType: 'application/rtf',
    category: 'Text',
    previewable: true,
    conversionTool: 'libreoffice',
    outputFormat: 'pdf',
    estimatedProcessingTime: 15,
    tier: 2,
  },

  // Data formats
  {
    ext: 'csv',
    mimeType: 'text/csv',
    category: 'Data',
    previewable: true,
    conversionTool: 'wkhtmltopdf',
    outputFormat: 'pdf',
    estimatedProcessingTime: 8,
    tier: 2,
  },

  // Vector Graphics - EPS
  {
    ext: 'eps',
    mimeType: 'application/postscript',
    category: 'Vector',
    previewable: true,
    conversionTool: 'ghostscript',
    outputFormat: 'png',
    estimatedProcessingTime: 15,
    tier: 2,
  },

  // Vector Graphics - Adobe Illustrator
  {
    ext: 'ai',
    mimeType: 'application/illustrator',
    category: 'Vector',
    previewable: true,
    conversionTool: 'ghostscript',
    outputFormat: 'png',
    estimatedProcessingTime: 20,
    tier: 2,
  },

  // CAD - DXF
  {
    ext: 'dxf',
    mimeType: 'application/dxf',
    category: 'CAD',
    previewable: true,
    conversionTool: 'dxf-parser',
    outputFormat: 'png',
    estimatedProcessingTime: 10,
    tier: 2,
  },
];

/**
 * MIME type lookup map for fast access
 */
const MIME_TYPE_MAP = new Map<string, SupportedFileType>(
  SUPPORTED_FILE_TYPES.map((t) => [t.mimeType, t])
);

/**
 * Extension lookup map for fast access
 */
const EXTENSION_MAP = new Map<string, SupportedFileType>(
  SUPPORTED_FILE_TYPES.map((t) => [t.ext.toLowerCase(), t])
);

/**
 * Get file type information by MIME type
 */
export function getFileTypeByMime(mimeType: string): SupportedFileType | undefined {
  return MIME_TYPE_MAP.get(mimeType);
}

/**
 * Get file type information by extension
 */
export function getFileTypeByExtension(extension: string): SupportedFileType | undefined {
  const ext = extension.toLowerCase().replace(/^\./, '');
  return EXTENSION_MAP.get(ext);
}

/**
 * Extract extension from filename
 */
export function getExtensionFromFilename(filename: string): string {
  const parts = filename.split('.');
  const lastPart = parts[parts.length - 1];
  return parts.length > 1 && lastPart ? lastPart.toLowerCase() : '';
}

/**
 * Validate a file's MIME type and extension
 */
export function validateFileType(
  filename: string,
  mimeType: string
): { valid: boolean; fileType?: SupportedFileType; error?: string } {
  // Try to match by MIME type first
  const byMime = getFileTypeByMime(mimeType);

  // Also try by extension
  const ext = getExtensionFromFilename(filename);
  const byExt = getFileTypeByExtension(ext);

  // If MIME type matches, use that
  if (byMime) {
    return { valid: true, fileType: byMime };
  }

  // Fall back to extension match
  if (byExt) {
    return { valid: true, fileType: byExt };
  }

  return {
    valid: false,
    error: `Unsupported file type: ${mimeType} (${ext || 'no extension'})`,
  };
}

/**
 * Check if a MIME type is supported
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return MIME_TYPE_MAP.has(mimeType);
}

/**
 * Check if a file type requires conversion (non-PDF)
 */
export function requiresConversion(mimeType: string): boolean {
  const fileType = getFileTypeByMime(mimeType);
  return fileType?.mimeType !== 'application/pdf';
}

/**
 * Get the conversion tool for a file type
 */
export function getConversionTool(mimeType: string): ConversionTool | undefined {
  return getFileTypeByMime(mimeType)?.conversionTool;
}

/**
 * Check if a file type typically requires OCR (scanned documents, images)
 */
export function mayRequireOCR(mimeType: string): boolean {
  const ocrCategories: FileCategory[] = ['Image'];
  const fileType = getFileTypeByMime(mimeType);
  return fileType !== undefined && ocrCategories.includes(fileType.category);
}

/**
 * Get all supported MIME types
 */
export function getAllSupportedMimeTypes(): string[] {
  return SUPPORTED_FILE_TYPES.map((t) => t.mimeType);
}

/**
 * Get all supported extensions
 */
export function getAllSupportedExtensions(): string[] {
  return SUPPORTED_FILE_TYPES.map((t) => t.ext);
}

/**
 * Get file types by category
 */
export function getFileTypesByCategory(category: FileCategory): SupportedFileType[] {
  return SUPPORTED_FILE_TYPES.filter((t) => t.category === category);
}

/**
 * Get tier 1 (primary) file types
 */
export function getPrimaryFileTypes(): SupportedFileType[] {
  return SUPPORTED_FILE_TYPES.filter((t) => t.tier === 1);
}

/**
 * Sanitize a filename for safe storage
 */
export function sanitizeFilename(input: string): string {
  // Get the base filename (remove path components)
  const parts = input.split(/[/\\]/);
  const basename = parts[parts.length - 1] || 'document';

  // Remove special characters (keep alphanumeric, dots, hyphens, underscores)
  const sanitized = basename
    .replace(/[^\w\s\-\.]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 255);

  return sanitized || 'document';
}

/**
 * Validate filename for security
 */
export function validateFilename(filename: string): { valid: boolean; error?: string } {
  if (!filename || filename.length === 0) {
    return { valid: false, error: 'Filename is empty' };
  }
  if (filename.length > 255) {
    return { valid: false, error: 'Filename exceeds 255 characters' };
  }
  if (filename.includes('/') || filename.includes('\\')) {
    return { valid: false, error: 'Filename contains path separators' };
  }
  if (filename.startsWith('.')) {
    return { valid: false, error: 'Filename cannot start with a dot' };
  }
  return { valid: true };
}

/**
 * Get estimated processing time for a file type
 */
export function getEstimatedProcessingTime(mimeType: string): number {
  return getFileTypeByMime(mimeType)?.estimatedProcessingTime ?? 30;
}
