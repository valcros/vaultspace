#!/usr/bin/env node

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS operator runner. */

const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const baseUrl = process.env.QA_BASE_URL;
const organizationSlug = process.env.CLOUDVAULT_ORG_SLUG;
const databaseUrl = process.env.DATABASE_URL;
const expectedOrganizationName = 'CloudVault';

if (!baseUrl || !organizationSlug || !databaseUrl) {
  console.error(
    'QA_BASE_URL, CLOUDVAULT_ORG_SLUG, and DATABASE_URL are required. Secret values are never printed.'
  );
  process.exit(2);
}

let validatedBaseUrl;
try {
  const candidateBaseUrl = new URL(baseUrl);
  const allowedHosts = new Set(['vaultspace.org', 'www.vaultspace.org']);
  assert.equal(candidateBaseUrl.protocol, 'https:', 'QA base URL must use HTTPS');
  assert.ok(allowedHosts.has(candidateBaseUrl.hostname), 'QA base URL must use vaultspace.org');
  assert.equal(candidateBaseUrl.pathname, '/', 'QA base URL must not include a path');
  validatedBaseUrl = candidateBaseUrl.origin;
} catch (error) {
  console.error('QA_TARGET_REJECTED ' + (error instanceof Error ? error.message : String(error)));
  process.exit(2);
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: [],
});

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const accountPassword = randomBytes(24).toString('base64url');
const linkPassword = randomBytes(18).toString('base64url');
const viewerEmail = 'w11-viewer-' + suffix + '@example.test';
const secondEmail = 'w11-second-' + suffix + '@example.test';
const adminEmail = 'w11-admin-' + suffix + '@example.test';
const linkEmail = 'w11-link-' + suffix + '@example.test';

const fixture = {
  userIds: [],
  roomIds: [],
  documentIds: [],
  permissionIds: [],
  groupIds: [],
  linkIds: [],
};

const results = [];

function pass(name) {
  results.push(name);
  console.log('PASS  ' + name);
}

async function check(name, operation) {
  await operation();
  pass(name);
}

function cookieFrom(response, name) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  const prefix = name + '=';

  for (const value of values) {
    const start = value.indexOf(prefix);
    if (start === -1) continue;
    const remainder = value.slice(start + prefix.length);
    const end = remainder.indexOf(';');
    return prefix + (end === -1 ? remainder : remainder.slice(0, end));
  }

  return null;
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'VaultSpace-W1-1-CloudVault-Acceptance',
  };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(validatedBaseUrl + path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { response, status: response.status, data };
}

function expectStatus(actual, expected, label) {
  assert.equal(
    actual.status,
    expected,
    label + ': expected HTTP ' + expected + ', got ' + actual.status
  );
}

async function login(email) {
  const result = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: accountPassword },
  });
  expectStatus(result, 200, 'login');
  const cookie = cookieFrom(result.response, 'vaultspace-session');
  assert.ok(cookie, 'login did not return a session cookie');
  return cookie;
}

function viewerCookie(result, slug) {
  const cookie = cookieFrom(result.response, 'viewer_' + slug);
  assert.ok(cookie, 'viewer admission did not return a session cookie');
  return cookie;
}

async function createLink(organizationId, roomId, input) {
  const link = await db.link.create({
    data: {
      organizationId,
      roomId,
      slug: 'w11-' + suffix + '-' + input.code,
      name: 'W1 synthetic ' + input.code,
      permission: input.permission || 'VIEW',
      scope: input.scope || 'ENTIRE_ROOM',
      scopedFolderId: input.scopedFolderId || null,
      scopedDocumentId: input.scopedDocumentId || null,
      isActive: input.isActive === undefined ? true : input.isActive,
      expiresAt: input.expiresAt || null,
      maxViews: input.maxViews === undefined ? null : input.maxViews,
      maxSessionMinutes: input.maxSessionMinutes === undefined ? null : input.maxSessionMinutes,
      requiresPassword: input.requiresPassword || false,
      passwordHash: input.passwordHash || null,
      requiresEmailVerification: input.requiresEmailVerification || false,
      allowedEmails: input.allowedEmails || [],
    },
  });
  fixture.linkIds.push(link.id);
  return link;
}

