/**
 * GotenbergPreviewProvider Tests
 *
 * Tests generateThumbnailPng routing, fallback chains, and edge cases.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock sharp
const mockSharpResize = vi.fn().mockReturnThis();
const mockSharpPng = vi.fn().mockReturnThis();
const mockSharpToBuffer = vi.fn().mockResolvedValue(Buffer.from('mock-png-data'));
const mockSharpComposite = vi.fn().mockReturnThis();

const mockSharpInstance = {
  resize: mockSharpResize,
  png: mockSharpPng,
  toBuffer: mockSharpToBuffer,
  composite: mockSharpComposite,
  metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
};

vi.mock('sharp', () => ({
  default: vi.fn(() => mockSharpInstance),
}));

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn().mockResolvedValue({
      getPageCount: () => 1,
      getPage: () => ({ getSize: () => ({ width: 612, height: 792 }) }),
    }),
    create: vi.fn().mockResolvedValue({
      copyPages: vi.fn().mockResolvedValue([{}]),
      addPage: vi.fn(),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
  },
}));

// Mock fetch for Gotenberg calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GotenbergPreviewProvider } from './GotenbergPreviewProvider';

describe('GotenbergPreviewProvider', () => {
  let provider: GotenbergPreviewProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GotenbergPreviewProvider('http://gotenberg:3000', 10000);
    mockSharpToBuffer.mockResolvedValue(Buffer.from('mock-png-data'));
  });

  describe('isSupported', () => {
    it('supports image types', () => {
      expect(provider.isSupported('image/jpeg')).toBe(true);
      expect(provider.isSupported('image/png')).toBe(true);
      expect(provider.isSupported('image/gif')).toBe(true);
    });

    it('supports SVG', () => {
      expect(provider.isSupported('image/svg+xml')).toBe(true);
    });

    it('supports office types', () => {
      expect(
        provider.isSupported(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
      ).toBe(true);
    });

    it('supports text types', () => {
      expect(provider.isSupported('text/plain')).toBe(true);
      expect(provider.isSupported('text/csv')).toBe(true);
      expect(provider.isSupported('text/markdown')).toBe(true);
      expect(provider.isSupported('text/html')).toBe(true);
      expect(provider.isSupported('application/json')).toBe(true);
    });

    it('supports PDF', () => {
      expect(provider.isSupported('application/pdf')).toBe(true);
    });

    it('rejects unknown types', () => {
      expect(provider.isSupported('application/octet-stream')).toBe(false);
      expect(provider.isSupported('video/mp4')).toBe(false);
    });
  });

  describe('generateThumbnailPng', () => {
    describe('image types', () => {
      it('uses Sharp resize for JPEG', async () => {
        const result = await provider.generateThumbnailPng(
          Buffer.from('fake-jpeg'),
          'image/jpeg',
          'photo.jpg',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
        expect(mockSharpResize).toHaveBeenCalledWith(200, 280, {
          fit: 'cover',
          position: 'top',
        });
      });

      it('uses Sharp resize for PNG', async () => {
        const result = await provider.generateThumbnailPng(
          Buffer.from('fake-png'),
          'image/png',
          'screenshot.png',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
        expect(mockSharpResize).toHaveBeenCalled();
      });
    });

    describe('SVG type', () => {
      it('attempts Gotenberg screenshot with base64 data URI', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('screenshot-png').buffer),
        });

        const svgData = Buffer.from('<svg><circle cx="50" cy="50" r="50"/></svg>');
        const result = await provider.generateThumbnailPng(
          svgData,
          'image/svg+xml',
          'icon.svg',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/forms/chromium/screenshot/html'),
          expect.any(Object)
        );
      });

      it('falls back to Sharp SVG conversion if Gotenberg fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Gotenberg down'));

        const svgData = Buffer.from('<svg><rect width="100" height="100"/></svg>');
        const result = await provider.generateThumbnailPng(
          svgData,
          'image/svg+xml',
          'icon.svg',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
      });
    });

    describe('markdown type', () => {
      it('uses native Gotenberg markdown screenshot endpoint', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('md-screenshot-png').buffer),
        });

        const mdData = Buffer.from('# Hello World\n\nThis is **markdown**.');
        const result = await provider.generateThumbnailPng(
          mdData,
          'text/markdown',
          'readme.md',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/forms/chromium/screenshot/markdown'),
          expect.any(Object)
        );
      });

      it('falls back to branded card if markdown endpoint fails', async () => {
        // Markdown screenshot fails
        mockFetch.mockRejectedValueOnce(new Error('timeout'));
        // Fallback branded card screenshot succeeds
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('fallback-png').buffer),
        });

        const result = await provider.generateThumbnailPng(
          Buffer.from('# Test'),
          'text/markdown',
          'test.md',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
      });
    });

    describe('HTML type', () => {
      it('screenshots HTML directly', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('html-screenshot').buffer),
        });

        const result = await provider.generateThumbnailPng(
          Buffer.from('<html><body><h1>Hello</h1></body></html>'),
          'text/html',
          'page.html',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/forms/chromium/screenshot/html'),
          expect.any(Object)
        );
      });
    });

    describe('CSV type', () => {
      it('parses CSV to HTML table and screenshots', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('csv-screenshot').buffer),
        });

        const csvData = Buffer.from('Name,Age,City\nAlice,30,NYC\nBob,25,LA');
        const result = await provider.generateThumbnailPng(
          csvData,
          'text/csv',
          'data.csv',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
      });
    });

    describe('text/code types', () => {
      it('renders JSON as styled monospace HTML', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('json-screenshot').buffer),
        });

        const result = await provider.generateThumbnailPng(
          Buffer.from('{"key": "value"}'),
          'application/json',
          'config.json',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
      });

      it('renders plain text as styled monospace HTML', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('text-screenshot').buffer),
        });

        const result = await provider.generateThumbnailPng(
          Buffer.from('Hello, this is plain text content.'),
          'text/plain',
          'notes.txt',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
      });
    });

    describe('PDF type', () => {
      it('attempts PDF embed screenshot', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.alloc(5000).buffer), // >1000 bytes
        });

        const result = await provider.generateThumbnailPng(
          Buffer.from('fake-pdf'),
          'application/pdf',
          'document.pdf',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
      });

      it('falls back to branded card if PDF embed fails', async () => {
        // PDF embed fails
        mockFetch.mockRejectedValueOnce(new Error('embed failed'));
        // Branded card screenshot succeeds
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('fallback-png').buffer),
        });

        const result = await provider.generateThumbnailPng(
          Buffer.from('fake-pdf'),
          'application/pdf',
          'document.pdf',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
      });
    });

    describe('Office types', () => {
      it('converts DOCX via LibreOffice then screenshots', async () => {
        // LibreOffice convert response
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('converted-pdf').buffer),
        });
        // PDF embed screenshot
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.alloc(5000).buffer),
        });

        const result = await provider.generateThumbnailPng(
          Buffer.from('fake-docx'),
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'report.docx',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/forms/libreoffice/convert'),
          expect.any(Object)
        );
      });
    });

    describe('unknown types', () => {
      it('returns branded fallback card for unknown MIME type', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(Buffer.from('fallback-png').buffer),
        });

        const result = await provider.generateThumbnailPng(
          Buffer.from('binary-data'),
          'application/octet-stream',
          'mystery.bin',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
      });
    });

    describe('fallback chain', () => {
      it('falls through to Sharp SVG placeholder when everything fails', async () => {
        // All Gotenberg calls fail
        mockFetch.mockRejectedValue(new Error('Gotenberg unreachable'));

        const result = await provider.generateThumbnailPng(
          Buffer.from('data'),
          'text/html',
          'page.html',
          200,
          280
        );

        // Should still return a buffer (Sharp SVG placeholder)
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBeGreaterThan(0);
      });

      it('never throws regardless of failures', async () => {
        mockFetch.mockRejectedValue(new Error('network error'));
        mockSharpToBuffer.mockResolvedValue(Buffer.from('svg-placeholder'));

        // This should not throw
        const result = await provider.generateThumbnailPng(
          Buffer.from('data'),
          'application/json',
          'data.json',
          200,
          280
        );

        expect(result).toBeInstanceOf(Buffer);
      });
    });
  });
});
