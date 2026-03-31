#!/usr/bin/env ts-node
/**
 * Spike: Thumbnail Generation Approaches
 *
 * Tests three approaches for PDF→PNG conversion via Gotenberg sidecar.
 * Run against staging to determine which approach produces usable thumbnails.
 *
 * Usage:
 *   GOTENBERG_URL=http://gotenberg:3000 AZURE_STORAGE_CONNECTION_STRING=... npx ts-node scripts/spike-thumbnail.ts
 *
 * Pass criteria:
 *   At least one approach produces recognizable content thumbnails for PDF, DOCX, XLSX, PPTX.
 */

import * as fs from 'fs';
import * as path from 'path';

const GOTENBERG_URL = process.env['GOTENBERG_URL'] ?? 'http://localhost:3001';
const OUTPUT_DIR = path.join(__dirname, '..', 'spike-output');
const TIMEOUT_MS = 30000;

// Demo files to test — replace paths with actual staging storage keys
const TEST_FILES: Array<{ name: string; path: string; mimeType: string }> = [
  { name: 'sample.pdf', path: 'spike-samples/sample.pdf', mimeType: 'application/pdf' },
  {
    name: 'sample.docx',
    path: 'spike-samples/sample.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  {
    name: 'sample.xlsx',
    path: 'spike-samples/sample.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    name: 'sample.pptx',
    path: 'spike-samples/sample.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
];

interface SpikeResult {
  file: string;
  approach: string;
  success: boolean;
  outputFile?: string;
  fileSizeBytes?: number;
  error?: string;
  durationMs: number;
}

// ============================================================================
// Approach A: base64-embedded PDF in HTML <embed>, Chromium screenshot
// ============================================================================
async function approachA(pdfBuffer: Buffer, outputPath: string): Promise<SpikeResult> {
  const start = Date.now();
  try {
    const pdfBase64 = pdfBuffer.toString('base64');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0}body{width:800px;height:1100px;overflow:hidden}embed{width:100%;height:100%}</style>
</head><body><embed src="data:application/pdf;base64,${pdfBase64}" type="application/pdf" width="800" height="1100"/></body></html>`;

    const png = await gotenbergScreenshot(html, 800, 1100);

    if (png.length < 1000) {
      return {
        file: outputPath,
        approach: 'A (embed)',
        success: false,
        error: `Output too small: ${png.length} bytes`,
        durationMs: Date.now() - start,
      };
    }

    const outFile = `${outputPath}-approachA.png`;
    fs.writeFileSync(outFile, png);
    return {
      file: outputPath,
      approach: 'A (embed)',
      success: true,
      outputFile: outFile,
      fileSizeBytes: png.length,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      file: outputPath,
      approach: 'A (embed)',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ============================================================================
// Approach B: pdf.js loaded from CDN, renders page 1 to <canvas>
// ============================================================================
async function approachB(pdfBuffer: Buffer, outputPath: string): Promise<SpikeResult> {
  const start = Date.now();
  try {
    const pdfBase64 = pdfBuffer.toString('base64');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs" type="module"></script>
</head><body>
<canvas id="canvas"></canvas>
<script type="module">
const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

const data = Uint8Array.from(atob('${pdfBase64}'), c => c.charCodeAt(0));
const pdf = await pdfjsLib.getDocument({data}).promise;
const page = await pdf.getPage(1);
const viewport = page.getViewport({scale: 1.5});
const canvas = document.getElementById('canvas');
canvas.width = viewport.width;
canvas.height = viewport.height;
const ctx = canvas.getContext('2d');
await page.render({canvasContext: ctx, viewport}).promise;
document.title = 'RENDER_COMPLETE';
</script></body></html>`;

    const png = await gotenbergScreenshot(html, 800, 1100);

    if (png.length < 1000) {
      return {
        file: outputPath,
        approach: 'B (pdf.js)',
        success: false,
        error: `Output too small: ${png.length} bytes`,
        durationMs: Date.now() - start,
      };
    }

    const outFile = `${outputPath}-approachB.png`;
    fs.writeFileSync(outFile, png);
    return {
      file: outputPath,
      approach: 'B (pdf.js)',
      success: true,
      outputFile: outFile,
      fileSizeBytes: png.length,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      file: outputPath,
      approach: 'B (pdf.js)',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ============================================================================
// Approach C: For Office docs — skip PDF intermediate, upload with HTML wrapper
// ============================================================================
async function approachC(
  docBuffer: Buffer,
  mimeType: string,
  outputPath: string
): Promise<SpikeResult> {
  const start = Date.now();
  try {
    // First convert Office → PDF via LibreOffice
    const extMap: Record<string, string> = {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    };
    const ext = extMap[mimeType] ?? '.bin';
    const filename = `document${ext}`;

    const boundary = `----SpikeBoundary${Date.now()}`;
    const body = buildMultipartBody(boundary, filename, docBuffer);

    const convertRes = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!convertRes.ok) {
      throw new Error(`LibreOffice convert failed: ${convertRes.status}`);
    }

    const pdfBuffer = Buffer.from(await convertRes.arrayBuffer());

    // Then screenshot the PDF via Approach A
    const result = await approachA(pdfBuffer, outputPath);
    return { ...result, approach: `C (Office→PDF→screenshot)` };
  } catch (err) {
    return {
      file: outputPath,
      approach: 'C (Office→PDF→screenshot)',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function gotenbergScreenshot(html: string, width: number, height: number): Promise<Buffer> {
  const boundary = `----SpikeBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  // HTML file
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n`
    )
  );
  parts.push(Buffer.from(html, 'utf-8'));
  parts.push(Buffer.from('\r\n'));

  // Screenshot params
  const fields: Record<string, string> = {
    width: String(width),
    height: String(height),
    format: 'png',
    optimizeForSpeed: 'true',
  };
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
      )
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);
  const response = await fetch(`${GOTENBERG_URL}/forms/chromium/screenshot/html`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Screenshot failed: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function buildMultipartBody(boundary: string, filename: string, data: Buffer): Buffer {
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([header, data, footer]);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n=== Thumbnail Spike Test ===`);
  console.log(`Gotenberg URL: ${GOTENBERG_URL}`);
  console.log(`Output directory: ${OUTPUT_DIR}\n`);

  // Check Gotenberg health
  try {
    const healthRes = await fetch(`${GOTENBERG_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!healthRes.ok) {
      console.error(`Gotenberg health check failed: ${healthRes.status}`);
      process.exit(1);
    }
    console.log('Gotenberg: healthy\n');
  } catch (err) {
    console.error('Cannot reach Gotenberg:', err);
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results: SpikeResult[] = [];

  for (const testFile of TEST_FILES) {
    const filePath = path.join(__dirname, '..', testFile.path);
    if (!fs.existsSync(filePath)) {
      console.log(`SKIP: ${testFile.name} not found at ${filePath}`);
      console.log(`  Place test files in spike-samples/ directory\n`);
      continue;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const outputBase = path.join(OUTPUT_DIR, testFile.name);
    console.log(`Testing: ${testFile.name} (${fileBuffer.length} bytes)`);

    if (testFile.mimeType === 'application/pdf') {
      // PDF: test approaches A and B
      const resultA = await approachA(fileBuffer, outputBase);
      results.push(resultA);
      console.log(
        `  Approach A: ${resultA.success ? 'PASS' : 'FAIL'} (${resultA.durationMs}ms)${resultA.error ? ` - ${resultA.error}` : ''}`
      );

      const resultB = await approachB(fileBuffer, outputBase);
      results.push(resultB);
      console.log(
        `  Approach B: ${resultB.success ? 'PASS' : 'FAIL'} (${resultB.durationMs}ms)${resultB.error ? ` - ${resultB.error}` : ''}`
      );
    } else {
      // Office: test approach C
      const resultC = await approachC(fileBuffer, testFile.mimeType, outputBase);
      results.push(resultC);
      console.log(
        `  Approach C: ${resultC.success ? 'PASS' : 'FAIL'} (${resultC.durationMs}ms)${resultC.error ? ` - ${resultC.error}` : ''}`
      );
    }

    console.log();
  }

  // Summary
  console.log(`\n=== Summary ===`);
  const passed = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  console.log(`Passed: ${passed.length}/${results.length}`);
  console.log(`Failed: ${failed.length}/${results.length}`);

  if (passed.length > 0) {
    console.log(`\nSuccessful outputs:`);
    for (const r of passed) {
      console.log(`  ${r.approach}: ${r.outputFile} (${r.fileSizeBytes} bytes)`);
    }
  }

  if (failed.length > 0) {
    console.log(`\nFailed:`);
    for (const r of failed) {
      console.log(`  ${r.approach}: ${r.error}`);
    }
  }

  const pdfPassed = passed.some(
    (r) => r.file.includes('.pdf') && (r.approach.includes('A') || r.approach.includes('B'))
  );
  console.log(`\nDecision gate:`);
  if (pdfPassed) {
    console.log(
      `  PDF rendering WORKS -> Proceed to Phase 2 with content thumbnails for all types.`
    );
  } else {
    console.log(`  PDF rendering FAILED -> Use branded placeholders for PDF/Office types.`);
    console.log(`  Focus Phase 2 on text/markdown/HTML/CSV/SVG thumbnails only.`);
  }
}

main().catch((err) => {
  console.error('Spike failed:', err);
  process.exit(1);
});
