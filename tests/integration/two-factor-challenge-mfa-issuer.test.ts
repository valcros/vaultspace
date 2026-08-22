import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { PrismaClient, UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RUNTIME_ROLE = 'vaultspace_app';
const MFA_OWNER_ROLE = 'vaultspace_mfa_auth_owner';
const ISSUE_FUNCTION =
  'public.bootstrap_two_factor_challenge_issue_v1(text, text, text, timestamp with time zone)';
const RESOLVE_FUNCTION = 'public.bootstrap_two_factor_challenge_resolve_v1(text)';
const MFA_V1_FUNCTION =
  'public.bootstrap_session_create_mfa_v1(text, text, text, timestamp with time zone, text, text)';
const MFA_V2_FUNCTION =
  'public.bootstrap_session_create_mfa_v2(text, text, text, text, timestamp with time zone, text, text)';
const ISSUE_CALL = 'public.bootstrap_two_factor_challenge_issue_v1';
const RESOLVE_CALL = 'public.bootstrap_two_factor_challenge_resolve_v1';
const MFA_V2_CALL = 'public.bootstrap_session_create_mfa_v2';

const rawPrisma = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'] } },
});
const runtimePrisma = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL'] } },
});

const suffix = randomUUID();
const token = () => randomBytes(32).toString('base64url');
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');

let organizationId: string;
let userId: string;
let usesMinimalFixture = false;

async function issueChallenge(rawToken: string, expiresAt = new Date(Date.now() + 5 * 60 * 1000)) {
  return runtimePrisma.$queryRawUnsafe<Array<{ challenge_id: string; challenge_expires_at: Date }>>(
    `SELECT * FROM ${ISSUE_CALL}($1::text, $2::text, $3::text, $4::timestamptz)`,
    userId,
    organizationId,
    hashToken(rawToken),
    expiresAt
  );
}

async function issueMfaSession(
  challengeToken: string,
  sessionToken = token(),
  input: { userId?: string; organizationId?: string } = {}
) {
  return runtimePrisma.$queryRawUnsafe<
    Array<{
      session_id: string;
      session_created_at: Date;
      session_expires_at: Date;
      session_mfa_verified_at: Date;
      session_authentication_assurance: 'MFA';
    }>
  >(
    `SELECT * FROM ${MFA_V2_CALL}($1::text, $2::text, $3::text, $4::text, $5::timestamptz, $6::text, $7::text)`,
    input.userId ?? userId,
    input.organizationId ?? organizationId,
    challengeToken,
    sessionToken,
    new Date(Date.now() + 24 * 60 * 60 * 1000),
    '192.0.2.41',
    'two-factor-issuer-integration'
  );
}

