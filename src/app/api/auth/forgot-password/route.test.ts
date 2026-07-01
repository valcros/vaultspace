import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  createToken: vi.fn(),
  addJob: vi.fn(),
  sendEmail: vi.fn(),
  hasCapability: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  bootstrapDb: {
    user: {
      findUnique: mocks.findUser,
    },
    passwordResetToken: {
      create: mocks.createToken,
    },
  },
}));

vi.mock('@/providers', () => ({
  getProviders: () => ({
    job: {
      addJob: mocks.addJob,
    },
    email: {
      sendEmail: mocks.sendEmail,
    },
  }),
}));

vi.mock('@/lib/deployment-capabilities', () => ({
  hasCapability: mocks.hasCapability,
}));

import { POST } from './route';

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['APP_URL'] = 'https://vaultspace.example.com';
    mocks.findUser.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      firstName: 'Ada',
      isActive: true,
      organizations: [
        {
          organization: {
            name: 'Demo Organization',
          },
        },
      ],
    });
    mocks.createToken.mockResolvedValue({ id: 'reset-token-1' });
    mocks.addJob.mockResolvedValue('job-1');
    mocks.hasCapability.mockImplementation(
      (capability: string) => capability === 'canSendAsyncEmail'
    );
  });

  it('queues the supported email.send job for async password reset email', async () => {
    const request = new NextRequest('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'Admin@Example.com' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });

    expect(mocks.addJob).toHaveBeenCalledWith(
      'normal',
      'email.send',
      expect.objectContaining({
        to: 'admin@example.com',
        subject: 'Reset your Demo Organization password',
        template: 'password-reset',
        data: expect.objectContaining({
          userName: 'Ada',
          organizationName: 'Demo Organization',
          resetUrl: expect.stringContaining(
            'https://vaultspace.example.com/auth/reset-password?token='
          ),
          expiresIn: '1 hour',
        }),
      })
    );
  });
});
