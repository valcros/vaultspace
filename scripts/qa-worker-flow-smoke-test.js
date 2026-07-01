#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * VaultSpace worker-flow smoke test.
 *
 * Exercises password reset, digest email queueing, upload/worker processing,
 * preview, and room export against a deployed environment.
 *
 * Required env:
 * - QA_USER_EMAIL
 * - QA_USER_PASSWORD
 *
 * Optional env:
 * - QA_BASE_URL, defaults to https://www.vaultspace.org
 * - QA_POLL_TIMEOUT_MS, defaults to 120000
 * - QA_ALLOW_EMAIL_TESTS=true to send password reset and digest emails
 * - QA_ALLOW_EXPORT_EMAIL=true to send the export download email
 */

const BASE_URL = process.env['QA_BASE_URL'] || 'https://www.vaultspace.org';
const USER_EMAIL = process.env['QA_USER_EMAIL'];
const USER_PASSWORD = process.env['QA_USER_PASSWORD'];
const POLL_TIMEOUT_MS = Number(process.env['QA_POLL_TIMEOUT_MS'] || 120000);
const POLL_INTERVAL_MS = 3000;
const ALLOW_EMAIL_TESTS = process.env['QA_ALLOW_EMAIL_TESTS'] === 'true';
const ALLOW_EXPORT_EMAIL = process.env['QA_ALLOW_EXPORT_EMAIL'] === 'true';

const results = [];
const artifacts = {};
let sessionCookie = null;
let roomId = null;
let documentId = null;
let exportJobId = null;