describe('server-side two-factor challenge MFA issuance', () => {
  beforeAll(async () => {
    const [organizationShape] = await rawPrisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT COUNT(*)::bigint AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'createdAt'"
    );
    usesMinimalFixture = Number(organizationShape?.count ?? 0) === 0;
    if (usesMinimalFixture) {
      organizationId = `two-factor-challenge-org-${suffix}`;
      userId = `two-factor-challenge-user-${suffix}`;
      await rawPrisma.$executeRawUnsafe(
        'INSERT INTO public.organizations (id, "isActive") VALUES ($1::text, true)',
        organizationId
      );
      await rawPrisma.$executeRawUnsafe(
        'INSERT INTO public.users (id, "isActive") VALUES ($1::text, true)',
        userId
      );
      await rawPrisma.$executeRawUnsafe(
        'INSERT INTO public.user_organizations ("userId", "organizationId", "isActive") VALUES ($1::text, $2::text, true)',
        userId,
        organizationId
      );
      return;
    }

    const organization = await rawPrisma.organization.create({
      data: { name: 'Two factor challenge test', slug: `two-factor-challenge-${suffix}` },
    });
    organizationId = organization.id;
    const user = await rawPrisma.user.create({
      data: {
        email: `two-factor-challenge-${suffix}@example.test`,
        passwordHash: `two-factor-challenge-${suffix}`,
        firstName: 'Two',
        lastName: 'Factor',
      },
    });
    userId = user.id;
    await rawPrisma.userOrganization.create({
      data: {
        id: `two-factor-challenge-membership-${suffix}`,
        userId,
        organizationId,
        role: UserRole.VIEWER,
      },
    });
  });

  afterAll(async () => {
    if (usesMinimalFixture) {
      await rawPrisma.$executeRawUnsafe(
        'DELETE FROM public.sessions WHERE "userId" = $1::text',
        userId
      );
      await rawPrisma.$executeRawUnsafe(
        'DELETE FROM public.two_factor_login_challenges WHERE "userId" = $1::text',
        userId
      );
      await rawPrisma.$executeRawUnsafe(
        'DELETE FROM public.user_organizations WHERE "userId" = $1::text',
        userId
      );
      await rawPrisma.$executeRawUnsafe('DELETE FROM public.users WHERE id = $1::text', userId);
      await rawPrisma.$executeRawUnsafe(
        'DELETE FROM public.organizations WHERE id = $1::text',
        organizationId
      );
    } else {
      await rawPrisma.session.deleteMany({ where: { userId } });
      await rawPrisma.twoFactorLoginChallenge.deleteMany({ where: { userId } });
      await rawPrisma.user.deleteMany({ where: { id: userId } });
      await rawPrisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await runtimePrisma.$disconnect();
    await rawPrisma.$disconnect();
  });

  it('exposes only the challenge-bound issuer and the two minimal challenge functions', async () => {
    const [extension] = await rawPrisma.$queryRawUnsafe<
      Array<{ extension_schema: string | null; digest_function: string | null }>
    >(
      `SELECT namespace.nspname AS extension_schema,
        pg_catalog.to_regprocedure('public.digest(text,text)')::text AS digest_function
      FROM pg_catalog.pg_extension AS extension
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = extension.extnamespace
      WHERE extension.extname = 'pgcrypto'`
    );
    expect(extension).toEqual({
      extension_schema: 'public',
      digest_function: 'digest(text,text)',
    });

    const [acl] = await rawPrisma.$queryRawUnsafe<
      Array<{ issue: boolean; resolve: boolean; v1: boolean; v2: boolean }>
    >(
      `SELECT
        pg_catalog.has_function_privilege($1, $2, 'EXECUTE') AS issue,
        pg_catalog.has_function_privilege($1, $3, 'EXECUTE') AS resolve,
        pg_catalog.has_function_privilege($1, $4, 'EXECUTE') AS v1,
        pg_catalog.has_function_privilege($1, $5, 'EXECUTE') AS v2`,
      RUNTIME_ROLE,
      ISSUE_FUNCTION,
      RESOLVE_FUNCTION,
      MFA_V1_FUNCTION,
      MFA_V2_FUNCTION
    );
    expect(acl).toEqual({ issue: true, resolve: true, v1: false, v2: true });

    const [tableAcl] = await rawPrisma.$queryRawUnsafe<Array<{ direct_table_access: boolean }>>(
      `SELECT
        pg_catalog.has_table_privilege($1, 'public.two_factor_login_challenges', 'SELECT')
        OR pg_catalog.has_table_privilege($1, 'public.two_factor_login_challenges', 'INSERT')
        OR pg_catalog.has_table_privilege($1, 'public.two_factor_login_challenges', 'UPDATE')
        OR pg_catalog.has_table_privilege($1, 'public.two_factor_login_challenges', 'DELETE')
        OR pg_catalog.has_table_privilege($1, 'public.two_factor_login_challenges', 'TRUNCATE')
        OR pg_catalog.has_table_privilege($1, 'public.two_factor_login_challenges', 'REFERENCES')
        OR pg_catalog.has_table_privilege($1, 'public.two_factor_login_challenges', 'TRIGGER')
        AS direct_table_access`,
      RUNTIME_ROLE
    );
    expect(tableAcl).toEqual({ direct_table_access: false });

    const [owner] = await rawPrisma.$queryRawUnsafe<
      Array<{ rolcanlogin: boolean; rolinherit: boolean; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      'SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = $1',
      MFA_OWNER_ROLE
    );
    expect(owner).toEqual({
      rolcanlogin: false,
      rolinherit: false,
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it('denies a direct runtime attempt to mint an MFA-assured session', async () => {
    await expect(
      runtimePrisma.$executeRawUnsafe(
        'INSERT INTO public.sessions (id, "createdAt", "updatedAt", "userId", "organizationId", token, "expiresAt", "lastActiveAt", "mfaVerifiedAt", "authenticationAssurance", "isActive") VALUES ($1::text, statement_timestamp(), statement_timestamp(), $2::text, $3::text, $4::text, statement_timestamp() + interval \'1 day\', statement_timestamp(), statement_timestamp(), \'MFA\'::public."SessionAuthenticationAssurance", true)',
        `direct-mfa-denial-${randomUUID()}`,
        userId,
        organizationId,
        token()
      )
    ).rejects.toThrow();
  });

  it('issues one MFA session, consumes the challenge, and denies replay', async () => {
    const challengeToken = token();
    await expect(issueChallenge(challengeToken)).resolves.toHaveLength(1);
    // The persisted verifier is deliberately not a bearer credential. A
    // database read of tokenHash cannot resolve or consume the raw challenge.
    await expect(
      runtimePrisma.$queryRawUnsafe(
        `SELECT * FROM ${RESOLVE_CALL}($1::text)`,
        hashToken(challengeToken)
      )
    ).resolves.toEqual([]);
    await expect(issueMfaSession(hashToken(challengeToken))).resolves.toEqual([]);
    await expect(
      runtimePrisma.$queryRawUnsafe(`SELECT * FROM ${RESOLVE_CALL}($1::text)`, challengeToken)
    ).resolves.toEqual([{ challenge_user_id: userId, challenge_organization_id: organizationId }]);

    const created = await issueMfaSession(challengeToken);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      session_mfa_verified_at: expect.any(Date),
      session_authentication_assurance: 'MFA',
    });
    await expect(issueMfaSession(challengeToken)).resolves.toEqual([]);
    await expect(
      runtimePrisma.$queryRawUnsafe(`SELECT * FROM ${RESOLVE_CALL}($1::text)`, challengeToken)
    ).resolves.toEqual([]);

    if (usesMinimalFixture) {
      const [stored] = await rawPrisma.$queryRawUnsafe<
        Array<{ assurance: 'MFA'; verified_at: Date | null }>
      >(
        'SELECT "authenticationAssurance"::text AS assurance, "mfaVerifiedAt" AS verified_at FROM public.sessions WHERE id = $1::text',
        created[0]!.session_id
      );
      expect(stored).toEqual({ assurance: 'MFA', verified_at: expect.any(Date) });
    } else {
      const stored = await rawPrisma.session.findUniqueOrThrow({
        where: { id: created[0]!.session_id },
      });
      expect(stored).toMatchObject({
        authenticationAssurance: 'MFA',
        mfaVerifiedAt: expect.any(Date),
      });
    }
  });

  it('denies expired or mismatched challenges without consuming a valid challenge', async () => {
    await expect(issueChallenge(token(), new Date(Date.now() - 1_000))).resolves.toEqual([]);

    const validChallenge = token();
    await issueChallenge(validChallenge);
    await expect(issueMfaSession(token())).resolves.toEqual([]);
    await expect(
      runtimePrisma.$queryRawUnsafe(`SELECT * FROM ${RESOLVE_CALL}($1::text)`, validChallenge)
    ).resolves.toEqual([{ challenge_user_id: userId, challenge_organization_id: organizationId }]);
  });

  it('does not let a valid challenge cross user or organization boundaries', async () => {
    const validChallenge = token();
    await issueChallenge(validChallenge);
    const otherUserId = `two-factor-other-user-${randomUUID()}`;
    const otherOrganizationId = `two-factor-other-org-${randomUUID()}`;

    await expect(
      issueMfaSession(validChallenge, token(), { organizationId: otherOrganizationId })
    ).resolves.toEqual([]);
    await expect(
      issueMfaSession(validChallenge, token(), { userId: otherUserId })
    ).resolves.toEqual([]);
    await expect(
      issueMfaSession(validChallenge, token(), {
        userId: otherUserId,
        organizationId: otherOrganizationId,
      })
    ).resolves.toEqual([]);
    await expect(
      runtimePrisma.$queryRawUnsafe(`SELECT * FROM ${RESOLVE_CALL}($1::text)`, validChallenge)
    ).resolves.toEqual([{ challenge_user_id: userId, challenge_organization_id: organizationId }]);
    await expect(issueMfaSession(validChallenge)).resolves.toHaveLength(1);
  });

  it('allows exactly one of two concurrent session-issuer calls to consume one challenge', async () => {
    const challengeToken = token();
    await issueChallenge(challengeToken);
    const results = await Promise.all([
      issueMfaSession(challengeToken, token()),
      issueMfaSession(challengeToken, token()),
    ]);
    expect(results.filter((rows) => rows.length === 1)).toHaveLength(1);
    expect(results.filter((rows) => rows.length === 0)).toHaveLength(1);
  });
});
