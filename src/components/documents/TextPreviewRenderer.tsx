'use client';

import * as React from 'react';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/github.css';

/**
 * TextPreviewRenderer
 *
 * Client-side renderer for text-based document formats:
 * - Markdown (.md) — rendered as styled HTML
 * - Code files (.js, .ts, .py, etc.) — syntax highlighted
 * - JSON — syntax highlighted
 * - YAML/XML — syntax highlighted
 * - CSV — formatted table
 * - SVG — sanitized inline rendering
 * - Plain text — monospace display
 */

interface TextPreviewRendererProps {
  content: string;
  mimeType: string;
  fileName: string;
}

// Map file extensions to highlight.js language identifiers
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  r: 'r',
  scala: 'scala',
  dart: 'dart',
  lua: 'lua',
  perl: 'perl',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  ml: 'ocaml',
  clj: 'clojure',
  vim: 'vim',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  env: 'bash',
};

function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');
  return parts[parts.length - 1] ?? '';
}

/** Pretty-print JSON if it's valid; return as-is if parsing fails */
function prettyPrintJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Simple XML/HTML indentation — no dependencies */
function prettyPrintXml(raw: string): string {
  // If it already looks indented, don't re-format
  if (/\n\s+</.test(raw)) {
    return raw;
  }
  let indent = 0;
  const parts = raw.replace(/>\s*</g, '>\n<').split('\n');
  return parts
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return '';
      }
      // Closing tag — dedent first, then print
      if (/^<\//.test(trimmed)) {
        indent = Math.max(0, indent - 1);
      }
      const formatted = '  '.repeat(indent) + trimmed;
      // Self-closing or non-tag line — no indent change
      // Opening tag (not self-closing, not closing) — indent next
      if (/^<[^/!?]/.test(trimmed) && !/>.*<\//.test(trimmed) && !/\/>$/.test(trimmed)) {
        indent++;
      }
      return formatted;
    })
    .filter(Boolean)
    .join('\n');
}

export function TextPreviewRenderer({ content, mimeType, fileName }: TextPreviewRendererProps) {
  const ext = getFileExtension(fileName);

  // SVG — render inline (sanitized)
  if (mimeType === 'image/svg+xml' || ext === 'svg') {
    const sanitized = DOMPurify.sanitize(content, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['use'],
    });
    return (
      <div className="flex items-center justify-center bg-white p-8">
        <div className="max-h-[80vh] max-w-full" dangerouslySetInnerHTML={{ __html: sanitized }} />
      </div>
    );
  }

  // CSV — render as table
  if (mimeType === 'text/csv' || ext === 'csv') {
    return <CsvTable content={content} />;
  }

  // Markdown
  if (mimeType === 'text/markdown' || ext === 'md') {
    return <MarkdownRenderer content={content} />;
  }

  // JSON — pretty-print if minified
  if (mimeType === 'application/json' || ext === 'json') {
    return <CodeRenderer content={prettyPrintJson(content)} language="json" />;
  }

  // YAML
  if (mimeType === 'text/yaml' || ext === 'yaml' || ext === 'yml') {
    return <CodeRenderer content={content} language="yaml" />;
  }

  // XML — pretty-print if minified
  if (mimeType === 'application/xml' || mimeType === 'text/xml' || ext === 'xml') {
    return <CodeRenderer content={prettyPrintXml(content)} language="xml" />;
  }

  // HTML — pretty-print and show as syntax-highlighted code (not executed, for XSS safety)
  if (mimeType === 'text/html' || ext === 'html' || ext === 'htm') {
    return <CodeRenderer content={prettyPrintXml(content)} language="xml" />;
  }

  // Code files — detect language from extension
  const language = EXTENSION_TO_LANGUAGE[ext];
  if (language) {
    return <CodeRenderer content={content} language={language} />;
  }

  // Plain text fallback
  return (
    <div className="overflow-auto bg-white p-6">
      <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-neutral-800">
        {content}
      </pre>
    </div>
  );
}

/**
 * Markdown renderer using markdown-it
 */
function MarkdownRenderer({ content }: { content: string }) {
  const [html, setHtml] = React.useState('');

  React.useEffect(() => {
    async function render() {
      const MarkdownIt = (await import('markdown-it')).default;
      const md = new MarkdownIt({
        html: false,
        linkify: true,
        typographer: true,
      });
      const rendered = md.render(content);
      setHtml(DOMPurify.sanitize(rendered));
    }
    render();
  }, [content]);

  return (
    <div className="overflow-auto bg-white p-8">
      <div
        className="prose prose-neutral max-w-none prose-headings:font-semibold prose-a:text-primary-600 prose-code:rounded prose-code:bg-neutral-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sm prose-pre:bg-neutral-50 prose-pre:text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/**
 * Code renderer with syntax highlighting via highlight.js
 */
function CodeRenderer({ content, language }: { content: string; language: string }) {
  const [highlighted, setHighlighted] = React.useState('');

  React.useEffect(() => {
    async function highlight() {
      const hljs = (await import('highlight.js/lib/core')).default;

      // Dynamically import the language
      try {
        const langModule = await import(`highlight.js/lib/languages/${language}`);
        hljs.registerLanguage(language, langModule.default);
        const result = hljs.highlight(content, { language });
        setHighlighted(result.value);
      } catch {
        // Language not available, show unhighlighted
        setHighlighted(content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      }
    }
    highlight();
  }, [content, language]);

  return (
    <div className="overflow-auto bg-neutral-50">
      <pre className="p-6 text-sm leading-relaxed">
        <code
          className={`hljs language-${language}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

/**
 * CSV table renderer using papaparse
 */
function CsvTable({ content }: { content: string }) {
  const [data, setData] = React.useState<{ headers: string[]; rows: string[][] }>({
    headers: [],
    rows: [],
  });

  React.useEffect(() => {
    async function parse() {
      const Papa = (await import('papaparse')).default;
      const result = Papa.parse<string[]>(content, { header: false });
      const allRows = result.data.filter((row) => row.some((cell) => cell.trim()));

      if (allRows.length > 0) {
        setData({
          headers: allRows[0] ?? [],
          rows: allRows.slice(1, 101), // Limit to 100 rows for preview
        });
      }
    }
    parse();
  }, [content]);

  if (data.headers.length === 0) {
    return <div className="p-8 text-center text-neutral-500">No data to display</div>;
  }

  return (
    <div className="overflow-auto bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-neutral-50">
          <tr>
            {data.headers.map((header, i) => (
              <th
                key={i}
                className="border-b border-r border-neutral-200 px-4 py-2 text-left font-medium text-neutral-700"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className="hover:bg-neutral-50">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="border-b border-r border-neutral-100 px-4 py-1.5 text-neutral-600"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.rows.length >= 100 && (
        <div className="border-t bg-neutral-50 px-4 py-2 text-center text-xs text-neutral-500">
          Showing first 100 rows. Download the file for complete data.
        </div>
      )}
    </div>
  );
}
