#!/usr/bin/env npx ts-node
/**
 * VaultSpace MVP Smoke Test
 *
 * Automated critical path tests for MVP functionality.
 * Run with: npx ts-node scripts/qa-smoke-test.ts
 *
 * Requires environment variables:
 * - QA_BASE_URL: Base URL of the deployment (default: http://localhost:3000)
 * - QA_USER_EMAIL: Test user email
 * - QA_USER_PASSWORD: Test user password
 */

const BASE_URL = process.env['QA_BASE_URL'] || 'https://www.vaultspace.org';
const USER_EMAIL = process.env['QA_USER_EMAIL'];
const USER_PASSWORD = process.env['QA_USER_PASSWORD'];

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let authToken: string | null = null;
let roomId: string | null = null;
let documentId: string | null = null;
let folderId: string | null = null;
let linkId: string | null = null;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
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

async function fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (authToken) {
    headers.set('Cookie', `vaultspace-session=${authToken}`);
  }
  headers.set('Content-Type', 'application/json');

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
}

// Test 1: Health Check
async function testHealthCheck(): Promise<void> {
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
async function testLogin(): Promise<void> {
  if (!USER_EMAIL || !USER_PASSWORD) {
    throw new Error('QA_USER_EMAIL and QA_USER_PASSWORD must be set');
  }

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
  });

  // Get all headers for debugging
  const setCookieHeader = response.headers.get('set-cookie');

  if (!response.ok) {
    let errorMessage = `Status ${response.status}`;
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch {
      // Response might not be JSON
    }
    throw new Error(`Login failed: ${errorMessage}`);
  }

  const data = await response.json();
  if (!data.user) {
    throw new Error('Login response missing user data');
  }

  // Extract session cookie from Set-Cookie header
  if (setCookieHeader) {
    // Handle multiple cookies
    const cookies = setCookieHeader.split(/,(?=\s*\w+=)/);
    for (const cookie of cookies) {
      const match = cookie.match(/vaultspace-session=([^;]+)/);
      if (match) {
        authToken = match[1];
        break;
      }
    }
  }

  if (!authToken) {
    throw new Error('No session cookie received from login');
  }

  console.log(`   Logged in as: ${data.user.email}`);
}

// Test 3: List Rooms
async function testListRooms(): Promise<void> {
  const response = await fetchWithAuth('/api/rooms');
  if (!response.ok) {
    throw new Error(`List rooms failed: ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.rooms)) {
    throw new Error('Rooms response is not an array');
  }
}

// Test 4: Create Room
async function testCreateRoom(): Promise<void> {
  const response = await fetchWithAuth('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: `QA Test Room ${Date.now()}`,
      description: 'Automated QA test room',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Create room failed: ${error.error || response.status}`);
  }

  const data = await response.json();
  if (!data.room?.id) {
    throw new Error('Room creation response missing room ID');
  }

  roomId = data.room.id;
}

// Test 5: Create Folder
async function testCreateFolder(): Promise<void> {
  if (!roomId) {
    throw new Error('No room ID available');
  }

  const response = await fetchWithAuth(`/api/rooms/${roomId}/folders`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'QA Test Folder',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Create folder failed: ${error.error || response.status}`);
  }

  const data = await response.json();
  if (!data.folder?.id) {
    throw new Error('Folder creation response missing folder ID');
  }

  folderId = data.folder.id;
}

// Test 6: List Folders
async function testListFolders(): Promise<void> {
  if (!roomId) {
    throw new Error('No room ID available');
  }

  const response = await fetchWithAuth(`/api/rooms/${roomId}/folders`);
  if (!response.ok) {
    throw new Error(`List folders failed: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.folders)) {
    throw new Error('Folders response is not an array');
  }
}

// Test 7: Create Share Link
async function testCreateShareLink(): Promise<void> {
  if (!roomId) {
    throw new Error('No room ID available');
  }

  const response = await fetchWithAuth(`/api/rooms/${roomId}/links`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'QA Test Link',
      permission: 'VIEW',
      scope: 'ENTIRE_ROOM',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Create link failed: ${error.error || response.status}`);
  }

  const data = await response.json();
  if (!data.link?.id) {
    throw new Error('Link creation response missing link ID');
  }

  linkId = data.link.id;
}

// Test 8: List Share Links
async function testListShareLinks(): Promise<void> {
  if (!roomId) {
    throw new Error('No room ID available');
  }

  const response = await fetchWithAuth(`/api/rooms/${roomId}/links`);
  if (!response.ok) {
    throw new Error(`List links failed: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.links)) {
    throw new Error('Links response is not an array');
  }
}

// Test 9: Delete Share Link
async function testDeleteShareLink(): Promise<void> {
  if (!roomId || !linkId) {
    throw new Error('No room ID or link ID available');
  }

  const response = await fetchWithAuth(`/api/rooms/${roomId}/links/${linkId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Delete link failed: ${error.error || response.status}`);
  }
}

// Test 10: Delete Folder
async function testDeleteFolder(): Promise<void> {
  if (!roomId || !folderId) {
    throw new Error('No room ID or folder ID available');
  }

  const response = await fetchWithAuth(`/api/rooms/${roomId}/folders/${folderId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Delete folder failed: ${error.error || response.status}`);
  }
}

// Test 11: List Admins
async function testListAdmins(): Promise<void> {
  if (!roomId) {
    throw new Error('No room ID available');
  }

  const response = await fetchWithAuth(`/api/rooms/${roomId}/admins`);
  if (!response.ok) {
    throw new Error(`List admins failed: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.admins)) {
    throw new Error('Admins response is not an array');
  }
}

// Test 12: Get Room Audit Log
async function testAuditLog(): Promise<void> {
  if (!roomId) {
    throw new Error('No room ID available');
  }

  const response = await fetchWithAuth(`/api/rooms/${roomId}/audit`);
  if (!response.ok) {
    throw new Error(`Audit log failed: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.events)) {
    throw new Error('Audit events response is not an array');
  }
}

// Test 13: Room Settings
async function testRoomSettings(): Promise<void> {
  if (!roomId) {
    throw new Error('No room ID available');
  }

  const response = await fetchWithAuth(`/api/rooms/${roomId}`);
  if (!response.ok) {
    throw new Error(`Get room failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.room) {
    throw new Error('Room response missing room data');
  }
}

// Cleanup: Delete test room
async function cleanupTestRoom(): Promise<void> {
  if (!roomId) {
    return;
  }

  try {
    // Archive the room (soft delete)
    await fetchWithAuth(`/api/rooms/${roomId}`, {
      method: 'DELETE',
    });
  } catch {
    // Ignore cleanup errors
  }
}

async function main(): Promise<void> {
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
  await runTest('Get Room Settings', testRoomSettings);
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
  console.log('Test room cleaned up\n');

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('╔══════════════════════════════════════════╗');
  console.log('║              Test Summary                ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\nTotal: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);

  if (failed > 0) {
    console.log('\n--- Failed Tests ---');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`❌ ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\n✅ All tests passed!');
}

main().catch(console.error);
