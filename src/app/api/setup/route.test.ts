/**
 * Setup Wizard API Tests (F128)
 *
 * Tests for initial setup wizard - first-time organization and admin setup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

// Mock database
vi.mock('@/lib/db', () => ({
  db: {
    organization: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    userOrganization: {
      create: vi.fn(),
    },
    session: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock bcrypt
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-password'),
  },
}));

// Mock crypto
vi.mock('crypto', () => ({
  randomBytes: vi.fn().mockReturnValue({
    toString: vi.fn().mockReturnValue('mock-session-token'),
  }),
}));

// Mock session cookie
vi.mock('@/lib/middleware', () => ({
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
}));

import { db } from '@/lib/db';

const mockDbOrganization = vi.mocked(db.organization);
const mockDbUser = vi.mocked(db.user);
const mockDbSession = vi.mocked(db.session);
const mockDbTransaction = vi.mocked(db.$transaction);

describe('GET /api/setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns setupRequired: true when no organization exists', async () => {
    mockDbOrganization.findFirst.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.setupRequired).toBe(true);
  });

  it('returns setupRequired: false when organization exists', async () => {
    mockDbOrganization.findFirst.mockResolvedValue({
      id: 'org-1',
      name: 'Existing Org',
    } as unknown as Awaited<ReturnType<typeof mockDbOrganization.findFirst>>);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.setupRequired).toBe(false);
  });

  it('returns 500 when database error occurs', async () => {
    mockDbOrganization.findFirst.mockRejectedValue(new Error('Database connection failed'));

    const response = await GET();
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toContain('Failed to check setup status');
  });
});

describe('POST /api/setup', () => {
  const validSetupData = {
    organizationName: 'Acme Corp',
    organizationSlug: 'acme-corp',
    adminFirstName: 'John',
    adminLastName: 'Doe',
    adminEmail: 'john@acme.com',
    adminPassword: 'securePassword123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbOrganization.findFirst.mockResolvedValue(null);
    mockDbOrganization.findUnique.mockResolvedValue(null);
    mockDbUser.findUnique.mockResolvedValue(null);
  });

  it('returns 400 when setup has already been completed', async () => {
    mockDbOrganization.findFirst.mockResolvedValue({
      id: 'org-1',
      name: 'Existing Org',
    } as unknown as Awaited<ReturnType<typeof mockDbOrganization.findFirst>>);

    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify(validSetupData),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('already been completed');
  });

  it('returns 400 when organization name is missing', async () => {
    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, organizationName: '' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Organization name');
  });

  it('returns 400 when organization slug is invalid', async () => {
    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, organizationSlug: 'Invalid Slug!' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('lowercase');
  });

  it('returns 400 when admin email is invalid', async () => {
    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, adminEmail: 'not-an-email' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('email');
  });

  it('returns 400 when password is too short', async () => {
    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, adminPassword: 'short' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('8 characters');
  });

  it('returns 400 when first name is missing', async () => {
    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, adminFirstName: '' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('First name');
  });

  it('returns 400 when last name is missing', async () => {
    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, adminLastName: '' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Last name');
  });

  it('returns 409 when organization slug is already taken', async () => {
    mockDbOrganization.findUnique.mockResolvedValue({
      id: 'org-existing',
      slug: 'acme-corp',
    } as unknown as Awaited<ReturnType<typeof mockDbOrganization.findUnique>>);

    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify(validSetupData),
    });

    const response = await POST(request);
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error).toContain('slug is already taken');
  });

  it('returns 409 when admin email already exists', async () => {
    mockDbUser.findUnique.mockResolvedValue({
      id: 'user-existing',
      email: 'john@acme.com',
    } as unknown as Awaited<ReturnType<typeof mockDbUser.findUnique>>);

    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify(validSetupData),
    });

    const response = await POST(request);
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error).toContain('email already exists');
  });

  it('creates organization and admin user successfully', async () => {
    const mockOrg = {
      id: 'org-new',
      name: 'Acme Corp',
      slug: 'acme-corp',
    };

    const mockUser = {
      id: 'user-new',
      email: 'john@acme.com',
      firstName: 'John',
      lastName: 'Doe',
    };

    mockDbTransaction.mockImplementation(async (callback) => {
      const tx = {
        organization: {
          create: vi.fn().mockResolvedValue(mockOrg),
        },
        user: {
          create: vi.fn().mockResolvedValue(mockUser),
        },
        userOrganization: {
          create: vi.fn().mockResolvedValue({ id: 'uo-1' }),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    mockDbSession.create.mockResolvedValue({
      id: 'session-1',
      token: 'mock-session-token',
    } as unknown as Awaited<ReturnType<typeof mockDbSession.create>>);

    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify(validSetupData),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.organization.name).toBe('Acme Corp');
    expect(body.organization.slug).toBe('acme-corp');
    expect(body.user.email).toBe('john@acme.com');
    expect(body.user.firstName).toBe('John');
    expect(body.user.lastName).toBe('Doe');
  });

  it('normalizes email to lowercase', async () => {
    const mockOrg = {
      id: 'org-new',
      name: 'Acme Corp',
      slug: 'acme-corp',
    };

    const mockUser = {
      id: 'user-new',
      email: 'john@acme.com',
      firstName: 'John',
      lastName: 'Doe',
    };

    let capturedEmail: string | undefined;

    mockDbTransaction.mockImplementation(async (callback) => {
      const tx = {
        organization: {
          create: vi.fn().mockResolvedValue(mockOrg),
        },
        user: {
          create: vi.fn().mockImplementation((args) => {
            capturedEmail = args.data.email;
            return Promise.resolve(mockUser);
          }),
        },
        userOrganization: {
          create: vi.fn().mockResolvedValue({ id: 'uo-1' }),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    mockDbSession.create.mockResolvedValue({
      id: 'session-1',
    } as unknown as Awaited<ReturnType<typeof mockDbSession.create>>);

    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, adminEmail: 'JOHN@ACME.COM' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(capturedEmail).toBe('john@acme.com');
  });

  it('creates session with IP address and user agent', async () => {
    const mockOrg = {
      id: 'org-new',
      name: 'Acme Corp',
      slug: 'acme-corp',
    };

    const mockUser = {
      id: 'user-new',
      email: 'john@acme.com',
      firstName: 'John',
      lastName: 'Doe',
    };

    mockDbTransaction.mockImplementation(async (callback) => {
      const tx = {
        organization: {
          create: vi.fn().mockResolvedValue(mockOrg),
        },
        user: {
          create: vi.fn().mockResolvedValue(mockUser),
        },
        userOrganization: {
          create: vi.fn().mockResolvedValue({ id: 'uo-1' }),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    let capturedSessionData: Record<string, unknown> | undefined;
    mockDbSession.create.mockImplementation((args: { data: Record<string, unknown> }) => {
      capturedSessionData = args.data;
      return Promise.resolve({ id: 'session-1' }) as unknown as ReturnType<typeof mockDbSession.create>;
    });

    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '192.168.1.100, 10.0.0.1',
        'user-agent': 'Mozilla/5.0 Test Browser',
      },
      body: JSON.stringify(validSetupData),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(capturedSessionData?.['ipAddress']).toBe('192.168.1.100');
    expect(capturedSessionData?.['userAgent']).toBe('Mozilla/5.0 Test Browser');
  });

  it('returns 500 when transaction fails', async () => {
    mockDbTransaction.mockRejectedValue(new Error('Transaction failed'));

    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify(validSetupData),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toContain('Failed to complete setup');
  });

  it('validates slug format - allows hyphens', async () => {
    const mockOrg = {
      id: 'org-new',
      name: 'Acme Corp',
      slug: 'acme-corp-2024',
    };

    const mockUser = {
      id: 'user-new',
      email: 'john@acme.com',
      firstName: 'John',
      lastName: 'Doe',
    };

    mockDbTransaction.mockImplementation(async (callback) => {
      const tx = {
        organization: {
          create: vi.fn().mockResolvedValue(mockOrg),
        },
        user: {
          create: vi.fn().mockResolvedValue(mockUser),
        },
        userOrganization: {
          create: vi.fn().mockResolvedValue({ id: 'uo-1' }),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    mockDbSession.create.mockResolvedValue({
      id: 'session-1',
    } as unknown as Awaited<ReturnType<typeof mockDbSession.create>>);

    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, organizationSlug: 'acme-corp-2024' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it('validates slug format - allows numbers', async () => {
    const mockOrg = {
      id: 'org-new',
      name: 'Acme Corp',
      slug: 'acme123',
    };

    const mockUser = {
      id: 'user-new',
      email: 'john@acme.com',
      firstName: 'John',
      lastName: 'Doe',
    };

    mockDbTransaction.mockImplementation(async (callback) => {
      const tx = {
        organization: {
          create: vi.fn().mockResolvedValue(mockOrg),
        },
        user: {
          create: vi.fn().mockResolvedValue(mockUser),
        },
        userOrganization: {
          create: vi.fn().mockResolvedValue({ id: 'uo-1' }),
        },
      };
      return callback(tx as unknown as Parameters<typeof callback>[0]);
    });

    mockDbSession.create.mockResolvedValue({
      id: 'session-1',
    } as unknown as Awaited<ReturnType<typeof mockDbSession.create>>);

    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, organizationSlug: 'acme123' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it('validates slug format - rejects uppercase', async () => {
    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, organizationSlug: 'AcmeCorp' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('lowercase');
  });

  it('validates slug format - rejects spaces', async () => {
    const request = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ ...validSetupData, organizationSlug: 'acme corp' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('lowercase');
  });
});
