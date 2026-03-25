#!/usr/bin/env node
/**
 * VaultSpace MVP Smoke Test
 *
 * Automated critical path tests for MVP functionality.
 * Run with: node scripts/qa-smoke-test.js
 *
 * Requires environment variables:
 * - QA_BASE_URL: Base URL of the deployment (default: https://www.vaultspace.org)
 * - QA_USER_EMAIL: Test user email
 * - QA_USER_PASSWORD: Test user password
 */

const BASE_URL = process.env['QA_BASE_URL'] || 'https://www.vaultspace.org';
const USER_EMAIL = process.env['QA_USER_EMAIL'];
const USER_PASSWORD = process.env['QA_USER_PASSWORD'];

const results = [];
let sessionCookie = null;
let roomId = null;
let folderId = null;
let linkId = null;

async function runTest(name, fn) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✅ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message, duration: Date.now() - start });
    console.log(`❌ ${name}: ${message}`);
  }
}

async function fetchWithAuth(path, options = {}) {
  const headers = new Headers(options.headers);
  if (sessionCookie) {
    headers.set('Cookie', `vaultspace-session=${sessionCookie}`);
  }
  headers.set('Content-Type', 'application/json');

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
}

// Test 1: Health Check
async function testHealthCheck() {
  const response = await fetch(`${BASE_URL}/api/health`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  const data = await response.json();
  if (data.status !== 'healthy' && data.status !== 'ok') {
    throw new Error(`Health check returned: ${data.status}`);
  }
}

// Test 2: Login
async function testLogin() {
  if (!USER_EMAIL || !USER_PASSWORD) {
    throw new Error('QA_USER_EMAIL and QA_USER_PASSWORD must be set');
  }

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
  });

  const setCookieHeader = response.headers.get('set-cookie');

  if (!response.ok) {
    let errorMessage = `Status ${response.status}`;
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch {}
    throw new Error(`Login failed: ${errorMessage}`);
  }

  const data = await response.json();
  if (!data.user) {
    throw new Error('Login response missing user data');
  }

  // Extract session cookie from Set-Cookie header
  if (setCookieHeader) {
    const match = setCookieHeader.match(/vaultspace-session=([^;]+)/);
    if (match) {
      sessionCookie = match[1];
    }
  }

  if (!sessionCookie) {
    throw new Error('No session cookie received from login');
  }

  console.log(`   Logged in as: ${data.user.email}`);
}

// Test 3: List Rooms
async function testListRooms() {
  const response = await fetchWithAuth('/api/rooms');
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`List rooms failed: ${err.error || response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.rooms)) {
    throw new Error('Rooms response is not an array');
  }
  console.log(`   Found ${data.rooms.length} rooms`);
}

// Test 4: Create Room
async function testCreateRoom() {
  const response = await fetchWithAuth('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: `QA Test Room ${Date.now()}`,
      description: 'Automated QA test room',
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Create room failed: ${err.error || response.status}`);
  }

  const data = await response.json();
  if (!data.room?.id) {
    throw new Error('Room creation response missing room ID');
  }

  roomId = data.room.id;
  console.log(`   Created room: ${roomId}`);
}

// Test 5: Get Room Details
async function testGetRoom() {
  if (!roomId) throw new Error('No room ID available');

  const response = await fetchWithAuth(`/api/rooms/${roomId}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Get room failed: ${err.error || response.status}`);
  }

  const data = await response.json();
  if (!data.room) {
    throw new Error('Room response missing room data');
  }
}

