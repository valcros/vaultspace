/**
 * Escape a string for safe interpolation into transactional-email HTML.
 *
 * Transactional emails interpolate user-controlled values (document/room/person/
 * org names, addresses) that are only validated as non-empty strings. Rendered
 * raw into HTML they allow content/link-spoofing and, in permissive clients,
 * script injection (finding X2/X3). Escape the five HTML-significant characters.
 *
 * Encoding `&` inside an `href` is spec-correct and decoded by clients, so this
 * is safe to apply to URLs too — which removes any "this value is server-built"
 * assumption at the call site.
 *
 * NOTE: this is for HTML body content, NOT email subjects (which are plain text;
 * their risk is CRLF/header injection, handled by the transport, not by escaping).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
