import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { PrismaClient, UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OWNER_ROLE = 'vaultspace_bootstrap_owner';
const RUNTIME_ROLE = 'vaultspace_app';
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
  'bootstrap_password_reset_candidate_v1',
  'bootstrap_password_reset_redeem_v1',
  'bootstrap_two_factor_challenge_issue_v1',
  'bootstrap_two_factor_challenge_resolve_v1',
  'bootstrap_session_create_mfa_v2',
]);

interface IssueRow {
  authorization_proven: boolean;
  flow_id: string;
  audit_organization_ids: string[];
  superseded_flow_ids: string[];
  superseded_request_ids: Array<string | null>;
}

interface RecipientRow {
  authorization_proven: boolean;
  recipient_email: string;
}

const rawPrisma = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL_ADMIN'] || process.env['DATABASE_URL'] } },
});
const runtimePrisma = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL'] } },
});
const suffix = randomUUID();
const createdOrganizationIds: string[] = [];
const createdUserIds: string[] = [];

function lookup(label: string): string {
  return `prh1:${createHash('sha256').update(`${label}-${suffix}`).digest('hex')}`;
}

function token(): string {
  return randomBytes(32).toString('base64url');
}

function envelope() {
  return {
    cipherVersion: 2,
    keyId: 'key-2026-08',
    nonce: Buffer.alloc(12, 1),
    ciphertext: Buffer.alloc(48, 2),
    authTag: Buffer.alloc(16, 3),
    recipientFingerprint: createHash('sha256').update(`recipient-${suffix}`).digest('hex'),
  };
}

