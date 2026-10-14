/**
 * Shared validation for folder-preserving imports.
 *
 * Authoritative source: docs/ROOM_NAVIGATION_AND_FOLDER_DEPTH_GUIDANCE_v3.md
 *                       API_SPEC.md "Folder-Preserving Import Contract"
 */

import {
  FolderDepthExceededError,
  MAX_FOLDER_DEPTH,
  normalizeImportPath,
  validateImportDepth,
} from './folderDepth';

export const MAX_IMPORT_FILES = 50;
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

export interface ImportPath {
  sourcePath: string;
  normalizedPath: string;
  folderSegments: string[];
  filename: string;
}

export interface ImportPathIssue {
  sourcePath: string;
  reason: string;
}

export function prepareImportPaths(
  rawPaths: string[],
  filenames: string[],
  baseDepth = 0
): { paths: ImportPath[]; issues: ImportPathIssue[]; depthError?: ImportDepthRejectionResponse } {
  const depth = validateImportPaths(rawPaths, baseDepth);
  const issues: ImportPathIssue[] = [];
  const paths: ImportPath[] = [];
  const seen = new Set<string>();

  rawPaths.forEach((sourcePath, index) => {
    let normalizedPath: string;
    try {
      normalizedPath = normalizeImportPath(sourcePath);
    } catch {
      issues.push({ sourcePath, reason: 'Path contains an invalid segment' });
      return;
    }
    const segments = normalizedPath.split('/');
    const filename = segments.pop() ?? '';
    if (!filename || filename !== filenames[index] || filename.length > 255) {
      issues.push({
        sourcePath,
        reason: 'Path must end with the selected file name (max 255 characters)',
      });
      return;
    }
    if (segments.some((segment) => segment.length > 255 || /[<>:"/\\|?*]/.test(segment))) {
      issues.push({
        sourcePath,
        reason: 'A folder name is too long or contains invalid characters',
      });
      return;
    }
    if (seen.has(normalizedPath)) {
      issues.push({ sourcePath, reason: 'The selection contains this path more than once' });
      return;
    }
    seen.add(normalizedPath);
    paths.push({ sourcePath, normalizedPath, folderSegments: segments, filename });
  });

  return { paths, issues, ...(!depth.ok ? { depthError: depth.response } : {}) };
}

export interface ImportRejection {
  sourcePath: string;
  attemptedDepth: number;
  reason: string;
}

export interface ImportDepthRejectionResponse {
  error: {
    code: 'FOLDER_DEPTH_EXCEEDED';
    message: string;
    status: 400;
    details: {
      operation: 'import';
      maxDepth: number;
      rejections: ImportRejection[];
    };
  };
}

export interface ImportValidationOk {
  ok: true;
}

export interface ImportValidationFail {
  ok: false;
  response: ImportDepthRejectionResponse;
}

export type ImportValidationResult = ImportValidationOk | ImportValidationFail;

/**
 * Validate a list of relative import paths against the depth cap.
 * Atomic semantics: a single bad path fails the whole batch (Phase 1 contract).
 *
 * Callers that want to short-circuit can use the boolean `ok` field; callers
 * that want to bubble the documented error envelope can return `result.response`
 * directly.
 */
export function validateImportPaths(rawPaths: string[], baseDepth = 0): ImportValidationResult {
  try {
    validateImportDepth(rawPaths, MAX_FOLDER_DEPTH - baseDepth);
    return { ok: true };
  } catch (err) {
    if (err instanceof FolderDepthExceededError && err.rejections) {
      return {
        ok: false,
        response: {
          error: {
            code: 'FOLDER_DEPTH_EXCEEDED',
            message: `One or more import paths exceed the maximum allowed depth of ${MAX_FOLDER_DEPTH}.`,
            status: 400,
            details: {
              operation: 'import',
              maxDepth: MAX_FOLDER_DEPTH,
              rejections: err.rejections.map((rejection) => ({
                ...rejection,
                attemptedDepth: rejection.attemptedDepth + baseDepth,
              })),
            },
          },
        },
      };
    }
    throw err;
  }
}
