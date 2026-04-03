/**
 * Notification Preferences API Tests (F003, F043)
 *
 * Tests for email notification settings and preferences.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from './route';

// Mock auth middleware
vi.mock('@/lib/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock database
vi.mock('@/lib/db', () => ({
  withOrgContext: vi.fn(),
}));

import { requireAuth } from '@/lib/middleware';
import { withOrgContext } from '@/lib/db';

const mockRequireAuth = vi.mocked(requireAuth);
const mockWithOrgContext = vi.mocked(withOrgContext);

describe('GET /api/users/me/notifications', () => {
  const mockSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'VIEWER' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
  });

  it('returns 500 for unauthenticated requests', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const response = await GET();
    expect(response.status).toBe(500);
  });

  it('returns 404 when user organization not found', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await GET();
    expect(response.status).toBe(404);
  });

  it('returns existing preferences', async () => {
    const mockPreferences = {
      id: 'pref-1',
      emailOnDocumentViewed: true,
      emailOnDocumentUploaded: false,
      emailOnAccessRevoked: true,
      emailDailyDigest: true,
      digestFrequency: 'DAILY',
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'uo-1' }) },
        notificationPreference: { findUnique: vi.fn().mockResolvedValue(mockPreferences) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.preferences.emailOnDocumentViewed).toBe(true);
    expect(body.preferences.digestFrequency).toBe('DAILY');
  });

  it('creates default preferences when none exist', async () => {
    const defaultPreferences = {
      id: 'pref-new',
      emailOnDocumentViewed: true,
      emailOnDocumentUploaded: true,
      emailOnAccessRevoked: true,
      emailDailyDigest: false,
      digestFrequency: 'IMMEDIATE',
      quietHoursStart: null,
      quietHoursEnd: null,
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'uo-1' }) },
        notificationPreference: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(defaultPreferences),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.preferences.id).toBe('pref-new');
  });
});

describe('PATCH /api/users/me/notifications', () => {
  const mockSession = {
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { role: 'VIEWER' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(
      mockSession as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never
    );
  });

  it('returns 400 for invalid digest frequency', async () => {
    const request = new NextRequest('http://localhost/api/users/me/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ digestFrequency: 'HOURLY' }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('digest frequency');
  });

  it('returns 400 for invalid quiet hours format', async () => {
    const request = new NextRequest('http://localhost/api/users/me/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ quietHoursStart: '10pm' }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('quiet hours');
  });

  it('returns 404 when user organization not found', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/me/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ emailDailyDigest: true }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(404);
  });

  it('updates notification preferences successfully', async () => {
    const updatedPreferences = {
      id: 'pref-1',
      emailOnDocumentViewed: false,
      emailOnDocumentUploaded: false,
      emailOnAccessRevoked: true,
      emailDailyDigest: true,
      digestFrequency: 'WEEKLY',
      quietHoursStart: '23:00',
      quietHoursEnd: '07:00',
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'uo-1' }) },
        notificationPreference: { upsert: vi.fn().mockResolvedValue(updatedPreferences) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/me/notifications', {
      method: 'PATCH',
      body: JSON.stringify({
        emailOnDocumentViewed: false,
        emailOnDocumentUploaded: false,
        emailDailyDigest: true,
        digestFrequency: 'WEEKLY',
        quietHoursStart: '23:00',
        quietHoursEnd: '07:00',
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.preferences.emailOnDocumentViewed).toBe(false);
    expect(body.preferences.digestFrequency).toBe('WEEKLY');
  });

  it('accepts valid time formats', async () => {
    const updatedPreferences = {
      id: 'pref-1',
      quietHoursStart: '9:30',
      quietHoursEnd: '17:00',
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'uo-1' }) },
        notificationPreference: { upsert: vi.fn().mockResolvedValue(updatedPreferences) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/me/notifications', {
      method: 'PATCH',
      body: JSON.stringify({
        quietHoursStart: '9:30',
        quietHoursEnd: '17:00',
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);
  });

  it('allows clearing quiet hours', async () => {
    const updatedPreferences = {
      id: 'pref-1',
      quietHoursStart: null,
      quietHoursEnd: null,
    };

    mockWithOrgContext.mockImplementation(async (_orgId, callback) => {
      const tx = {
        userOrganization: { findFirst: vi.fn().mockResolvedValue({ id: 'uo-1' }) },
        notificationPreference: { upsert: vi.fn().mockResolvedValue(updatedPreferences) },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    const request = new NextRequest('http://localhost/api/users/me/notifications', {
      method: 'PATCH',
      body: JSON.stringify({
        quietHoursStart: null,
        quietHoursEnd: null,
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);
  });
});
