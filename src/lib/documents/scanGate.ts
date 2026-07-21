/**
 * Central scan-gating policy.
 *
 * A document version's original bytes (and any preview / thumbnail / search
 * index derived from them) may be served to users, or fed into a processing
 * pipeline, ONLY when the version has a "servable" scan status:
 *   - CLEAN   — passed virus scanning
 *   - SKIPPED — allowed but not scanned (e.g. too large for the scanner)
 *
 * INFECTED, PENDING, SCANNING, and ERROR versions must never be downloaded,
 * exported, previewed, thumbnailed, text-extracted, or passed to a converter.
 * Every download / export / preview-selection / preview-generation entry point
 * (including the workers, which must not trust queue payloads as authorization)
 * uses this one predicate / filter.
 */

import type { ScanStatus } from '@prisma/client';

/**
 * Scan statuses whose original / derived assets may be served or processed.
 * Typed as a mutable `ScanStatus[]` (not `as const`) so it is assignable to
 * Prisma's `in` filter, which requires a mutable enum array.
 */
export const SERVABLE_SCAN_STATUSES: ScanStatus[] = ['CLEAN', 'SKIPPED'];

/** Prisma `where` fragment for "servable" versions. */
export const SERVABLE_SCAN_STATUS_FILTER = {
  scanStatus: { in: SERVABLE_SCAN_STATUSES },
};

/** True if a version with this scan status may be served / previewed / indexed. */
export function isServable(scanStatus: ScanStatus | string | null | undefined): boolean {
  return scanStatus === 'CLEAN' || scanStatus === 'SKIPPED';
}
