import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient, UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OWNER_ROLE = 'vaultspace_bootstrap_owner';
const RUNTIME_ROLE = 'vaultspace_app';
const BCRYPT_COST_12_HASH = `$2b$12$${'A'.repeat(53)}`;
const EXPECTED_RUNTIME_FUNCTIONS = new Set([
  'bootstrap_login_candidate_v1',
  'bootstrap_session_resolve_v1',
  'bootstrap_organization_resolve_v1',
  'bootstrap_session_create_v1',
  'bootstrap_session_refresh_v1',
  'bootstrap_session_invalidate_v1',
  'bootstrap_session_revoke_self_others_v1',
  'bootstrap_session_revoke_admin_user_org_v1',
  'bootstrap_session_revoke_admin_user_global_single_org_v1',
]);

interface CandidateRow {
  candidate_proven: boolean;
}

interface RedemptionRow {
  authorization_proven: boolean;
  flow_id: string;
  subject_user_id: string;
  subject_email: string;
  initiation_request_id: string | null;
  audit_organization_ids: string[];
  audit_actor_types: string[];
  superseded_flow_ids: string[];
  superseded_request_ids: Array<string | null>;
  revoked_session_ids: string[];
}

const rawPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'],
    },
  },
});

const runtimePrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env['DATABASE_URL'],
    },
  },
});

const suffix = randomUUID();
const createdOrganizationIds: string[] = [];
const createdUserIds: string[] = [];

function currentLookup(label: string): string {
  return `prh1:${createHash('sha256').update(`${label}-${suffix}`).digest('hex')}`;
}

function legacyLookup(): string {
  return randomBytes(32).toString('base64url');
}

