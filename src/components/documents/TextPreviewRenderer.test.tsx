// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TextPreviewRenderer } from './TextPreviewRenderer';

afterEach(cleanup);

describe('TextPreviewRenderer dependency integration', () => {
  it('renders Markdown formatting and safe links while rejecting active HTML and script links', async () => {
    const content = [
      '# Review document',
      '',
      '- First item',
      '- Second item',
      '',
      '[Safe link](https://example.com/review)',
      '',
      'https://example.com/automatic',
      '',
      'Line one\\',
      'Line two',
      '',
      '<script>alert("unsafe")</script>',
      '<img src=x onerror="alert(1)">',
      '[Unsafe link](javascript:alert(1))',
    ].join('\n');
    const { container } = render(
      <TextPreviewRenderer content={content} mimeType="text/markdown" fileName="review.md" />
    );

    expect(await screen.findByRole('heading', { name: 'Review document' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Safe link' }).getAttribute('href')).toBe(
      'https://example.com/review'
    );
    expect(screen.getByRole('link', { name: 'https://example.com/automatic' })).toBeTruthy();
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.querySelector('script, img, [onerror]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Unsafe link' })).toBeNull();
    for (const link of container.querySelectorAll('a')) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    }
  });

  it('preserves safe SVG graphics and removes executable SVG content', () => {
    const content =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
      '<circle cx="10" cy="10" r="5"/><script>alert(1)</script>' +
      '<a href="javascript:alert(1)"><text>Unsafe</text></a></svg>';
    const { container } = render(
      <TextPreviewRenderer content={content} mimeType="image/svg+xml" fileName="review.svg" />
    );
    expect(container.querySelector('svg circle')).not.toBeNull();
    expect(container.querySelector('script, [onload], [href^="javascript:"]')).toBeNull();
  });
});
