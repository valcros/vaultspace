import DOMPurify from 'dompurify';

/**
 * Sanitize a Postgres `ts_headline` search snippet for safe rendering via
 * `dangerouslySetInnerHTML`.
 *
 * `ts_headline` wraps matched terms in `<b>…</b>` (its default StartSel/StopSel)
 * but does NOT HTML-escape the surrounding source text. Because that source is
 * user-uploaded document content (`search_indexes.extractedText`), a crafted
 * document can smuggle an XSS payload straight into the snippet. The only
 * legitimate markup is the `<b>` highlight, so we strip everything else.
 *
 * Client rendering uses DOMPurify (matching TextPreviewRenderer). In any
 * non-DOM context (SSR, a mistaken server-side import) DOMPurify would return
 * its input unchanged, so we fall back to a deterministic escape that permits
 * only the exact `<b>`/`</b>` tags — it can never emit attacker markup.
 */
const HIGHLIGHT_ONLY = { ALLOWED_TAGS: ['b'], ALLOWED_ATTR: [] as string[] };

export function sanitizeSearchSnippet(snippet: string): string {
  if (typeof window !== 'undefined' && DOMPurify.isSupported) {
    return DOMPurify.sanitize(snippet, HIGHLIGHT_ONLY);
  }

  return snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>');
}
