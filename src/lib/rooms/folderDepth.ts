/**
 * Folder depth rules for VaultSpace rooms.
 *
 * Authoritative source: docs/ROOM_NAVIGATION_AND_FOLDER_DEPTH_GUIDANCE_v3.md
 *
 * Allowed: room root -> top-level -> mid-level -> leaf-level (max depth 3).
 * Files may live at any of those four levels; folders may not nest below depth 3.
 */

export const MAX_FOLDER_DEPTH = 3;

export type DepthOperation = 'create' | 'move' | 'import';

export class FolderDepthExceededError extends Error {
  readonly code = 'FOLDER_DEPTH_EXCEEDED';
  readonly maxDepth = MAX_FOLDER_DEPTH;
  readonly attemptedDepth: number;
  readonly operation: DepthOperation;
  readonly parentFolderId?: string | null;
  readonly rejections?: Array<{
    sourcePath: string;
    attemptedDepth: number;
    reason: string;
  }>;

  constructor(args: {
    attemptedDepth: number;
    operation: DepthOperation;
    parentFolderId?: string | null;
    rejections?: Array<{
      sourcePath: string;
      attemptedDepth: number;
      reason: string;
    }>;
    message?: string;
  }) {
    super(
      args.message ?? `This folder would exceed the maximum allowed depth of ${MAX_FOLDER_DEPTH}.`
    );
    this.name = 'FolderDepthExceededError';
    this.attemptedDepth = args.attemptedDepth;
    this.operation = args.operation;
    this.parentFolderId = args.parentFolderId ?? null;
    this.rejections = args.rejections;
  }
}

/**
 * Compute folder depth from a stored folder path.
 * The repo currently stores paths as `/Top`, `/Top/Mid`, `/Top/Mid/Leaf`.
 * A leading slash is required; trailing slashes are normalized.
 */
export function getFolderDepth(path: string): number {
  if (!path) {
    return 0;
  }
  const normalized = path.replace(/\/+$/g, '');
  if (!normalized || normalized === '/') {
    return 0;
  }
  return normalized.split('/').filter(Boolean).length;
}

/**
 * Compute the depth of a folder created directly under the given parent path.
 * `null` parent path means the new folder will be at depth 1.
 */
export function getProposedChildDepth(parentPath: string | null | undefined): number {
  if (!parentPath) {
    return 1;
  }
  return getFolderDepth(parentPath) + 1;
}

/**
 * Validate that creating a folder under the given parent will not exceed the cap.
 * Throws FolderDepthExceededError if it would.
 */
export function validateFolderCreateDepth(
  parentPath: string | null | undefined,
  parentFolderId: string | null | undefined,
  maxDepth: number = MAX_FOLDER_DEPTH
): void {
  const proposed = getProposedChildDepth(parentPath);
  if (proposed > maxDepth) {
    throw new FolderDepthExceededError({
      attemptedDepth: proposed,
      operation: 'create',
      parentFolderId: parentFolderId ?? null,
    });
  }
}

/**
 * Validate that moving a folder (and its descendants) under a new parent will
 * not push any node beyond the depth cap.
 *
 * @param folderPath          Current path of the folder being moved.
 * @param destinationParentPath Path of the destination parent, or null if moving to room root.
 * @param descendantPaths     All current descendant paths of the folder being moved.
 * @param maxDepth            Optional override of the cap.
 */
export function validateFolderMoveDepth(
  folderPath: string,
  destinationParentPath: string | null | undefined,
  descendantPaths: string[],
  maxDepth: number = MAX_FOLDER_DEPTH
): void {
  const sourceDepth = getFolderDepth(folderPath);
  const destinationParentDepth = destinationParentPath ? getFolderDepth(destinationParentPath) : 0;
  const movedNodeDepth = destinationParentDepth + 1;

  let maxRelativeDepth = 0;
  for (const descendantPath of descendantPaths) {
    const descendantDepth = getFolderDepth(descendantPath);
    const relative = descendantDepth - sourceDepth;
    if (relative > maxRelativeDepth) {
      maxRelativeDepth = relative;
    }
  }

  const projectedDeepest = movedNodeDepth + maxRelativeDepth;
  if (projectedDeepest > maxDepth) {
    throw new FolderDepthExceededError({
      attemptedDepth: projectedDeepest,
      operation: 'move',
    });
  }
}

/**
 * Normalize an inbound import path. Trims, removes leading/trailing slashes,
 * collapses repeated separators, drops empty segments, and rejects any
 * `..` traversal.
 */
export function normalizeImportPath(rawPath: string): string {
  const segments = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new Error(`Invalid import path segment: ${segment}`);
    }
  }

  return segments.join('/');
}

/**
 * Compute the folder depth implied by an import path.
 *
 * For an import file at `Financials/2025/Q3/cash-flow.pdf`, the deepest
 * folder created is `/Financials/2025/Q3` -> depth 3, so the file lives at
 * depth 3 of the folder tree. The "folder depth" we measure is the number of
 * folder segments above the file (i.e. ignoring the file segment itself).
 */
export function getImportFolderDepth(normalizedPath: string): number {
  if (!normalizedPath) {
    return 0;
  }
  const segments = normalizedPath.split('/').filter(Boolean);
  return Math.max(0, segments.length - 1);
}

/**
 * Validate a batch of import paths against the depth cap.
 *
 * Returns nothing on success. On failure, throws a FolderDepthExceededError
 * whose `rejections` field lists every path that violated the cap. Atomic by
 * design: a single bad path causes the whole batch to be rejected.
 */
export function validateImportDepth(rawPaths: string[], maxDepth: number = MAX_FOLDER_DEPTH): void {
  const rejections: Array<{ sourcePath: string; attemptedDepth: number; reason: string }> = [];

  for (const raw of rawPaths) {
    let normalized: string;
    try {
      normalized = normalizeImportPath(raw);
    } catch {
      rejections.push({
        sourcePath: raw,
        attemptedDepth: 0,
        reason: 'Invalid import path',
      });
      continue;
    }
    const folderDepth = getImportFolderDepth(normalized);
    if (folderDepth > maxDepth) {
      rejections.push({
        sourcePath: raw,
        attemptedDepth: folderDepth,
        reason: 'Folder path exceeds maximum depth',
      });
    }
  }

  if (rejections.length > 0) {
    const deepest = Math.max(...rejections.map((r) => r.attemptedDepth));
    throw new FolderDepthExceededError({
      attemptedDepth: deepest,
      operation: 'import',
      rejections,
      message: `One or more import paths exceed the maximum allowed depth of ${maxDepth}.`,
    });
  }
}