// Test 6: Create Folder
async function testCreateFolder() {
  if (!roomId) throw new Error('No room ID available');

  const response = await fetchWithAuth(`/api/rooms/${roomId}/folders`, {
    method: 'POST',
    body: JSON.stringify({ name: 'QA Test Folder' }),
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Create folder failed: Invalid JSON response - ${responseText}`);
  }

  if (!response.ok) {
    const errorMsg =
      typeof data.error === 'object' ? JSON.stringify(data.error) : data.error || response.status;
    throw new Error(`Create folder failed: ${errorMsg}`);
  }

  if (!data.folder?.id) {
    throw new Error(`Folder creation response missing folder ID: ${JSON.stringify(data)}`);
  }

  folderId = data.folder.id;
  console.log(`   Created folder: ${folderId}`);
}

// Test 7: List Folders
async function testListFolders() {
  if (!roomId) throw new Error('No room ID available');

  const response = await fetchWithAuth(`/api/rooms/${roomId}/folders`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`List folders failed: ${err.error || response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.folders)) {
    throw new Error('Folders response is not an array');
  }
  console.log(`   Found ${data.folders.length} folders`);
}

// Test 8: Create Share Link
async function testCreateShareLink() {
  if (!roomId) throw new Error('No room ID available');

  const response = await fetchWithAuth(`/api/rooms/${roomId}/links`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'QA Test Link',
      permission: 'VIEW',
      scope: 'ENTIRE_ROOM',
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Create link failed: ${err.error || response.status}`);
  }

  const data = await response.json();
  if (!data.link?.id) {
    throw new Error('Link creation response missing link ID');
  }

  linkId = data.link.id;
  console.log(`   Created link: ${linkId}`);
}

// Test 9: List Share Links
async function testListShareLinks() {
  if (!roomId) throw new Error('No room ID available');

  const response = await fetchWithAuth(`/api/rooms/${roomId}/links`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`List links failed: ${err.error || response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.links)) {
    throw new Error('Links response is not an array');
  }
  console.log(`   Found ${data.links.length} links`);
}

// Test 10: List Room Admins
async function testListAdmins() {
  if (!roomId) throw new Error('No room ID available');

  const response = await fetchWithAuth(`/api/rooms/${roomId}/admins`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`List admins failed: ${err.error || response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.admins)) {
    throw new Error('Admins response is not an array');
  }
  console.log(`   Found ${data.admins.length} admins`);
}

// Test 11: Get Audit Log
async function testAuditLog() {
  if (!roomId) throw new Error('No room ID available');

  const response = await fetchWithAuth(`/api/rooms/${roomId}/audit`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Audit log failed: ${err.error || response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.events)) {
    throw new Error('Audit events response is not an array');
  }
  console.log(`   Found ${data.events.length} audit events`);
}

// Test 12: Delete Share Link
async function testDeleteShareLink() {
  if (!roomId || !linkId) throw new Error('No room ID or link ID available');

  const response = await fetchWithAuth(`/api/rooms/${roomId}/links/${linkId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Delete link failed: ${err.error || response.status}`);
  }
  console.log(`   Deleted link: ${linkId}`);
}

// Test 13: Delete Folder
async function testDeleteFolder() {
  if (!roomId || !folderId) throw new Error('No room ID or folder ID available');

  const response = await fetchWithAuth(`/api/rooms/${roomId}/folders/${folderId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Delete folder failed: ${err.error || response.status}`);
  }
  console.log(`   Deleted folder: ${folderId}`);
}

// Cleanup: Delete test room
async function cleanupTestRoom() {
  if (!roomId) return;

  try {
    await fetchWithAuth(`/api/rooms/${roomId}`, { method: 'DELETE' });
    console.log(`   Deleted room: ${roomId}`);
  } catch {
    console.log('   Room cleanup skipped (may not exist)');
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     VaultSpace MVP Smoke Test Suite      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\nTarget: ${BASE_URL}`);
  console.log(`User: ${USER_EMAIL || '(not set)'}\n`);

  // Run tests
  await runTest('Health Check', testHealthCheck);
  await runTest('Login', testLogin);
  await runTest('List Rooms', testListRooms);
  await runTest('Create Room', testCreateRoom);
  await runTest('Get Room Details', testGetRoom);
  await runTest('Create Folder', testCreateFolder);
  await runTest('List Folders', testListFolders);
  await runTest('Create Share Link', testCreateShareLink);
  await runTest('List Share Links', testListShareLinks);
  await runTest('List Room Admins', testListAdmins);
  await runTest('Get Audit Log', testAuditLog);
  await runTest('Delete Share Link', testDeleteShareLink);
  await runTest('Delete Folder', testDeleteFolder);

  // Cleanup
  console.log('\n--- Cleanup ---');
  await cleanupTestRoom();

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║              Test Summary                ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\nTotal: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);

  if (failed > 0) {
    console.log('\n--- Failed Tests ---');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`❌ ${r.name}: ${r.error}`);
      });
    process.exit(1);
  }

  console.log('\n✅ All tests passed!');
}

main().catch(console.error);
