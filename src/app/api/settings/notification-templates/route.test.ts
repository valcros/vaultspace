/**
 * Notification Templates API Tests
 *
 * Validates GET (list with defaults merge) and PATCH (upsert) for notification templates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth
const mockSession = {
  userId: 'user-1',
  organizationId: 'org-1',
  organization: { role: 'ADMIN' },
  user: { email: 'admin@example.com' },
};
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(() => Promise.resolve(mockSession)),
}));

// Mock DB transaction
const mockTx = {
  notificationTemplate: { findMany: vi.fn(), upsert: vi.fn() },
};
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

import { GET, PATCH } from './route';

describe('GET /api/settings/notification-templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
  });

  it('returns templates merged with defaults', async () => {
    // Simulate one customized template in the DB
    const savedTemplates = [
      {
        templateKey: 'document_uploaded',
        subject: 'Custom: doc uploaded',
        bodyHtml: '<p>Custom body</p>',
        isActive: false,
      },
    ];
    mockTx.notificationTemplate.findMany.mockResolvedValue(savedTemplates);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    // Should have all 6 default template keys
    expect(body.templates.length).toBeGreaterThanOrEqual(6);

    const docUploaded = body.templates.find(
      (t: { templateKey: string }) => t.templateKey === 'document_uploaded'
    );
    expect(docUploaded.subject).toBe('Custom: doc uploaded');
    expect(docUploaded.isCustomized).toBe(true);

    // Non-customized template should have isCustomized: false
    const accessApproved = body.templates.find(
      (t: { templateKey: string }) => t.templateKey === 'access_approved'
    );
    expect(accessApproved.isCustomized).toBe(false);
  });

  it('returns 403 for non-admin', async () => {
    mockSession.organization.role = 'VIEWER';

    const res = await GET();

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/settings/notification-templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.organization.role = 'ADMIN';
  });

  it('updates template via upsert', async () => {
    const upserted = {
      templateKey: 'document_uploaded',
      subject: 'Updated subject',
      bodyHtml: '<p>Updated</p>',
      isActive: true,
    };
    mockTx.notificationTemplate.upsert.mockResolvedValue(upserted);

    const req = new NextRequest('http://localhost:3000/api/settings/notification-templates', {
      method: 'PATCH',
      body: JSON.stringify({
        templateKey: 'document_uploaded',
        subject: 'Updated subject',
        bodyHtml: '<p>Updated</p>',
      }),
    });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.template.templateKey).toBe('document_uploaded');
    expect(body.template.subject).toBe('Updated subject');
    expect(body.template.isCustomized).toBe(true);
  });

  it('returns 400 for missing templateKey', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings/notification-templates', {
      method: 'PATCH',
      body: JSON.stringify({ subject: 'No key' }),
    });
    const res = await PATCH(req);

    expect(res.status).toBe(400);
  });
});