function maskEmail(value) {
  if (!value || !value.includes('@')) {
    return '(not set)';
  }
  const [local, domain] = value.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest(name, fn) {
  const start = Date.now();
  try {
    const details = await fn();
    results.push({ name, status: 'PASS', durationMs: Date.now() - start, details });
    console.log(`PASS ${name}`);
    if (details) {
      console.log(`     ${details}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, status: 'FAIL', durationMs: Date.now() - start, error: message });
    console.log(`FAIL ${name}: ${message}`);
  }
}

async function skipTest(name, details) {
  results.push({ name, status: 'SKIP', durationMs: 0, details });
  console.log(`SKIP ${name}`);
  console.log(`     ${details}`);
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON response, got: ${text.slice(0, 200)}`);
  }
}

async function fetchJson(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (sessionCookie) {
    headers.set('Cookie', `vaultspace-session=${sessionCookie}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  const data = await readJson(response);
  return { response, data };
}

function assertOk(response, data, label, expectedStatuses = [200]) {
  if (!expectedStatuses.includes(response.status)) {
    const detail =
      data?.error?.message ||
      (typeof data?.error === 'string' ? data.error : JSON.stringify(data?.error ?? data)) ||
      response.statusText;
    throw new Error(`${label} failed with ${response.status}: ${detail}`);
  }
}

async function login() {
  if (!USER_EMAIL || !USER_PASSWORD) {
    throw new Error('QA_USER_EMAIL and QA_USER_PASSWORD must be set');
  }

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
  });
  const data = await readJson(response);
  assertOk(response, data, 'Login');

  const setCookieHeader = response.headers.get('set-cookie') || '';
  const match = setCookieHeader.match(/vaultspace-session=([^;]+)/);
  if (!match) {
    throw new Error('Login did not return a vaultspace-session cookie');
  }
  sessionCookie = match[1];
  return `authenticated as ${maskEmail(data.user?.email || USER_EMAIL)}`;
}

async function smokePasswordReset() {
  const { response, data } = await fetchJson('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: USER_EMAIL }),
  });
  assertOk(response, data, 'Password reset', [200]);
  if (data.success !== true) {
    throw new Error('Password reset response did not include success=true');
  }
  return 'password reset accepted and email job queued';
}

async function createRoom() {
  const name = `QA Worker Smoke ${new Date().toISOString()}`;
  const { response, data } = await fetchJson('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: 'Temporary automated worker-flow smoke room',
    }),
  });
  assertOk(response, data, 'Create room', [201, 200]);
  roomId = data.room?.id;
  if (!roomId) {
    throw new Error('Create room response did not include room.id');
  }
  artifacts.roomId = roomId;

  const update = await fetchJson(`/api/rooms/${roomId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ACTIVE' }),
  });
  assertOk(update.response, update.data, 'Activate room');

  return `roomId=${roomId}, status=ACTIVE`;
}

async function uploadDocument() {
  if (!roomId) {
    throw new Error('No roomId available');
  }

  const content = [
    'VaultSpace QA worker smoke test',
    `Generated at ${new Date().toISOString()}`,
    'This file exercises upload, scan, preview, text extraction, digest, and export paths.',
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([content], { type: 'text/plain' }), 'qa-worker-smoke.txt');
  formData.append('tags', JSON.stringify(['qa', 'worker-smoke']));

  const { response, data } = await fetchJson(`/api/rooms/${roomId}/documents`, {
    method: 'POST',
    body: formData,
  });
  assertOk(response, data, 'Upload document', [201]);

  documentId = data.documents?.[0]?.id;
  if (!documentId) {
    throw new Error('Upload response did not include document id');
  }
  artifacts.documentId = documentId;
  return `documentId=${documentId}`;
}

async function pollDocumentProcessing() {
  if (!roomId || !documentId) {
    throw new Error('Missing roomId or documentId');
  }
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastDoc = null;

  while (Date.now() < deadline) {
    const { response, data } = await fetchJson(`/api/rooms/${roomId}/documents?limit=100`);
    assertOk(response, data, 'List documents');
    lastDoc = (data.documents || []).find((doc) => doc.id === documentId);
    if (!lastDoc) {
      throw new Error('Uploaded document was not returned by document list');
    }

    const scanStatus = lastDoc.scanStatus;
    const previewStatus = lastDoc.previewStatus;
    if (scanStatus === 'INFECTED' || scanStatus === 'ERROR') {
      throw new Error(`Scan finished with ${scanStatus}`);
    }
    if (previewStatus === 'FAILED') {
      throw new Error('Preview generation failed');
    }
    if (scanStatus === 'CLEAN' && previewStatus === 'READY') {
      return `scanStatus=${scanStatus}, previewStatus=${previewStatus}`;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for worker processing; last scanStatus=${lastDoc?.scanStatus}, previewStatus=${lastDoc?.previewStatus}`
  );
}

async function previewDocument() {
  if (!roomId || !documentId) {
    throw new Error('Missing roomId or documentId');
  }

  const response = await fetch(`${BASE_URL}/api/rooms/${roomId}/documents/${documentId}/preview`, {
    headers: { Cookie: `vaultspace-session=${sessionCookie}` },
  });
  if (response.status !== 200) {
    const data = await readJson(response).catch(() => ({}));
    throw new Error(`Preview failed with ${response.status}: ${data.error || response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const bytes = Buffer.from(await response.arrayBuffer()).length;
  if (bytes === 0) {
    throw new Error('Preview response was empty');
  }
  return `contentType=${contentType}, bytes=${bytes}`;
}

async function queueDigestEmail() {
  if (!roomId) {
    throw new Error('No roomId available');
  }

  const { response, data } = await fetchJson(`/api/rooms/${roomId}/reports/digest`, {
    method: 'POST',
    body: JSON.stringify({ period: 'daily' }),
  });
  assertOk(response, data, 'Queue digest email', [202]);
  if (!Array.isArray(data.jobIds)) {
    throw new Error('Digest response did not include jobIds array');
  }
  artifacts.digestJobIds = data.jobIds;
  return `recipientCount=${data.recipientCount}, jobIds=${data.jobIds.length}`;
}

async function startExport() {
  if (!roomId || !documentId) {
    throw new Error('Missing roomId or documentId');
  }

  const { response, data } = await fetchJson(`/api/rooms/${roomId}/export`, {
    method: 'POST',
    body: JSON.stringify({
      includeOriginals: true,
      includePreviews: true,
      includeMetadata: true,
      documentIds: [documentId],
      sendEmail: ALLOW_EXPORT_EMAIL,
    }),
  });
  assertOk(response, data, 'Start export', [202]);
  exportJobId = data.jobId;
  if (!exportJobId) {
    throw new Error('Export response did not include jobId');
  }
  artifacts.exportJobId = exportJobId;
  return `exportJobId=${exportJobId}, email=${ALLOW_EXPORT_EMAIL ? 'enabled' : 'suppressed'}`;
}

async function pollExportCompletion() {
  if (!roomId || !exportJobId) {
    throw new Error('Missing roomId or exportJobId');
  }
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = 'unknown';

  while (Date.now() < deadline) {
    const { response, data } = await fetchJson(
      `/api/rooms/${roomId}/export?jobId=${encodeURIComponent(exportJobId)}`
    );
    assertOk(response, data, 'Get export status');
    lastStatus = data.status;

    if (lastStatus === 'completed') {
      return `status=${lastStatus}`;
    }
    if (lastStatus === 'failed') {
      throw new Error('Export job failed');
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for export completion; last status=${lastStatus}`);
}

async function cleanupRoom() {
  if (!roomId || !sessionCookie) {
    return 'no room to clean up';
  }
  const { response, data } = await fetchJson(`/api/rooms/${roomId}`, { method: 'DELETE' });
  assertOk(response, data, 'Cleanup room', [200]);
  return `closed roomId=${roomId}`;
}

async function main() {
  console.log('VaultSpace worker-flow smoke test');
  console.log(`Target: ${BASE_URL}`);
  console.log(`User: ${maskEmail(USER_EMAIL)}`);
  console.log(`Poll timeout: ${POLL_TIMEOUT_MS}ms`);
  console.log(
    `Password reset and digest email tests: ${ALLOW_EMAIL_TESTS ? 'enabled' : 'skipped'}`
  );
  console.log(`Export download email: ${ALLOW_EXPORT_EMAIL ? 'enabled' : 'suppressed'}`);

  await runTest('health deep', async () => {
    const { response, data } = await fetchJson('/api/health?deep=true');
    assertOk(response, data, 'Health deep');
    if (data.status !== 'healthy') {
      throw new Error(`Health status was ${data.status}`);
    }
    return `mode=${data.mode}, degraded=${(data.degraded || []).join(',') || 'none'}`;
  });
  if (ALLOW_EMAIL_TESTS) {
    await runTest('password reset', smokePasswordReset);
  } else {
    await skipTest('password reset', 'set QA_ALLOW_EMAIL_TESTS=true to send reset email');
  }
  await runTest('login', login);
  await runTest('create temporary room', createRoom);
  await runTest('upload document', uploadDocument);
  await runTest('worker processing', pollDocumentProcessing);
  await runTest('preview document', previewDocument);
  if (ALLOW_EMAIL_TESTS) {
    await runTest('digest email', queueDigestEmail);
  } else {
    await skipTest('digest email', 'set QA_ALLOW_EMAIL_TESTS=true to queue digest emails');
  }
  await runTest('start export', startExport);
  await runTest('export completion', pollExportCompletion);

  console.log('Cleanup');
  await runTest('close temporary room', cleanupRoom);

  const passed = results.filter((result) => result.status === 'PASS').length;
  const failed = results.filter((result) => result.status === 'FAIL').length;
  const skipped = results.filter((result) => result.status === 'SKIP').length;
  const summary = {
    target: BASE_URL,
    user: maskEmail(USER_EMAIL),
    passed,
    failed,
    skipped,
    artifacts,
    results,
  };

  console.log('Summary JSON');
  console.log(JSON.stringify(summary, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
