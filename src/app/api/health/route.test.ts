import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from './route';

describe('GET /api/health release identity', () => {
  const previousRelease = process.env['NEXT_PUBLIC_APP_RELEASE'];
  const previousRevision = process.env['CONTAINER_APP_REVISION'];

  afterEach(() => {
    if (previousRelease === undefined) {
      delete process.env['NEXT_PUBLIC_APP_RELEASE'];
    } else {
      process.env['NEXT_PUBLIC_APP_RELEASE'] = previousRelease;
    }

    if (previousRevision === undefined) {
      delete process.env['CONTAINER_APP_REVISION'];
    } else {
      process.env['CONTAINER_APP_REVISION'] = previousRevision;
    }
  });

  it('exposes the exact release and Container App revision for deployment verification', async () => {
    process.env['NEXT_PUBLIC_APP_RELEASE'] = 'commit-sha-123';
    process.env['CONTAINER_APP_REVISION'] = 'vaultspace-web--revision-123';

    const response = await GET(new NextRequest('https://vaultspace.example.com/api/health'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      release: 'commit-sha-123',
      revision: 'vaultspace-web--revision-123',
    });
  });
});
