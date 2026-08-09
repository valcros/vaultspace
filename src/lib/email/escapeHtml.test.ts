import { describe, expect, it } from 'vitest';

import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('neutralizes a script payload', () => {
    const out = escapeHtml('<script>alert(document.cookie)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('&lt;script&gt;');
  });

  it('neutralizes an event-handler image payload', () => {
    const out = escapeHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('&lt;img');
  });

  it('leaves ordinary names intact (round-trips visually)', () => {
    expect(escapeHtml('Q1 & Q2 Financials')).toBe('Q1 &amp; Q2 Financials');
    expect(escapeHtml('Acme, Inc.')).toBe('Acme, Inc.');
  });
});