async function cleanup() {
  try {
    if (fixture.linkIds.length) {
      await db.viewSession.updateMany({
        where: { linkId: { in: fixture.linkIds } },
        data: { isActive: false },
      });
      await db.link.updateMany({
        where: { id: { in: fixture.linkIds } },
        data: { isActive: false },
      });
    }
    if (fixture.permissionIds.length) {
      await db.permission.updateMany({
        where: { id: { in: fixture.permissionIds } },
        data: { isActive: false },
      });
    }
    if (fixture.groupIds.length) {
      await db.groupMembership.deleteMany({ where: { groupId: { in: fixture.groupIds } } });
      await db.group.updateMany({
        where: { id: { in: fixture.groupIds } },
        data: { isActive: false },
      });
    }
    if (fixture.userIds.length) {
      await db.session.updateMany({
        where: { userId: { in: fixture.userIds } },
        data: { isActive: false },
      });
      await db.roleAssignment.deleteMany({ where: { userId: { in: fixture.userIds } } });
      await db.userOrganization.updateMany({
        where: { userId: { in: fixture.userIds } },
        data: { isActive: false },
      });
      await db.user.updateMany({
        where: { id: { in: fixture.userIds } },
        data: { isActive: false },
      });
    }
    if (fixture.documentIds.length) {
      await db.document.updateMany({
        where: { id: { in: fixture.documentIds } },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
    }
    if (fixture.roomIds.length) {
      await db.room.updateMany({
        where: { id: { in: fixture.roomIds } },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    }
    console.log('PASS  synthetic fixture soft-disabled; immutable audit events retained');
  } catch (error) {
    console.error('CLEANUP_FAILURE ' + (error instanceof Error ? error.message : String(error)));
  }
}

async function run() {
  let failed = false;

  try {
    const organization = await db.organization.findUnique({
      where: { slug: organizationSlug },
      select: { id: true, isActive: true, name: true },
    });
    assert.ok(
      organization && organization.isActive && organization.name === expectedOrganizationName,
      'exact CloudVault organization is unavailable'
    );

    const passwordHash = await bcrypt.hash(accountPassword, 10);
    const [admin, viewer, second] = await Promise.all([
      db.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          firstName: 'W1',
          lastName: 'Synthetic Admin',
          emailVerifiedAt: new Date(),
        },
      }),
      db.user.create({
        data: {
          email: viewerEmail,
          passwordHash,
          firstName: 'W1',
          lastName: 'Synthetic Viewer',
          emailVerifiedAt: new Date(),
        },
      }),
      db.user.create({
        data: {
          email: secondEmail,
          passwordHash,
          firstName: 'W1',
          lastName: 'Synthetic Second',
          emailVerifiedAt: new Date(),
        },
      }),
    ]);
    fixture.userIds.push(admin.id, viewer.id, second.id);

    await db.userOrganization.createMany({
      data: [
        {
          organizationId: organization.id,
          userId: admin.id,
          role: 'ADMIN',
          canManageUsers: true,
          canManageRooms: true,
        },
        { organizationId: organization.id, userId: viewer.id, role: 'VIEWER' },
        { organizationId: organization.id, userId: second.id, role: 'VIEWER' },
      ],
    });

    const [roomOne, roomTwo, gatedRoom] = await Promise.all([
      db.room.create({
        data: {
          organizationId: organization.id,
          name: 'W1 synthetic room one ' + suffix,
          slug: 'w1-room-one-' + suffix,
          status: 'ACTIVE',
          requiresEmailVerification: false,
          createdByUserId: admin.id,
        },
      }),
      db.room.create({
        data: {
          organizationId: organization.id,
          name: 'W1 synthetic room two ' + suffix,
          slug: 'w1-room-two-' + suffix,
          status: 'ACTIVE',
          requiresEmailVerification: false,
          createdByUserId: admin.id,
        },
      }),
      db.room.create({
        data: {
          organizationId: organization.id,
          name: 'W1 synthetic gated room ' + suffix,
          slug: 'w1-room-gated-' + suffix,
          status: 'ACTIVE',
          requiresEmailVerification: false,
          requiresNda: true,
          ndaContent: 'Synthetic acceptance terms',
          createdByUserId: admin.id,
        },
      }),
    ]);
    fixture.roomIds.push(roomOne.id, roomTwo.id, gatedRoom.id);

    const parentFolder = await db.folder.create({
      data: {
        organizationId: organization.id,
        roomId: roomOne.id,
        name: 'W1 parent ' + suffix,
        path: '/w1-parent-' + suffix,
      },
    });
    const nestedFolder = await db.folder.create({
      data: {
        organizationId: organization.id,
        roomId: roomOne.id,
        parentId: parentFolder.id,
        name: 'W1 nested ' + suffix,
        path: '/w1-parent-' + suffix + '/nested',
      },
    });

    const [deniedDocument, siblingDocument, nestedDocument, outsideDocument, roomTwoDocument] =
      await Promise.all([
        db.document.create({
          data: {
            organizationId: organization.id,
            roomId: roomOne.id,
            folderId: parentFolder.id,
            name: 'W1 denied ' + suffix,
            mimeType: 'application/pdf',
            fileSize: 1n,
            originalFileName: 'w1-denied-' + suffix + '.pdf',
          },
        }),
        db.document.create({
          data: {
            organizationId: organization.id,
            roomId: roomOne.id,
            folderId: parentFolder.id,
            name: 'W1 sibling ' + suffix,
            mimeType: 'application/pdf',
            fileSize: 1n,
            originalFileName: 'w1-sibling-' + suffix + '.pdf',
          },
        }),
        db.document.create({
          data: {
            organizationId: organization.id,
            roomId: roomOne.id,
            folderId: nestedFolder.id,
            name: 'W1 nested ' + suffix,
            mimeType: 'application/pdf',
            fileSize: 1n,
            originalFileName: 'w1-nested-' + suffix + '.pdf',
          },
        }),
        db.document.create({
          data: {
            organizationId: organization.id,
            roomId: roomOne.id,
            name: 'W1 outside ' + suffix,
            mimeType: 'application/pdf',
            fileSize: 1n,
            originalFileName: 'w1-outside-' + suffix + '.pdf',
          },
        }),
        db.document.create({
          data: {
            organizationId: organization.id,
            roomId: roomTwo.id,
            name: 'W1 room two ' + suffix,
            mimeType: 'application/pdf',
            fileSize: 1n,
            originalFileName: 'w1-room-two-' + suffix + '.pdf',
          },
        }),
      ]);
    fixture.documentIds.push(
      deniedDocument.id,
      siblingDocument.id,
      nestedDocument.id,
      outsideDocument.id,
      roomTwoDocument.id
    );

    const [adminCookie, viewerAuthCookie, secondCookie] = await Promise.all([
      login(adminEmail),
      login(viewerEmail),
      login(secondEmail),
    ]);

    await check('CloudVault login and session bootstrap', async () => {
      const responses = await Promise.all([
        api('/api/auth/me', { cookie: adminCookie }),
        api('/api/auth/me', { cookie: viewerAuthCookie }),
        api('/api/auth/me', { cookie: secondCookie }),
      ]);
      for (const response of responses) expectStatus(response, 200, 'session bootstrap');
    });

    await check('organization VIEWER has no room baseline', async () => {
      const listed = await api('/api/rooms?limit=100', { cookie: viewerAuthCookie });
      expectStatus(listed, 200, 'no-grant room list');
      assert.equal(listed.data.pagination.total, 0);
      assert.equal(listed.data.rooms.length, 0);
      expectStatus(
        await api('/api/rooms/' + roomOne.id, { cookie: viewerAuthCookie }),
        404,
        'no-grant direct room'
      );
    });

    const roomGrant = await db.permission.create({
      data: {
        organizationId: organization.id,
        resourceType: 'ROOM',
        roomId: roomOne.id,
        granteeType: 'USER',
        userId: viewer.id,
        permissionLevel: 'VIEW',
      },
    });
    fixture.permissionIds.push(roomGrant.id);

    await check('two-room isolation and direct room grant', async () => {
      const listed = await api('/api/rooms?limit=100', { cookie: viewerAuthCookie });
      expectStatus(listed, 200, 'granted room list');
      assert.equal(listed.data.pagination.total, 1);
      assert.deepEqual(
        listed.data.rooms.map((room) => room.id),
        [roomOne.id]
      );
      expectStatus(
        await api('/api/rooms/' + roomOne.id, { cookie: viewerAuthCookie }),
        200,
        'room one'
      );
      expectStatus(
        await api('/api/rooms/' + roomTwo.id, { cookie: viewerAuthCookie }),
        404,
        'room two'
      );
    });

    const documentDeny = await db.permission.create({
      data: {
        organizationId: organization.id,
        resourceType: 'DOCUMENT',
        roomId: roomOne.id,
        folderId: parentFolder.id,
        documentId: deniedDocument.id,
        granteeType: 'USER',
        userId: viewer.id,
        permissionLevel: 'NONE',
      },
    });
    fixture.permissionIds.push(documentDeny.id);

    await check('document NONE excluded before total and direct route returns 404', async () => {
      const listed = await api(
        '/api/rooms/' + roomOne.id + '/documents?folderId=' + parentFolder.id + '&limit=100',
        { cookie: viewerAuthCookie }
      );
      expectStatus(listed, 200, 'document override list');
      assert.equal(listed.data.pagination.total, 1);
      assert.deepEqual(
        listed.data.documents.map((document) => document.id),
        [siblingDocument.id]
      );
      expectStatus(
        await api('/api/rooms/' + roomOne.id + '/documents/' + deniedDocument.id, {
          cookie: viewerAuthCookie,
        }),
        404,
        'denied direct document'
      );
      expectStatus(
        await api('/api/rooms/' + roomOne.id + '/documents/' + siblingDocument.id, {
          cookie: viewerAuthCookie,
        }),
        200,
        'allowed sibling document'
      );
    });

    const folderDeny = await db.permission.create({
      data: {
        organizationId: organization.id,
        resourceType: 'FOLDER',
        roomId: roomOne.id,
        folderId: parentFolder.id,
        granteeType: 'USER',
        userId: viewer.id,
        permissionLevel: 'NONE',
        inheritFromParent: true,
      },
    });
    fixture.permissionIds.push(folderDeny.id);

    await check('inheritable ancestor folder NONE excludes nested documents', async () => {
      const listed = await api(
        '/api/rooms/' + roomOne.id + '/documents?folderId=' + nestedFolder.id + '&limit=100',
        { cookie: viewerAuthCookie }
      );
      expectStatus(listed, 200, 'nested document list');
      assert.equal(listed.data.pagination.total, 0);
      assert.equal(listed.data.documents.length, 0);
      expectStatus(
        await api('/api/rooms/' + roomOne.id + '/documents/' + nestedDocument.id, {
          cookie: viewerAuthCookie,
        }),
        404,
        'nested direct document'
      );
    });

    await db.permission.update({ where: { id: roomGrant.id }, data: { isActive: false } });
    await check('direct grant revocation denies without baseline fallthrough', async () => {
      const listed = await api('/api/rooms?limit=100', { cookie: viewerAuthCookie });
      expectStatus(listed, 200, 'revoked room list');
      assert.equal(listed.data.pagination.total, 0);
      expectStatus(
        await api('/api/rooms/' + roomOne.id, { cookie: viewerAuthCookie }),
        404,
        'revoked direct room'
      );
    });

    await check('group grant and group removal take effect on next request', async () => {
      const initial = await api('/api/rooms?limit=100', { cookie: secondCookie });
      expectStatus(initial, 200, 'second viewer no-grant list');
      assert.equal(initial.data.pagination.total, 0);

      const group = await db.group.create({
        data: { organizationId: organization.id, name: 'W1 group ' + suffix },
      });
      fixture.groupIds.push(group.id);
      const membership = await db.groupMembership.create({
        data: { groupId: group.id, userId: second.id },
      });
      const groupGrant = await db.permission.create({
        data: {
          organizationId: organization.id,
          resourceType: 'ROOM',
          roomId: roomTwo.id,
          granteeType: 'GROUP',
          groupId: group.id,
          permissionLevel: 'VIEW',
        },
      });
      fixture.permissionIds.push(groupGrant.id);

      const allowed = await api('/api/rooms?limit=100', { cookie: secondCookie });
      expectStatus(allowed, 200, 'group room list');
      assert.deepEqual(
        allowed.data.rooms.map((room) => room.id),
        [roomTwo.id]
      );

      await db.groupMembership.delete({ where: { id: membership.id } });
      const removed = await api('/api/rooms?limit=100', { cookie: secondCookie });
      expectStatus(removed, 200, 'group removed room list');
      assert.equal(removed.data.pagination.total, 0);
      expectStatus(
        await api('/api/rooms/' + roomTwo.id, { cookie: secondCookie }),
        404,
        'group removed direct room'
      );
    });

    const adminDeny = await db.permission.create({
      data: {
        organizationId: organization.id,
        resourceType: 'ROOM',
        roomId: roomOne.id,
        granteeType: 'USER',
        userId: admin.id,
        permissionLevel: 'NONE',
      },
    });
    fixture.permissionIds.push(adminDeny.id);

    await check('organization ADMIN authority remains above ACL deny', async () => {
      const listed = await api('/api/rooms?limit=100', { cookie: adminCookie });
      expectStatus(listed, 200, 'admin room list');
      const ids = new Set(listed.data.rooms.map((room) => room.id));
      assert.ok(ids.has(roomOne.id));
      assert.ok(ids.has(roomTwo.id));
      expectStatus(
        await api('/api/rooms/' + roomOne.id, { cookie: adminCookie }),
        200,
        'admin room'
      );
    });

    const roomAdminDeny = await db.permission.create({
      data: {
        organizationId: organization.id,
        resourceType: 'ROOM',
        roomId: roomTwo.id,
        granteeType: 'USER',
        userId: second.id,
        permissionLevel: 'NONE',
      },
    });
    fixture.permissionIds.push(roomAdminDeny.id);
    await db.roleAssignment.create({
      data: {
        organizationId: organization.id,
        userId: second.id,
        role: 'ADMIN',
        scopeType: 'ROOM',
        roomId: roomTwo.id,
      },
    });

    await check('room ADMIN authority remains room-scoped above ACL deny', async () => {
      const listed = await api('/api/rooms?limit=100', { cookie: secondCookie });
      expectStatus(listed, 200, 'room admin list');
      assert.deepEqual(
        listed.data.rooms.map((room) => room.id),
        [roomTwo.id]
      );
      expectStatus(
        await api('/api/rooms/' + roomTwo.id, { cookie: secondCookie }),
        200,
        'room admin direct'
      );
      expectStatus(
        await api('/api/rooms/' + roomOne.id, { cookie: secondCookie }),
        404,
        'room admin isolation'
      );
    });

    const gateFree = await createLink(organization.id, roomOne.id, { code: 'logout' });
    const gateAccess = await api('/api/view/' + gateFree.slug + '/access', {
      method: 'POST',
      body: {},
    });
    expectStatus(gateAccess, 200, 'gate-free link admission');
    const gateCookie = viewerCookie(gateAccess, gateFree.slug);
    const gateSession = await db.viewSession.findFirstOrThrow({
      where: { linkId: gateFree.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    await check('gate-free session is reused before redirect', async () => {
      const info = await api('/api/view/' + gateFree.slug + '/info', { cookie: gateCookie });
      expectStatus(info, 200, 'gate-free session info');
      assert.equal(info.data.link.alreadyAdmitted, true);
    });

    await check(
      'viewer logout soft-invalidates, retains audit, denies serve, and permits re-entry',
      async () => {
        const auditedBefore = await db.event.count({
          where: {
            organizationId: organization.id,
            sessionId: gateSession.id,
            eventType: 'LINK_ACCESSED',
          },
        });
        assert.ok(auditedBefore >= 1);
        expectStatus(
          await api('/api/view/' + gateFree.slug + '/logout', {
            method: 'POST',
            cookie: gateCookie,
            body: {},
          }),
          200,
          'viewer logout'
        );
        const stored = await db.viewSession.findUniqueOrThrow({
          where: { id: gateSession.id },
          select: { isActive: true },
        });
        assert.equal(stored.isActive, false);
        const auditedAfter = await db.event.count({
          where: {
            organizationId: organization.id,
            sessionId: gateSession.id,
            eventType: 'LINK_ACCESSED',
          },
        });
        assert.equal(auditedAfter, auditedBefore);
        expectStatus(
          await api('/api/view/' + gateFree.slug + '/documents', { cookie: gateCookie }),
          401,
          'post-logout serve'
        );
        const reentry = await api('/api/view/' + gateFree.slug + '/access', {
          method: 'POST',
          cookie: gateCookie,
          body: {},
        });
        expectStatus(reentry, 200, 'viewer re-entry');
        viewerCookie(reentry, gateFree.slug);
      }
    );

    const maxLink = await createLink(organization.id, roomOne.id, { code: 'max', maxViews: 1 });
    await check(
      'maxViews final admission is atomic and winning session remains servable',
      async () => {
        const attempts = await Promise.all([
          api('/api/view/' + maxLink.slug + '/access', { method: 'POST', body: {} }),
          api('/api/view/' + maxLink.slug + '/access', { method: 'POST', body: {} }),
        ]);
        const admitted = attempts.filter((attempt) => attempt.status === 200);
        const denied = attempts.filter((attempt) => attempt.status === 410);
        assert.equal(admitted.length, 1);
        assert.equal(denied.length, 1);
        const winnerCookie = viewerCookie(admitted[0], maxLink.slug);
        const persisted = await db.link.findUniqueOrThrow({
          where: { id: maxLink.id },
          select: { viewCount: true },
        });
        assert.equal(persisted.viewCount, 1);
        assert.equal(await db.viewSession.count({ where: { linkId: maxLink.id } }), 1);
        expectStatus(
          await api('/api/view/' + maxLink.slug + '/documents', { cookie: winnerCookie }),
          200,
          'maxViews winning serve'
        );
        expectStatus(
          await api('/api/view/' + maxLink.slug + '/access', { method: 'POST', body: {} }),
          410,
          'maxViews subsequent admission'
        );
      }
    );

    const gatedLink = await createLink(organization.id, gatedRoom.id, {
      code: 'gates',
      requiresPassword: true,
      passwordHash: await bcrypt.hash(linkPassword, 10),
      requiresEmailVerification: true,
      allowedEmails: [linkEmail],
    });

    await check(
      'password, asserted email, allowlist, and NDA gates are authoritative',
      async () => {
        expectStatus(
          await api('/api/view/' + gatedLink.slug + '/access', { method: 'POST', body: {} }),
          401,
          'password required'
        );
        expectStatus(
          await api('/api/view/' + gatedLink.slug + '/access', {
            method: 'POST',
            body: { password: 'incorrect' },
          }),
          401,
          'password invalid'
        );
        expectStatus(
          await api('/api/view/' + gatedLink.slug + '/access', {
            method: 'POST',
            body: { password: linkPassword },
          }),
          401,
          'email required'
        );
        expectStatus(
          await api('/api/view/' + gatedLink.slug + '/access', {
            method: 'POST',
            body: { password: linkPassword, email: 'other-' + suffix + '@example.test' },
          }),
          403,
          'email allowlist'
        );
        expectStatus(
          await api('/api/view/' + gatedLink.slug + '/access', {
            method: 'POST',
            body: { password: linkPassword, email: linkEmail },
          }),
          400,
          'NDA required'
        );
        const allowed = await api('/api/view/' + gatedLink.slug + '/access', {
          method: 'POST',
          body: { password: linkPassword, email: linkEmail, ndaAccepted: true },
        });
        expectStatus(allowed, 200, 'all gates accepted');
        viewerCookie(allowed, gatedLink.slug);
      }
    );

    const expiredLink = await createLink(organization.id, roomOne.id, {
      code: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const inactiveLink = await createLink(organization.id, roomOne.id, {
      code: 'inactive',
      isActive: false,
    });
    await check('expired and inactive links deny admission discovery', async () => {
      expectStatus(await api('/api/view/' + expiredLink.slug + '/info'), 410, 'expired link');
      expectStatus(await api('/api/view/' + inactiveLink.slug + '/info'), 404, 'inactive link');
    });

    const revokeLink = await createLink(organization.id, roomOne.id, { code: 'revoke' });
    const revokeAccess = await api('/api/view/' + revokeLink.slug + '/access', {
      method: 'POST',
      body: {},
    });
    expectStatus(revokeAccess, 200, 'revocation admission');
    const revokeCookie = viewerCookie(revokeAccess, revokeLink.slug);
    await db.link.update({ where: { id: revokeLink.id }, data: { isActive: false } });
    await check('link revocation invalidates an existing session on next serve', async () => {
      expectStatus(
        await api('/api/view/' + revokeLink.slug + '/documents', { cookie: revokeCookie }),
        401,
        'revoked link serve'
      );
    });

    const timedLink = await createLink(organization.id, roomOne.id, {
      code: 'timed',
      maxSessionMinutes: 1,
    });
    const timedAccess = await api('/api/view/' + timedLink.slug + '/access', {
      method: 'POST',
      body: {},
    });
    expectStatus(timedAccess, 200, 'timed admission');
    const timedCookie = viewerCookie(timedAccess, timedLink.slug);
    await db.viewSession.updateMany({
      where: { linkId: timedLink.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    await check('maximum session duration denies an expired session', async () => {
      expectStatus(
        await api('/api/view/' + timedLink.slug + '/documents', { cookie: timedCookie }),
        403,
        'timed serve'
      );
    });

    const folderLink = await createLink(organization.id, roomOne.id, {
      code: 'folder',
      scope: 'FOLDER',
      scopedFolderId: parentFolder.id,
    });
    const folderAccess = await api('/api/view/' + folderLink.slug + '/access', {
      method: 'POST',
      body: {},
    });
    expectStatus(folderAccess, 200, 'folder scope admission');
    const folderCookie = viewerCookie(folderAccess, folderLink.slug);

    await check('folder scope includes descendants and excludes outside documents', async () => {
      const root = await api('/api/view/' + folderLink.slug + '/documents', {
        cookie: folderCookie,
      });
      expectStatus(root, 200, 'folder scope root');
      const rootIds = new Set(root.data.documents.map((document) => document.id));
      assert.ok(rootIds.has(deniedDocument.id));
      assert.ok(rootIds.has(siblingDocument.id));
      assert.ok(root.data.folders.some((folder) => folder.id === nestedFolder.id));

      const nested = await api(
        '/api/view/' + folderLink.slug + '/documents?folderId=' + nestedFolder.id,
        { cookie: folderCookie }
      );
      expectStatus(nested, 200, 'folder scope nested');
      assert.deepEqual(
        nested.data.documents.map((document) => document.id),
        [nestedDocument.id]
      );
      expectStatus(
        await api('/api/view/' + folderLink.slug + '/documents/' + outsideDocument.id, {
          cookie: folderCookie,
        }),
        404,
        'folder scope outside document'
      );
    });

    const documentLink = await createLink(organization.id, roomOne.id, {
      code: 'document',
      scope: 'DOCUMENT',
      scopedDocumentId: siblingDocument.id,
      requiresEmailVerification: true,
      allowedEmails: [linkEmail],
      permission: 'VIEW',
    });
    const documentAccess = await api('/api/view/' + documentLink.slug + '/access', {
      method: 'POST',
      body: { email: linkEmail },
    });
    expectStatus(documentAccess, 200, 'document scope admission');
    const documentCookie = viewerCookie(documentAccess, documentLink.slug);

    await check('document scope, VIEW permission, and Q&A scope are enforced', async () => {
      const listed = await api('/api/view/' + documentLink.slug + '/documents', {
        cookie: documentCookie,
      });
      expectStatus(listed, 200, 'document scope list');
      assert.deepEqual(
        listed.data.documents.map((document) => document.id),
        [siblingDocument.id]
      );
      const scoped = await api(
        '/api/view/' + documentLink.slug + '/documents/' + siblingDocument.id,
        { cookie: documentCookie }
      );
      expectStatus(scoped, 200, 'document scope direct');
      assert.equal(scoped.data.document.downloadEnabled, false);
      expectStatus(
        await api('/api/view/' + documentLink.slug + '/documents/' + outsideDocument.id, {
          cookie: documentCookie,
        }),
        404,
        'document scope outside direct'
      );
      expectStatus(
        await api(
          '/api/view/' + documentLink.slug + '/documents/' + siblingDocument.id + '/download',
          { cookie: documentCookie }
        ),
        403,
        'VIEW link download'
      );
      expectStatus(
        await api('/api/view/' + documentLink.slug + '/questions', {
          method: 'POST',
          cookie: documentCookie,
          body: {
            subject: 'W1 synthetic allowed ' + suffix,
            body: 'Synthetic scoped question',
            documentId: siblingDocument.id,
          },
        }),
        201,
        'Q&A scoped document'
      );
      expectStatus(
        await api('/api/view/' + documentLink.slug + '/questions', {
          method: 'POST',
          cookie: documentCookie,
          body: {
            subject: 'W1 synthetic denied ' + suffix,
            body: 'Synthetic out-of-scope question',
            documentId: outsideDocument.id,
          },
        }),
        404,
        'Q&A outside document'
      );
    });

    const downloadLink = await createLink(organization.id, roomOne.id, {
      code: 'download',
      scope: 'DOCUMENT',
      scopedDocumentId: siblingDocument.id,
      permission: 'DOWNLOAD',
    });
    const downloadAccess = await api('/api/view/' + downloadLink.slug + '/access', {
      method: 'POST',
      body: {},
    });
    expectStatus(downloadAccess, 200, 'download scope admission');
    const downloadCookie = viewerCookie(downloadAccess, downloadLink.slug);
    await check('DOWNLOAD link exposes capability without fetching content', async () => {
      const detail = await api(
        '/api/view/' + downloadLink.slug + '/documents/' + siblingDocument.id,
        { cookie: downloadCookie }
      );
      expectStatus(detail, 200, 'download detail');
      assert.equal(detail.data.document.downloadEnabled, true);
    });

    const [inScopeSignature, outOfScopeSignature] = await Promise.all([
      db.signatureRequest.create({
        data: {
          organizationId: organization.id,
          roomId: roomOne.id,
          documentId: siblingDocument.id,
          requestedByUserId: admin.id,
          signerEmail: linkEmail,
          signerName: 'Synthetic Signer',
        },
      }),
      db.signatureRequest.create({
        data: {
          organizationId: organization.id,
          roomId: roomOne.id,
          documentId: outsideDocument.id,
          requestedByUserId: admin.id,
          signerEmail: linkEmail,
          signerName: 'Synthetic Signer',
        },
      }),
    ]);

    await check('signature action respects viewer link document scope', async () => {
      expectStatus(
        await api(
          '/api/rooms/' +
            roomOne.id +
            '/documents/' +
            outsideDocument.id +
            '/signatures/' +
            outOfScopeSignature.id,
          {
            method: 'PATCH',
            cookie: documentCookie,
            body: { action: 'decline', declineReason: 'Synthetic out-of-scope check' },
          }
        ),
        403,
        'signature outside scope'
      );
      expectStatus(
        await api(
          '/api/rooms/' +
            roomOne.id +
            '/documents/' +
            siblingDocument.id +
            '/signatures/' +
            inScopeSignature.id,
          {
            method: 'PATCH',
            cookie: documentCookie,
            body: { action: 'decline', declineReason: 'Synthetic accepted scope check' },
          }
        ),
        200,
        'signature in scope'
      );
    });

    await check('authenticated logout invalidates the synthetic CloudVault session', async () => {
      expectStatus(
        await api('/api/auth/logout', {
          method: 'POST',
          cookie: viewerAuthCookie,
          body: {},
        }),
        200,
        'authenticated logout'
      );
      expectStatus(
        await api('/api/auth/me', { cookie: viewerAuthCookie }),
        401,
        'post-auth logout'
      );
    });

    console.log('SUMMARY PASS ' + results.length + '/' + results.length + ' CloudVault checks');
    console.log('SYNTHETIC_FIXTURE ' + suffix);
  } catch (error) {
    failed = true;
    console.error('FAIL  ' + (error instanceof Error ? error.message : String(error)));
  } finally {
    await cleanup();
    await db.$disconnect();
  }

  if (failed) process.exit(1);
}

void run();
