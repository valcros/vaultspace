/**
 * Folder-preserving import contract scaffolding (Path B).
 *
 * Phase 1 of room navigation explicitly defers folder-preserving import UI.
 * The current upload route still uploads each file into the active folderId
 * and ignores any captured folder paths. This module exposes the contract
 * shared validator + response shape so:
 *
 *   - any future Path-A wire-up can opt in without redesigning behavior
 *   - tests can assert that the validator and the documented response shape
 *     stay in lockstep
 *
 * Authoritative source: docs/ROOM_NAVIGATION_AND_FOLDER_DEPTH_GUIDANCE_v3.md
 *                       API_SPEC.md "Folder-Preserving Import Contract"
 */

import { FolderDepthExceededError, MAX_FOLDER_DEPTH, validateImportDepth } from './folderDepth';

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
export function validateImportPaths(rawPaths: string[]): ImportValidationResult {
  try {
    validateImportDepth(rawPaths);
    return { ok: true };
  } catch (err) {
    if (err instanceof FolderDepthExceededError && err.rejections) {
      return {
        ok: false,
        response: {
          error: {
            code: 'FOLDER_DEPTH_EXCEEDED',
            message: err.message,
            status: 400,
            details: {
              operation: 'import',
              maxDepth: MAX_FOLDER_DEPTH,
              rejections: err.rejections,
            },
          },
        },
      };
    }
    throw err;
  }
}
