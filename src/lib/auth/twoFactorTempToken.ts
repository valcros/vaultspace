import { createHmac, timingSafeEqual } from 'crypto';

const TEMP_TOKEN_MAX_AGE_MS = 5 * 60 * 1000;

function requireSessionSecret(): string {
  const secret = process.env['SESSION_SECRET'];
  if (!secret) {
    throw new Error('SESSION_SECRET is required for 2FA temp token signing');
  }

  return secret;
}

export function generateTwoFactorTempToken(userId: string, now: number = Date.now()): string {
  const timestamp = now.toString();
  const signature = createHmac('sha256', requireSessionSecret())
    .update(`${userId}:${timestamp}`)
    .digest('hex');

  return `${userId}:${timestamp}:${signature}`;
}

export function verifyTwoFactorTempToken(
  tempToken: string,
  now: number = Date.now()
): { userId: string } | null {
  const parts = tempToken.split(':');
  if (parts.length !== 3) {
    return null;
  }

  const [userId, timestamp, signature] = parts;
  if (!userId || !timestamp || !signature) {
    return null;
  }

  const parsedTimestamp = parseInt(timestamp, 10);
  if (
    Number.isNaN(parsedTimestamp) ||
    parsedTimestamp > now ||
    now - parsedTimestamp > TEMP_TOKEN_MAX_AGE_MS
  ) {
    return null;
  }

  const expected = createHmac('sha256', requireSessionSecret())
    .update(`${userId}:${timestamp}`)
    .digest('hex');

  if (signature.length !== expected.length) {
    return null;
  }

  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  return { userId };
}
