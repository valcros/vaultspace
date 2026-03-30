/**
 * Confidential document utilities.
 *
 * A document is effectively confidential if any of these are true:
 * 1. document.confidential === true
 * 2. folder.confidential === true (the document's parent folder)
 * 3. room.allDocumentsConfidential === true
 */

export function isDocumentConfidential(options: {
  documentConfidential?: boolean;
  folderConfidential?: boolean;
  roomAllConfidential?: boolean;
}): boolean {
  return (
    options.documentConfidential === true ||
    options.folderConfidential === true ||
    options.roomAllConfidential === true
  );
}
