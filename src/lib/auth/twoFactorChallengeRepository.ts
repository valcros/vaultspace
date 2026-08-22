import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

interface ChallengeIssueRow {
  challenge_id: string;
  challenge_expires_at: Date | string;
}

interface ChallengeResolveRow {
  challenge_user_id: string;
  challenge_organization_id: string;
}

export interface IssuedTwoFactorChallenge {
  challengeId: string;
  expiresAt: Date;
}

export async function issueTenantTwoFactorChallenge(input: {
  userId: string;
  organizationId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<IssuedTwoFactorChallenge | null> {
  if (
    !IDENTIFIER_PATTERN.test(input.userId) ||
    !IDENTIFIER_PATTERN.test(input.organizationId) ||
    !HASH_PATTERN.test(input.tokenHash) ||
    Number.isNaN(input.expiresAt.getTime()) ||
    input.expiresAt.getTime() <= Date.now() ||
    input.expiresAt.getTime() - Date.now() > MAX_CHALLENGE_LIFETIME_MS
  ) {
    return null;
  }

  const rows = await db.$queryRaw<ChallengeIssueRow[]>(
    Prisma.sql`
      SELECT challenge_id, challenge_expires_at
      FROM public.bootstrap_two_factor_challenge_issue_v1(
        ${input.userId}::text,
        ${input.organizationId}::text,
        ${input.tokenHash}::text,
        ${input.expiresAt}::timestamptz
      )
    `
  );
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw new Error('TWO_FACTOR_CHALLENGE_ISSUE_DUPLICATE');
  }

  const row = rows[0]!;
  const expiresAt = new Date(row.challenge_expires_at);
  if (!IDENTIFIER_PATTERN.test(row.challenge_id) || Number.isNaN(expiresAt.getTime())) {
    throw new Error('TWO_FACTOR_CHALLENGE_ISSUE_ROW_INVALID');
  }
  return { challengeId: row.challenge_id, expiresAt };
}

export async function resolveTenantTwoFactorChallenge(
  token: string
): Promise<{ userId: string; organizationId: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }
  const rows = await db.$queryRaw<ChallengeResolveRow[]>(
    Prisma.sql`
      SELECT challenge_user_id, challenge_organization_id
      FROM public.bootstrap_two_factor_challenge_resolve_v1(${token}::text)
    `
  );
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw new Error('TWO_FACTOR_CHALLENGE_RESOLVE_DUPLICATE');
  }
  const row = rows[0]!;
  if (
    !IDENTIFIER_PATTERN.test(row.challenge_user_id) ||
    !IDENTIFIER_PATTERN.test(row.challenge_organization_id)
  ) {
    throw new Error('TWO_FACTOR_CHALLENGE_RESOLVE_ROW_INVALID');
  }
  return { userId: row.challenge_user_id, organizationId: row.challenge_organization_id };
}
