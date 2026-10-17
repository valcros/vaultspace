import { createHash } from 'node:crypto';

export interface TextPage {
  pageNumber: number | null;
  text: string;
}
export interface TextChunk extends TextPage {
  ordinal: number;
  contentSha256: string;
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Stable page-bounded windows. No chunk crosses a citation page boundary. */
export function chunkPages(pages: TextPage[], maxChars = 4000, overlap = 300): TextChunk[] {
  if (maxChars < 500 || overlap < 0 || overlap >= maxChars) {
    throw new Error('AI_CHUNK_CONFIG_INVALID');
  }
  const chunks: TextChunk[] = [];
  for (const page of pages) {
    const normalized = page.text
      .replace(/\r\n?/g, '\n')
      .replace(/[\t ]+/g, ' ')
      .trim();
    for (let start = 0; start < normalized.length; ) {
      let end = Math.min(start + maxChars, normalized.length);
      if (end < normalized.length) {
        const boundary = normalized.lastIndexOf(' ', end);
        if (boundary > start + Math.floor(maxChars / 2)) {
          end = boundary;
        }
      }
      const content = normalized.slice(start, end).trim();
      if (content) {
        chunks.push({
          ordinal: chunks.length,
          pageNumber: page.pageNumber,
          text: content,
          contentSha256: sha256(content),
        });
      }
      if (end >= normalized.length) {
        break;
      }
      start = Math.max(start + 1, end - overlap);
    }
  }
  return chunks;
}
