import { describe, expect, it } from 'vitest';

import { chunkPages, sha256 } from './chunking';

describe('AI citation chunking', () => {
  it('is deterministic and never merges source pages', () => {
    const pages = [
      { pageNumber: 1, text: 'Alpha '.repeat(250) },
      { pageNumber: 2, text: 'Beta '.repeat(250) },
    ];
    const first = chunkPages(pages, 600, 50);
    expect(first.length).toBeGreaterThan(2);
    expect(first).toEqual(chunkPages(pages, 600, 50));
    expect(first.map((chunk) => chunk.ordinal)).toEqual(first.map((_, index) => index));
    expect(first.some((chunk) => chunk.pageNumber === 1 && chunk.text.includes('Beta'))).toBe(
      false
    );
    expect(first.some((chunk) => chunk.pageNumber === 2 && chunk.text.includes('Alpha'))).toBe(
      false
    );
    expect(first.every((chunk) => chunk.contentSha256 === sha256(chunk.text))).toBe(true);
  });

  it('keeps unsupported page anchors null instead of inventing a citation page', () => {
    expect(chunkPages([{ pageNumber: null, text: 'Whole document OCR' }])).toMatchObject([
      { ordinal: 0, pageNumber: null, text: 'Whole document OCR' },
    ]);
  });
});