async function callAsOwner<T>(sql: string, ...values: unknown[]): Promise<T[]> {
  return rawPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${OWNER_ROLE}`);
    return tx.$queryRawUnsafe<T[]>(sql, ...values);
  });
}

async function candidate(storedLookup: string): Promise<CandidateRow[]> {
  return callAsOwner<CandidateRow>(
    'SELECT candidate_proven FROM public.bootstrap_password_reset_candidate_v1($1::text)',
    storedLookup
  );
}

async function redeem(storedLookup: string, passwordHash = BCRYPT_COST_12_HASH) {
  return callAsOwner<RedemptionRow>(
    `SELECT
       authorization_proven,
       flow_id,
       subject_user_id,
       subject_email,
       initiation_request_id,
       audit_organization_ids,
       audit_actor_types,
       superseded_flow_ids,
       superseded_request_ids,
       revoked_session_ids
     FROM public.bootstrap_password_reset_redeem_v1($1::text, $2::text)`,
    storedLookup,
    passwordHash
  );
}

async function createOrganization(label: string, isActive = true) {
  const organization = await rawPrisma.organization.create({
    data: {
      name: `Password Reset ${label}`,
      slug: `password-reset-${label}-${suffix}`,
      isActive,
    },
  });
  createdOrganizationIds.push(organization.id);
  return organization;
}

async function createUser(input: {
  label: string;
  memberships: Array<{
    organizationId: string;
    role?: UserRole;
    isActive?: boolean;
  }>;
  isActive?: boolean;
}) {
  const user = await rawPrisma.user.create({
    data: {
      email: `password-reset-${input.label}-${suffix}@example.test`,
      passwordHash: `old-password-hash-${input.label}`,
      firstName: 'Password',
      lastName: 'Reset',
      isActive: input.isActive ?? true,
      organizations: {
        create: input.memberships.map((membership) => ({
          organizationId: membership.organizationId,
          role: membership.role ?? UserRole.VIEWER,
          isActive: membership.isActive ?? true,
        })),
      },
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createResetFlow(input: {
  userId: string;
  storedLookup: string;
  label: string;
  expiresAt?: Date;
  usedAt?: Date | null;
  withRecovery?: boolean;
}) {
  return rawPrisma.passwordResetToken.create({
    data: {
      userId: input.userId,
      token: input.storedLookup,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      usedAt: input.usedAt ?? null,
      requestId: `request-${input.label}-${suffix}`.slice(0, 100),
      deliveryStatus: 'QUEUED',
      auditOrganizationIds: [],
      recovery: input.withRecovery
        ? {
            create: {
              userId: input.userId,
              recipientFingerprint: createHash('sha256')
                .update(`recipient-${input.label}-${suffix}`)
                .digest('hex'),
              cipherVersion: 1,
              keyId: `key-${input.label}`,
              nonce: Buffer.alloc(12, 1),
              ciphertext: Buffer.alloc(48, 2),
              authTag: Buffer.alloc(16, 3),
              enqueueStatus: 'QUEUED',
              providerOperationId: `operation-${input.label}-${suffix}`,
            },
          }
        : undefined,
    },
  });
}

describe('W1-2 password-reset redemption inert foundation', () => {
  let activeOrganizationAId: string;
  let activeOrganizationBId: string;
  let inactiveOrganizationId: string;

  beforeAll(async () => {
    const [activeA, activeB, inactive] = await Promise.all([
      createOrganization('active-a'),
      createOrganization('active-b'),
      createOrganization('inactive', false),
    ]);
    activeOrganizationAId = activeA.id;
    activeOrganizationBId = activeB.id;
    inactiveOrganizationId = inactive.id;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await rawPrisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
      await rawPrisma.passwordResetRecovery.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await rawPrisma.passwordResetToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await rawPrisma.userOrganization.deleteMany({ where: { userId: { in: createdUserIds } } });
      await rawPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdOrganizationIds.length > 0) {
      await rawPrisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
    }
    await Promise.all([rawPrisma.$disconnect(), runtimePrisma.$disconnect()]);
  });

  it('keeps exact function, owner, ACL, source, and nine-function runtime posture', async () => {
    const functions = await rawPrisma.$queryRawUnsafe<
      Array<{
        proname: string;
        owner_name: string;
        identity_arguments: string;
        result_type: string;
        language_name: string;
        provolatile: string;
        proparallel: string;
        prosecdef: boolean;
        proconfig: string[];
        source_md5: string;
        comment: string;
        runtime_execute: boolean;
        public_execute: boolean;
      }>
    >(
      `SELECT
         function.proname,
         owner.rolname AS owner_name,
         pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments,
         pg_catalog.pg_get_function_result(function.oid) AS result_type,
         language.lanname AS language_name,
         function.provolatile,
         function.proparallel,
         function.prosecdef,
         function.proconfig,
         pg_catalog.md5(function.prosrc) AS source_md5,
         pg_catalog.obj_description(function.oid, 'pg_proc') AS comment,
         pg_catalog.has_function_privilege('${RUNTIME_ROLE}', function.oid, 'EXECUTE')
           AS runtime_execute,
         pg_catalog.has_function_privilege('public', function.oid, 'EXECUTE')
           AS public_execute
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = function.pronamespace
       INNER JOIN pg_catalog.pg_roles AS owner
         ON owner.oid = function.proowner
       INNER JOIN pg_catalog.pg_language AS language
         ON language.oid = function.prolang
       WHERE namespace.nspname = 'public'
         AND function.proname IN (
           'bootstrap_password_reset_candidate_v1',
           'bootstrap_password_reset_redeem_v1'
         )
       ORDER BY function.proname`
    );

    expect(functions).toHaveLength(2);
    expect(functions[0]).toMatchObject({
      proname: 'bootstrap_password_reset_candidate_v1',
      owner_name: OWNER_ROLE,
      identity_arguments: 'input_stored_token text',
      result_type: 'TABLE(candidate_proven boolean)',
      language_name: 'sql',
      provolatile: 's',
      proparallel: 'u',
      prosecdef: true,
      proconfig: ['search_path=pg_catalog'],
      source_md5: 'fb2338b2271dcbe38ddb05f4b7a55e65',
      comment: 'vaultspace-contract:w1-2-password-reset-candidate-v1',
      runtime_execute: false,
      public_execute: false,
    });
    expect(functions[1]).toMatchObject({
      proname: 'bootstrap_password_reset_redeem_v1',
      owner_name: OWNER_ROLE,
      identity_arguments: 'input_stored_token text, input_password_hash text',
      language_name: 'plpgsql',
      provolatile: 'v',
      proparallel: 'u',
      prosecdef: true,
      proconfig: ['search_path=pg_catalog'],
      source_md5: 'be86d46853493dc7dba68cfba0b68c4b',
      comment: 'vaultspace-contract:w1-2-password-reset-redeem-v1',
      runtime_execute: false,
      public_execute: false,
    });

    const runtimeFunctions = await rawPrisma.$queryRawUnsafe<Array<{ proname: string }>>(
      `SELECT function.proname
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = function.pronamespace
       WHERE namespace.nspname = 'public'
         AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
         AND pg_catalog.has_function_privilege('${RUNTIME_ROLE}', function.oid, 'EXECUTE')
       ORDER BY function.proname`
    );
    expect(new Set(runtimeFunctions.map((row) => row.proname))).toEqual(EXPECTED_RUNTIME_FUNCTIONS);

    await expect(
      runtimePrisma.$queryRawUnsafe(
        'SELECT candidate_proven FROM public.bootstrap_password_reset_candidate_v1($1::text)',
        currentLookup('runtime-denied')
      )
    ).rejects.toThrow();

    const [owner] = await rawPrisma.$queryRawUnsafe<
      Array<{
        rolcanlogin: boolean;
        rolinherit: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
        memberships: bigint;
        table_privileges: string[];
        write_column_privileges: string[];
      }>
    >(
      `SELECT
         owner.rolcanlogin,
         owner.rolinherit,
         owner.rolsuper,
         owner.rolbypassrls,
         (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_auth_members AS membership
           WHERE membership.roleid = owner.oid OR membership.member = owner.oid
         ) AS memberships,
         (
           SELECT COALESCE(
             pg_catalog.array_agg(
               privilege.table_name || ':' || privilege.privilege_type
               ORDER BY privilege.table_name, privilege.privilege_type
             ),
             ARRAY[]::text[]
           )
           FROM information_schema.table_privileges AS privilege
           WHERE privilege.table_schema = 'public'
             AND privilege.grantee = '${OWNER_ROLE}'
         ) AS table_privileges,
         (
           SELECT COALESCE(
             pg_catalog.array_agg(
               privilege.table_name || '.' || privilege.column_name || ':'
                 || privilege.privilege_type
               ORDER BY privilege.table_name, privilege.column_name, privilege.privilege_type
             ),
             ARRAY[]::text[]
           )
           FROM information_schema.column_privileges AS privilege
           WHERE privilege.table_schema = 'public'
             AND privilege.grantee = '${OWNER_ROLE}'
             AND privilege.privilege_type IN ('INSERT', 'UPDATE')
         ) AS write_column_privileges
       FROM pg_catalog.pg_roles AS owner
       WHERE owner.rolname = '${OWNER_ROLE}'`
    );
    expect(owner).toMatchObject({
      rolcanlogin: false,
      rolinherit: false,
      rolsuper: false,
      rolbypassrls: false,
      memberships: BigInt(0),
      table_privileges: [
        'organizations:SELECT',
        'sessions:SELECT',
        'user_organizations:SELECT',
        'users:SELECT',
      ],
    });
    expect(owner?.write_column_privileges).toEqual([
      'organizations.updatedAt:UPDATE',
      'password_reset_recoveries.authTag:UPDATE',
      'password_reset_recoveries.cipherVersion:UPDATE',
      'password_reset_recoveries.ciphertext:UPDATE',
      'password_reset_recoveries.enqueueStatus:UPDATE',
      'password_reset_recoveries.keyId:UPDATE',
      'password_reset_recoveries.nonce:UPDATE',
      'password_reset_recoveries.updatedAt:UPDATE',
      'password_reset_recoveries.wipedAt:UPDATE',
      'password_reset_tokens.usedAt:UPDATE',
      'sessions.createdAt:INSERT',
      'sessions.expiresAt:INSERT',
      'sessions.expiresAt:UPDATE',
      'sessions.id:INSERT',
      'sessions.ipAddress:INSERT',
      'sessions.isActive:INSERT',
      'sessions.isActive:UPDATE',
      'sessions.lastActiveAt:INSERT',
      'sessions.lastActiveAt:UPDATE',
      'sessions.organizationId:INSERT',
      'sessions.token:INSERT',
      'sessions.updatedAt:INSERT',
      'sessions.updatedAt:UPDATE',
      'sessions.userAgent:INSERT',
      'sessions.userId:INSERT',
      'user_organizations.updatedAt:UPDATE',
      'users.passwordHash:UPDATE',
      'users.updatedAt:UPDATE',
    ]);
  });

  it('accepts current and legacy candidates while neutrally denying every invalid state', async () => {
    const activeUser = await createUser({
      label: 'candidate-active',
      memberships: [{ organizationId: activeOrganizationAId }],
    });
    const current = currentLookup('candidate-current');
    const legacy = legacyLookup();
    await createResetFlow({
      userId: activeUser.id,
      storedLookup: current,
      label: 'candidate-current',
    });
    await createResetFlow({
      userId: activeUser.id,
      storedLookup: legacy,
      label: 'candidate-legacy',
    });

    await expect(candidate(current)).resolves.toEqual([{ candidate_proven: true }]);
    await expect(candidate(legacy)).resolves.toEqual([{ candidate_proven: true }]);

    const inactiveUser = await createUser({
      label: 'candidate-inactive-user',
      isActive: false,
      memberships: [{ organizationId: activeOrganizationAId }],
    });
    const inactiveMembershipUser = await createUser({
      label: 'candidate-inactive-membership',
      memberships: [{ organizationId: activeOrganizationAId, isActive: false }],
    });
    const inactiveOrganizationUser = await createUser({
      label: 'candidate-inactive-org',
      memberships: [{ organizationId: inactiveOrganizationId }],
    });

    const deniedCases = [
      { user: activeUser, lookup: currentLookup('candidate-used'), usedAt: new Date() },
      {
        user: activeUser,
        lookup: currentLookup('candidate-expired'),
        expiresAt: new Date(Date.now() - 60_000),
      },
      { user: inactiveUser, lookup: currentLookup('candidate-inactive-user') },
      { user: inactiveMembershipUser, lookup: currentLookup('candidate-inactive-membership') },
      { user: inactiveOrganizationUser, lookup: currentLookup('candidate-inactive-org') },
    ];
    for (const [index, denied] of deniedCases.entries()) {
      await createResetFlow({
        userId: denied.user.id,
        storedLookup: denied.lookup,
        label: `candidate-denied-${index}`,
        usedAt: denied.usedAt,
        expiresAt: denied.expiresAt,
      });
      await expect(candidate(denied.lookup)).resolves.toEqual([]);
    }

    await expect(candidate('malformed')).resolves.toEqual([]);
    await expect(candidate(currentLookup('unknown'))).resolves.toEqual([]);
  });

  it('derives the subject, consumes and supersedes flows, wipes recoveries, and revokes only subject sessions', async () => {
    const subject = await createUser({
      label: 'redeem-subject',
      memberships: [
        { organizationId: activeOrganizationBId, role: UserRole.VIEWER },
        { organizationId: activeOrganizationAId, role: UserRole.ADMIN },
      ],
    });
    const other = await createUser({
      label: 'redeem-other',
      memberships: [{ organizationId: activeOrganizationAId }],
    });

    const exactLookup = currentLookup('redeem-exact');
    const exact = await createResetFlow({
      userId: subject.id,
      storedLookup: exactLookup,
      label: 'redeem-exact',
      withRecovery: true,
    });
    const superseded = await createResetFlow({
      userId: subject.id,
      storedLookup: currentLookup('redeem-superseded'),
      label: 'redeem-superseded',
      withRecovery: true,
    });
    const otherFlow = await createResetFlow({
      userId: other.id,
      storedLookup: currentLookup('redeem-other'),
      label: 'redeem-other',
      withRecovery: true,
    });

    const [subjectSessionA, subjectSessionB, otherSession] = await Promise.all([
      rawPrisma.session.create({
        data: {
          userId: subject.id,
          organizationId: activeOrganizationAId,
          token: randomBytes(32).toString('base64url'),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      }),
      rawPrisma.session.create({
        data: {
          userId: subject.id,
          organizationId: activeOrganizationBId,
          token: randomBytes(32).toString('base64url'),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      }),
      rawPrisma.session.create({
        data: {
          userId: other.id,
          organizationId: activeOrganizationAId,
          token: randomBytes(32).toString('base64url'),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      }),
    ]);

    const rows = await redeem(exactLookup);
    expect(rows).toEqual([
      {
        authorization_proven: true,
        flow_id: exact.id,
        subject_user_id: subject.id,
        subject_email: subject.email,
        initiation_request_id: exact.requestId,
        audit_organization_ids: [activeOrganizationAId, activeOrganizationBId].sort(),
        audit_actor_types:
          activeOrganizationAId < activeOrganizationBId ? ['ADMIN', 'VIEWER'] : ['VIEWER', 'ADMIN'],
        superseded_flow_ids: [superseded.id],
        superseded_request_ids: [superseded.requestId],
        revoked_session_ids: [subjectSessionA.id, subjectSessionB.id].sort(),
      },
    ]);

    const [updatedSubject, exactState, supersededState, otherState, sessions] = await Promise.all([
      rawPrisma.user.findUniqueOrThrow({ where: { id: subject.id } }),
      rawPrisma.passwordResetToken.findUniqueOrThrow({
        where: { id: exact.id },
        include: { recovery: true },
      }),
      rawPrisma.passwordResetToken.findUniqueOrThrow({
        where: { id: superseded.id },
        include: { recovery: true },
      }),
      rawPrisma.passwordResetToken.findUniqueOrThrow({
        where: { id: otherFlow.id },
        include: { recovery: true },
      }),
      rawPrisma.session.findMany({
        where: { id: { in: [subjectSessionA.id, subjectSessionB.id, otherSession.id] } },
        orderBy: { id: 'asc' },
      }),
    ]);

    expect(updatedSubject.passwordHash).toBe(BCRYPT_COST_12_HASH);
    expect(exactState.usedAt).not.toBeNull();
    expect(exactState.recovery).toMatchObject({
      cipherVersion: null,
      keyId: null,
      nonce: null,
      ciphertext: null,
      authTag: null,
      enqueueStatus: 'REDEEMED',
    });
    expect(supersededState.usedAt).not.toBeNull();
    expect(supersededState.recovery).toMatchObject({
      cipherVersion: null,
      keyId: null,
      nonce: null,
      ciphertext: null,
      authTag: null,
      enqueueStatus: 'SUPERSEDED',
    });
    expect(otherState.usedAt).toBeNull();
    expect(otherState.recovery?.ciphertext).not.toBeNull();
    expect(sessions.find((session) => session.id === subjectSessionA.id)?.isActive).toBe(false);
    expect(sessions.find((session) => session.id === subjectSessionB.id)?.isActive).toBe(false);
    expect(sessions.find((session) => session.id === otherSession.id)?.isActive).toBe(true);

    await expect(redeem(exactLookup)).resolves.toEqual([]);
  });

  it('rejects wrong bcrypt shape or cost without any authoritative mutation', async () => {
    const user = await createUser({
      label: 'wrong-bcrypt',
      memberships: [{ organizationId: activeOrganizationAId }],
    });
    const lookup = currentLookup('wrong-bcrypt');
    const flow = await createResetFlow({
      userId: user.id,
      storedLookup: lookup,
      label: 'wrong-bcrypt',
    });

    await expect(redeem(lookup, `$2b$11$${'A'.repeat(53)}`)).resolves.toEqual([]);
    const [unchangedUser, unchangedFlow] = await Promise.all([
      rawPrisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      rawPrisma.passwordResetToken.findUniqueOrThrow({ where: { id: flow.id } }),
    ]);
    expect(unchangedUser.passwordHash).toBe('old-password-hash-wrong-bcrypt');
    expect(unchangedFlow.usedAt).toBeNull();
  });

  it('serializes concurrent double redemption to one success and one neutral denial', async () => {
    const user = await createUser({
      label: 'double-redeem',
      memberships: [{ organizationId: activeOrganizationAId }],
    });
    const lookup = currentLookup('double-redeem');
    await createResetFlow({ userId: user.id, storedLookup: lookup, label: 'double-redeem' });

    const results = await Promise.all([redeem(lookup), redeem(lookup)]);
    expect(results.filter((rows) => rows.length === 1)).toHaveLength(1);
    expect(results.filter((rows) => rows.length === 0)).toHaveLength(1);
  });

  it('serializes with account-global issuance and supersedes the flow committed ahead of redemption', async () => {
    const user = await createUser({
      label: 'concurrent-issuance',
      memberships: [{ organizationId: activeOrganizationAId }],
    });
    const lookup = currentLookup('concurrent-issuance-presented');
    await createResetFlow({
      userId: user.id,
      storedLookup: lookup,
      label: 'concurrent-issuance-presented',
    });

    let releaseIssuance!: () => void;
    const issuanceCanCommit = new Promise<void>((resolveCommit) => {
      releaseIssuance = resolveCommit;
    });
    let confirmIssuanceLock!: (flowId: string) => void;
    const issuanceLockConfirmed = new Promise<string>((resolveLock) => {
      confirmIssuanceLock = resolveLock;
    });

    const issuance = rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended($1::text, 0)
         )`,
        `vaultspace/password-reset/user/${user.id}`
      );
      const replacement = await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          token: currentLookup('concurrent-issuance-replacement'),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          requestId: `request-concurrent-issuance-${suffix}`.slice(0, 100),
          deliveryStatus: 'QUEUED',
          auditOrganizationIds: [],
        },
      });
      confirmIssuanceLock(replacement.id);
      await issuanceCanCommit;
      return replacement;
    });

    const replacementFlowId = await issuanceLockConfirmed;
    const redemption = redeem(lookup);
    releaseIssuance();
    await issuance;
    const rows = await redemption;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.superseded_flow_ids).toEqual([replacementFlowId]);
    await expect(
      rawPrisma.passwordResetToken.findUniqueOrThrow({ where: { id: replacementFlowId } })
    ).resolves.toMatchObject({ usedAt: expect.any(Date) });
  });

  it('rolls every password, token, recovery, and session mutation back with the caller transaction', async () => {
    const user = await createUser({
      label: 'audit-rollback',
      memberships: [{ organizationId: activeOrganizationAId }],
    });
    const lookup = currentLookup('audit-rollback');
    const flow = await createResetFlow({
      userId: user.id,
      storedLookup: lookup,
      label: 'audit-rollback',
      withRecovery: true,
    });
    const session = await rawPrisma.session.create({
      data: {
        userId: user.id,
        organizationId: activeOrganizationAId,
        token: randomBytes(32).toString('base64url'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await expect(
      rawPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${OWNER_ROLE}`);
        const result = await tx.$queryRawUnsafe<RedemptionRow[]>(
          `SELECT *
           FROM public.bootstrap_password_reset_redeem_v1($1::text, $2::text)`,
          lookup,
          BCRYPT_COST_12_HASH
        );
        expect(result).toHaveLength(1);
        throw new Error('EXPECTED_AUDIT_INSERT_FAILURE');
      })
    ).rejects.toThrow('EXPECTED_AUDIT_INSERT_FAILURE');

    const [unchangedUser, unchangedFlow, unchangedSession] = await Promise.all([
      rawPrisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      rawPrisma.passwordResetToken.findUniqueOrThrow({
        where: { id: flow.id },
        include: { recovery: true },
      }),
      rawPrisma.session.findUniqueOrThrow({ where: { id: session.id } }),
    ]);
    expect(unchangedUser.passwordHash).toBe('old-password-hash-audit-rollback');
    expect(unchangedFlow.usedAt).toBeNull();
    expect(unchangedFlow.recovery?.ciphertext).not.toBeNull();
    expect(unchangedSession.isActive).toBe(true);
  });

  it('uses the account-global advisory lock before row locks and denies a deactivated account cleanly', async () => {
    const user = await createUser({
      label: 'concurrent-deactivate',
      memberships: [{ organizationId: activeOrganizationAId }],
    });
    const lookup = currentLookup('concurrent-deactivate');
    const flow = await createResetFlow({
      userId: user.id,
      storedLookup: lookup,
      label: 'concurrent-deactivate',
    });

    let releaseAccountLock!: () => void;
    const accountLockHeld = new Promise<void>((resolveLock) => {
      releaseAccountLock = resolveLock;
    });
    let confirmAccountLock!: () => void;
    const accountLockConfirmed = new Promise<void>((resolveLock) => {
      confirmAccountLock = resolveLock;
    });

    const deactivation = rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended($1::text, 0)
         )`,
        `vaultspace/password-reset/user/${user.id}`
      );
      await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
      confirmAccountLock();
      await accountLockHeld;
    });

    await accountLockConfirmed;
    const redemption = redeem(lookup);
    releaseAccountLock();
    await deactivation;
    await expect(redemption).resolves.toEqual([]);

    const [unchangedUser, unchangedFlow] = await Promise.all([
      rawPrisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      rawPrisma.passwordResetToken.findUniqueOrThrow({ where: { id: flow.id } }),
    ]);
    expect(unchangedUser.passwordHash).toBe('old-password-hash-concurrent-deactivate');
    expect(unchangedFlow.usedAt).toBeNull();
  });

  it('resists hostile search path and preserves the administrator lifecycle residual', async () => {
    const user = await createUser({
      label: 'hostile-path',
      memberships: [{ organizationId: activeOrganizationAId }],
    });
    const lookup = currentLookup('hostile-path');
    await createResetFlow({ userId: user.id, storedLookup: lookup, label: 'hostile-path' });

    const rows = await rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${OWNER_ROLE}`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path = pg_temp, public`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_org_id = 'hostile-organization'`);
      return tx.$queryRawUnsafe<CandidateRow[]>(
        'SELECT candidate_proven FROM public.bootstrap_password_reset_candidate_v1($1::text)',
        lookup
      );
    });
    expect(rows).toEqual([{ candidate_proven: true }]);

    const runtimeResidual = await rawPrisma.$queryRawUnsafe<
      Array<{
        token_select: boolean;
        token_update: boolean;
        recovery_select: boolean;
        recovery_update: boolean;
        provider_correlation_select: boolean;
      }>
    >(
      `SELECT
         pg_catalog.has_table_privilege(
           '${RUNTIME_ROLE}', 'public.password_reset_tokens', 'SELECT'
         ) AS token_select,
         pg_catalog.has_table_privilege(
           '${RUNTIME_ROLE}', 'public.password_reset_tokens', 'UPDATE'
         ) AS token_update,
         pg_catalog.has_table_privilege(
           '${RUNTIME_ROLE}', 'public.password_reset_recoveries', 'SELECT'
         ) AS recovery_select,
         pg_catalog.has_table_privilege(
           '${RUNTIME_ROLE}', 'public.password_reset_recoveries', 'UPDATE'
         ) AS recovery_update,
         pg_catalog.has_table_privilege(
           '${RUNTIME_ROLE}', 'public.password_reset_provider_correlations', 'SELECT'
         ) AS provider_correlation_select`
    );
    expect(runtimeResidual).toEqual([
      {
        token_select: true,
        token_update: true,
        recovery_select: true,
        recovery_update: true,
        provider_correlation_select: false,
      },
    ]);

    const lifecycleSource = readFileSync(
      resolve(process.cwd(), 'src/app/api/users/[userId]/route.ts'),
      'utf8'
    );
    expect(lifecycleSource).toContain('passwordResetToken.updateMany');
    expect(lifecycleSource).toContain('passwordResetRecovery.updateMany');

    const migrationSource = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260813150000_w1_2_password_reset_redemption_foundation/migration.sql'
      ),
      'utf8'
    );
    const readOnlyPreflight = migrationSource.indexOf('DO $$');
    const ddlTransaction = migrationSource.indexOf(
      '-- All catalog mutations remain atomic after the read-only credential'
    );
    expect(readOnlyPreflight).toBeGreaterThan(-1);
    expect(ddlTransaction).toBeGreaterThan(readOnlyPreflight);
    expect(migrationSource.indexOf('BEGIN;')).toBeGreaterThan(ddlTransaction);
    expect(migrationSource).toContain(
      "MESSAGE = 'BOOTSTRAP_MIGRATION_RUNTIME_CREDENTIAL_FORBIDDEN'"
    );
    const initialLookup = migrationSource.indexOf(
      'SELECT reset_token."userId"\n    INTO candidate_user_id'
    );
    const advisoryLock = migrationSource.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock(');
    const userRowLock = migrationSource.indexOf(
      'SELECT candidate_user.id, candidate_user.email\n    INTO locked_user_id'
    );
    const resetRowLock = migrationSource.indexOf(
      'SELECT reset_token.id, reset_token."requestId"\n    INTO locked_flow_id'
    );
    expect(initialLookup).toBeGreaterThan(-1);
    expect(advisoryLock).toBeGreaterThan(initialLookup);
    expect(userRowLock).toBeGreaterThan(advisoryLock);
    expect(resetRowLock).toBeGreaterThan(userRowLock);
    const redeemBody = migrationSource.slice(
      migrationSource.indexOf('CREATE FUNCTION public.bootstrap_password_reset_redeem_v1('),
      migrationSource.indexOf(
        'COMMENT ON FUNCTION public.bootstrap_password_reset_candidate_v1(text)'
      )
    );
    expect(redeemBody).not.toMatch(/\bEXECUTE\b/i);
  });
});
