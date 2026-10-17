/** Source defects that cannot recover by retrying the same immutable version. */
const PERMANENT_INDEX_ERRORS = new Set([
  'AI_FORMAT_UNSUPPORTED',
  'AI_FILE_CHECKSUM_MISMATCH',
  'AI_SOURCE_TOO_LARGE',
  'AI_TOO_MANY_CHUNKS',
  'AI_EMPTY_TEXT',
]);

export function isPermanentAiIndexErrorCode(code: string | null | undefined): boolean {
  return Boolean(code && PERMANENT_INDEX_ERRORS.has(code));
}
