// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { sanitizeSearchSnippet } from './sanitizeSearchSnippet';

describe('sanitizeSearchSnippet', () => {
  it('preserves the <b> highlight markup ts_headline emits', () => {
    const out = sanitizeSearchSnippet('the <b>merger</b> agreement');
    expect(out).toBe('the <b>merger</b> agreement');
  });

  it('strips an event-handler image payload smuggled through the document text', () => {
    const out = sanitizeSearchSnippet('before <img src=x onerror="alert(1)"> after');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('removes script tags and their contents', () => {
    const out = sanitizeSearchSnippet('hit <script>alert(document.cookie)</script> word');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(document.cookie)');
  });

  it('drops attributes on the allowed <b> tag', () => {
    const out = sanitizeSearchSnippet('<b onmouseover="alert(1)">x</b>');
    expect(out).not.toMatch(/onmouseover/i);
    expect(out).toContain('x');
  });

  it('neutralizes a javascript: anchor', () => {
    const out = sanitizeSearchSnippet('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/<a\b/i);
  });

  it('leaves plain text untouched', () => {
    expect(sanitizeSearchSnippet('quarterly revenue report')).toBe('quarterly revenue report');
  });
});