async function callAsOwner<T>(sql: string, ...values: unknown[]): Promise<T[]> {
  return rawPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${OWNER_ROLE}`);
    return tx.$queryRawUnsafe<T[]>(sql, ...values);
  });
}

async function issueAnonymous(input: {
  email: string;
  slug?: string | null;
  flowId: string;
  storedToken: string;
  requestId?: string;
  envelope?: ReturnType<typeof envelope>;
}) {
  const recovery = input.envelope ?? envelope();
  return callAsOwner<IssueRow>(
    `SELECT
       authorization_proven,
       flow_id,
       audit_organization_ids,
       superseded_flow_ids,
       superseded_request_ids
     FROM public.bootstrap_password_reset_issue_anonymous_v1(
       $1::text, $2::text, $3::text, $4::text, $5::text, $6::integer,
       $7::text, $8::bytea, $9::bytea, $10::bytea, $11::text
     )`,
    input.email,
    input.slug ?? null,
    input.flowId,
    input.storedToken,
    input.requestId ?? `request-${input.flowId}`.slice(0, 100),
    recovery.cipherVersion,
    recovery.keyId,
    recovery.nonce,
    recovery.ciphertext,
    recovery.authTag,
    recovery.recipientFingerprint
  );
}

async function prepareAdminRecipient(actorToken: string, targetUserId: string) {
  return callAsOwner<RecipientRow>(
    `SELECT authorization_proven, recipient_email
     FROM public.bootstrap_password_reset_admin_recipient_v1($1::text, $2::text)`,
    actorToken,
    targetUserId
  );
}

async function issueAdmin(input: {
  actorToken: string;
  targetUserId: string;
  expectedEmail: string;
  flowId: string;
  storedToken: string;
}) {
  const recovery = envelope();
  return callAsOwner<IssueRow>(
    `SELECT
       authorization_proven,
       flow_id,
       audit_organization_ids,
       superseded_flow_ids,
       superseded_request_ids
     FROM public.bootstrap_password_reset_issue_admin_single_org_v1(
       $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
       $7::integer, $8::text, $9::bytea, $10::bytea, $11::bytea, $12::text
     )`,
    input.actorToken,
    input.targetUserId,
    input.expectedEmail,
    input.flowId,
    input.storedToken,
    `request-${input.flowId}`.slice(0, 100),
    recovery.cipherVersion,
    recovery.keyId,
    recovery.nonce,
    recovery.ciphertext,
    recovery.authTag,
    recovery.recipientFingerprint
  );
}

async function createOrganization(label: string, isActive = true) {
  const organization = await rawPrisma.organization.create({
    data: {
      name: `Issuance ${label}`,
      slug: `issuance-${label}-${suffix}`,
      isActive,
    },
  });
  createdOrganizationIds.push(organization.id);
  return organization;
}

async function createUser(input: {
  label: string;
  memberships: Array<{ organizationId: string; role?: UserRole; isActive?: boolean }>;
  isActive?: boolean;
}) {
  const user = await rawPrisma.user.create({
    data: {
      email: `issuance-${input.label}-${suffix}@example.test`,
      passwordHash: `password-${input.label}`,
      firstName: 'Issuance',
      lastName: input.label,
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

async function createActorSession(userId: string, organizationId: string, overrides = {}) {
  return rawPrisma.session.create({
    data: {
      userId,
      organizationId,
      token: token(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      isActive: true,
      ...overrides,
    },
  });
}

describe('W1-2 inert password-reset issuance foundation', () => {
  let organizationAId: string;
  let organizationBId: string;
  let inactiveOrganizationId: string;

  beforeAll(async () => {
    const [organizationA, organizationB, inactiveOrganization] = await Promise.all([
      createOrganization('active-a'),
      createOrganization('active-b'),
      createOrganization('inactive', false),
    ]);
    organizationAId = organizationA.id;
    organizationBId = organizationB.id;
    inactiveOrganizationId = inactiveOrganization.id;
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

  it('keeps the exact fourteen-function runtime matrix and all three reset functions owner-only', async () => {
    const functions = await rawPrisma.$queryRawUnsafe<
      Array<{
        proname: string;
        owner_name: string;
        source_md5: string;
        runtime_execute: boolean;
        public_execute: boolean;
        comment: string;
      }>
    >(
      `SELECT
         function.proname,
         owner.rolname AS owner_name,
         pg_catalog.md5(function.prosrc) AS source_md5,
         pg_catalog.has_function_privilege('${RUNTIME_ROLE}', function.oid, 'EXECUTE') AS runtime_execute,
         pg_catalog.has_function_privilege('public', function.oid, 'EXECUTE') AS public_execute,
         pg_catalog.obj_description(function.oid, 'pg_proc') AS comment
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
       INNER JOIN pg_catalog.pg_roles AS owner ON owner.oid = function.proowner
       WHERE namespace.nspname = 'public'
         AND function.proname IN (
           'bootstrap_password_reset_issue_anonymous_v1',
           'bootstrap_password_reset_admin_recipient_v1',
           'bootstrap_password_reset_issue_admin_single_org_v1'
         )
       ORDER BY function.proname`
    );
    expect(functions).toEqual([
      {
        proname: 'bootstrap_password_reset_admin_recipient_v1',
        owner_name: OWNER_ROLE,
        source_md5: '66d39e5da1e0d1ec3d5183a3abdce0fe',
        runtime_execute: false,
        public_execute: false,
        comment: 'vaultspace-contract:w1-2-password-reset-admin-recipient-v1',
      },
      {
        proname: 'bootstrap_password_reset_issue_admin_single_org_v1',
        owner_name: OWNER_ROLE,
        source_md5: 'bbfbfca5c550275c6636c7c65cb1e589',
        runtime_execute: false,
        public_execute: false,
        comment: 'vaultspace-contract:w1-2-password-reset-issue-admin-single-org-v1',
      },
      {
        proname: 'bootstrap_password_reset_issue_anonymous_v1',
        owner_name: OWNER_ROLE,
        source_md5: '5f6f28595a24f218dfe2afda96a67eef',
        runtime_execute: false,
        public_execute: false,
        comment: 'vaultspace-contract:w1-2-password-reset-issue-anonymous-v1',
      },
    ]);

    const runtimeFunctions = await rawPrisma.$queryRawUnsafe<Array<{ proname: string }>>(
      `SELECT function.proname
       FROM pg_catalog.pg_proc AS function
       INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname = 'public'
         AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
         AND pg_catalog.has_function_privilege('${RUNTIME_ROLE}', function.oid, 'EXECUTE')
       ORDER BY function.proname`
    );
    expect(new Set(runtimeFunctions.map((row) => row.proname))).toEqual(EXPECTED_RUNTIME_FUNCTIONS);

    const [constraint] = await rawPrisma.$queryRawUnsafe<Array<{ definition: string }>>(
      `SELECT pg_catalog.pg_get_constraintdef(catalog_constraint.oid) AS definition
       FROM pg_catalog.pg_constraint AS catalog_constraint
       WHERE catalog_constraint.conrelid = 'public.password_reset_recoveries'::pg_catalog.regclass
         AND catalog_constraint.conname = 'password_reset_recoveries_envelope_complete'`
    );
    expect(constraint?.definition).toContain('ANY (ARRAY[1, 2])');
  });

  it('creates a version 2 anonymous flow without returning identity or recovery data', async () => {
    const user = await createUser({
      label: 'anonymous-success',
      memberships: [{ organizationId: organizationAId }],
    });
    const flowId = `flow-anonymous-${suffix}`;
    const rows = await issueAnonymous({
      email: user.email,
      slug: `issuance-active-a-${suffix}`,
      flowId,
      storedToken: lookup('anonymous-success'),
    });

    expect(rows).toEqual([
      {
        authorization_proven: true,
        flow_id: flowId,
        audit_organization_ids: [organizationAId],
        superseded_flow_ids: [],
        superseded_request_ids: [],
      },
    ]);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'audit_organization_ids',
      'authorization_proven',
      'flow_id',
      'superseded_flow_ids',
      'superseded_request_ids',
    ]);
    const created = await rawPrisma.passwordResetToken.findUniqueOrThrow({
      where: { id: flowId },
      include: { recovery: true },
    });
    expect(created).toMatchObject({
      userId: user.id,
      organizationId: organizationAId,
      auditOrganizationIds: [organizationAId],
      deliveryStatus: 'PENDING',
      providerCorrelationSchemaVersion: 1,
    });
    expect(created.expiresAt.getTime() - created.createdAt.getTime()).toBeGreaterThanOrEqual(
      60 * 60 * 1000
    );
    expect(created.expiresAt.getTime() - created.createdAt.getTime()).toBeLessThan(
      60 * 60 * 1000 + 1000
    );
    expect(created.recovery).toMatchObject({
      flowId,
      userId: user.id,
      cipherVersion: 2,
      providerOperationId: flowId,
    });
  });

  it('neutrally denies unknown, inactive, membership-ineligible, and invalid-envelope requests', async () => {
    const [inactiveUser, noActiveMembershipUser, inactiveOrganizationUser] = await Promise.all([
      createUser({
        label: 'inactive-user',
        memberships: [{ organizationId: organizationAId }],
        isActive: false,
      }),
      createUser({
        label: 'inactive-membership',
        memberships: [{ organizationId: organizationAId, isActive: false }],
      }),
      createUser({
        label: 'inactive-organization',
        memberships: [{ organizationId: inactiveOrganizationId }],
      }),
    ]);
    const cases = [
      { email: `unknown-${suffix}@example.test`, flowId: `unknown-${suffix}` },
      { email: inactiveUser.email, flowId: `inactive-user-${suffix}` },
      { email: noActiveMembershipUser.email, flowId: `inactive-membership-${suffix}` },
      { email: inactiveOrganizationUser.email, flowId: `inactive-org-${suffix}` },
    ];
    for (const entry of cases) {
      await expect(
        issueAnonymous({
          email: entry.email,
          flowId: entry.flowId,
          storedToken: lookup(entry.flowId),
        })
      ).resolves.toEqual([]);
    }
    const activeUser = await createUser({
      label: 'invalid-envelope',
      memberships: [{ organizationId: organizationAId }],
    });
    await expect(
      issueAnonymous({
        email: activeUser.email,
        flowId: `invalid-envelope-${suffix}`,
        storedToken: lookup('invalid-envelope'),
        envelope: { ...envelope(), nonce: Buffer.alloc(11) },
      })
    ).resolves.toEqual([]);
  });

  it('serializes concurrent issuance and keeps at most one current flow', async () => {
    const user = await createUser({
      label: 'concurrent',
      memberships: [{ organizationId: organizationAId }],
    });
    const results = await Promise.all([
      issueAnonymous({
        email: user.email,
        flowId: `concurrent-a-${suffix}`,
        storedToken: lookup('concurrent-a'),
      }),
      issueAnonymous({
        email: user.email,
        flowId: `concurrent-b-${suffix}`,
        storedToken: lookup('concurrent-b'),
      }),
    ]);
    expect(results.flat()).toHaveLength(1);
    await expect(
      rawPrisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } })
    ).resolves.toBe(1);
  });

  it('supersedes old flows and wipes their recovery material under the account lock', async () => {
    const user = await createUser({
      label: 'supersession',
      memberships: [{ organizationId: organizationAId }],
    });
    const oldFlowId = `old-flow-${suffix}`;
    await rawPrisma.passwordResetToken.create({
      data: {
        id: oldFlowId,
        userId: user.id,
        token: lookup('old-flow'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 2 * 60 * 1000),
        requestId: `old-request-${suffix}`.slice(0, 100),
        deliveryStatus: 'PENDING',
        auditOrganizationIds: [organizationAId],
        recovery: {
          create: {
            userId: user.id,
            recipientFingerprint: envelope().recipientFingerprint,
            cipherVersion: 2,
            keyId: envelope().keyId,
            nonce: envelope().nonce,
            ciphertext: envelope().ciphertext,
            authTag: envelope().authTag,
            providerOperationId: oldFlowId,
          },
        },
      },
    });
    const newFlowId = `new-flow-${suffix}`;
    const rows = await issueAnonymous({
      email: user.email,
      flowId: newFlowId,
      storedToken: lookup('new-flow'),
    });
    expect(rows[0]?.superseded_flow_ids).toEqual([oldFlowId]);
    const oldFlow = await rawPrisma.passwordResetToken.findUniqueOrThrow({
      where: { id: oldFlowId },
      include: { recovery: true },
    });
    expect(oldFlow.usedAt).not.toBeNull();
    expect(oldFlow.recovery).toMatchObject({
      cipherVersion: null,
      keyId: null,
      nonce: null,
      ciphertext: null,
      authTag: null,
      enqueueStatus: 'SUPERSEDED',
    });
    expect(oldFlow.recovery?.wipedAt).not.toBeNull();
  });

  it('allows an active administrator to prepare and issue only for one active organization', async () => {
    const [actor, target] = await Promise.all([
      createUser({
        label: 'admin-actor',
        memberships: [{ organizationId: organizationAId, role: UserRole.ADMIN }],
      }),
      createUser({
        label: 'admin-target',
        memberships: [{ organizationId: organizationAId }],
      }),
    ]);
    const session = await createActorSession(actor.id, organizationAId);
    await expect(prepareAdminRecipient(session.token, target.id)).resolves.toEqual([
      { authorization_proven: true, recipient_email: target.email },
    ]);
    const flowId = `admin-flow-${suffix}`;
    await expect(
      issueAdmin({
        actorToken: session.token,
        targetUserId: target.id,
        expectedEmail: target.email,
        flowId,
        storedToken: lookup('admin-flow'),
      })
    ).resolves.toEqual([
      {
        authorization_proven: true,
        flow_id: flowId,
        audit_organization_ids: [organizationAId],
        superseded_flow_ids: [],
        superseded_request_ids: [],
      },
    ]);
  });

  it('denies viewers, wrong-organization targets, and targets with any second membership', async () => {
    const [viewer, admin, wrongOrganizationTarget, sharedTarget] = await Promise.all([
      createUser({
        label: 'viewer-actor',
        memberships: [{ organizationId: organizationAId, role: UserRole.VIEWER }],
      }),
      createUser({
        label: 'denial-admin',
        memberships: [{ organizationId: organizationAId, role: UserRole.ADMIN }],
      }),
      createUser({
        label: 'wrong-org-target',
        memberships: [{ organizationId: organizationBId }],
      }),
      createUser({
        label: 'shared-target',
        memberships: [
          { organizationId: organizationAId },
          { organizationId: organizationBId, isActive: false },
        ],
      }),
    ]);
    const [viewerSession, adminSession] = await Promise.all([
      createActorSession(viewer.id, organizationAId),
      createActorSession(admin.id, organizationAId),
    ]);
    await expect(prepareAdminRecipient(viewerSession.token, sharedTarget.id)).resolves.toEqual([]);
    await expect(
      prepareAdminRecipient(adminSession.token, wrongOrganizationTarget.id)
    ).resolves.toEqual([]);
    await expect(prepareAdminRecipient(adminSession.token, sharedTarget.id)).resolves.toEqual([]);
    await expect(
      issueAdmin({
        actorToken: adminSession.token,
        targetUserId: sharedTarget.id,
        expectedEmail: sharedTarget.email,
        flowId: `shared-denied-${suffix}`,
        storedToken: lookup('shared-denied'),
      })
    ).resolves.toEqual([]);
  });

  it('revalidates the exact email under locks and rolls issuance back with its caller transaction', async () => {
    const [actor, target] = await Promise.all([
      createUser({
        label: 'rollback-admin',
        memberships: [{ organizationId: organizationAId, role: UserRole.ADMIN }],
      }),
      createUser({
        label: 'rollback-target',
        memberships: [{ organizationId: organizationAId }],
      }),
    ]);
    const session = await createActorSession(actor.id, organizationAId);
    await expect(
      issueAdmin({
        actorToken: session.token,
        targetUserId: target.id,
        expectedEmail: `stale-${target.email}`,
        flowId: `stale-email-${suffix}`,
        storedToken: lookup('stale-email'),
      })
    ).resolves.toEqual([]);

    const rollbackFlowId = `rollback-flow-${suffix}`;
    await expect(
      rawPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${OWNER_ROLE}`);
        const recovery = envelope();
        await tx.$queryRawUnsafe(
          `SELECT * FROM public.bootstrap_password_reset_issue_admin_single_org_v1(
             $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
             $7::integer, $8::text, $9::bytea, $10::bytea, $11::bytea, $12::text
           )`,
          session.token,
          target.id,
          target.email,
          rollbackFlowId,
          lookup('rollback-flow'),
          `request-${rollbackFlowId}`.slice(0, 100),
          recovery.cipherVersion,
          recovery.keyId,
          recovery.nonce,
          recovery.ciphertext,
          recovery.authTag,
          recovery.recipientFingerprint
        );
        throw new Error('SIMULATED_AUDIT_FAILURE');
      })
    ).rejects.toThrow('SIMULATED_AUDIT_FAILURE');
    await expect(
      rawPrisma.passwordResetToken.count({ where: { id: rollbackFlowId } })
    ).resolves.toBe(0);
  });

  it('denies direct runtime execution and retains zero owner table-level reset writes', async () => {
    await expect(
      runtimePrisma.$queryRawUnsafe(
        `SELECT * FROM public.bootstrap_password_reset_admin_recipient_v1($1::text, $2::text)`,
        token(),
        'target'
      )
    ).rejects.toThrow(/permission denied/i);
    const [privileges] = await rawPrisma.$queryRawUnsafe<
      Array<{
        token_table_write: boolean;
        recovery_table_write: boolean;
        owner_memberships: bigint;
      }>
    >(
      `SELECT
         pg_catalog.has_table_privilege('${OWNER_ROLE}', 'public.password_reset_tokens', 'INSERT, UPDATE, DELETE') AS token_table_write,
         pg_catalog.has_table_privilege('${OWNER_ROLE}', 'public.password_reset_recoveries', 'INSERT, UPDATE, DELETE') AS recovery_table_write,
         (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_auth_members AS membership
           INNER JOIN pg_catalog.pg_roles AS owner ON owner.rolname = '${OWNER_ROLE}'
           WHERE membership.roleid = owner.oid OR membership.member = owner.oid
         ) AS owner_memberships`
    );
    expect(privileges).toEqual({
      token_table_write: false,
      recovery_table_write: false,
      owner_memberships: BigInt(0),
    });
  });
});
