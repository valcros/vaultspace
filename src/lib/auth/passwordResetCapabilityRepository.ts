import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

export const BOOTSTRAP_PASSWORD_RESET_CANDIDATE_FUNCTION =
  'public.bootstrap_password_reset_candidate_v1(text)' as const;
export const BOOTSTRAP_PASSWORD_RESET_REDEEM_FUNCTION =
  'public.bootstrap_password_reset_redeem_v1(text, text)' as const;

const CURRENT_STORED_LOOKUP_PATTERN = /^prh1:[a-f0-9]{64}$/;
const LEGACY_STORED_LOOKUP_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BCRYPT_COST_12_PATTERN = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const REQUEST_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,100}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const ACTOR_TYPES = new Set(['ADMIN', 'VIEWER'] as const);

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

export interface PasswordResetRedemption {
  flowId: string;
  subjectUserId: string;
  subjectEmail: string;
  initiationRequestId: string | null;
  auditOrganizations: Array<{
    organizationId: string;
    actorType: 'ADMIN' | 'VIEWER';
  }>;
  supersededFlows: Array<{
    flowId: string;
    requestId: string | null;
  }>;
  revokedSessionIds: string[];
}

export type PasswordResetCapabilityQueryClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

function isStoredLookup(value: string): boolean {
  return CURRENT_STORED_LOOKUP_PATTERN.test(value) || LEGACY_STORED_LOOKUP_PATTERN.test(value);
}

function exactKeys(row: object, expected: readonly string[]): boolean {
  const actual = Object.keys(row).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function validRequestId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && REQUEST_ID_PATTERN.test(value));
}

function isCanonicalUniqueIdentifiers(values: unknown, allowEmpty: boolean): values is string[] {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    return false;
  }
  if (!values.every(validIdentifier) || new Set(values).size !== values.length) {
    return false;
  }
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function mapCandidate(rows: CandidateRow[]): boolean {
  if (rows.length === 0) {
    return false;
  }
  if (
    rows.length !== 1 ||
    !exactKeys(rows[0]!, ['candidate_proven']) ||
    rows[0]!.candidate_proven !== true
  ) {
    throw new Error('BOOTSTRAP_PASSWORD_RESET_CANDIDATE_ENVELOPE_INVALID');
  }
  return true;
}

function mapRedemption(rows: RedemptionRow[]): PasswordResetRedemption | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw new Error('BOOTSTRAP_PASSWORD_RESET_REDEMPTION_DUPLICATE');
  }

  const row = rows[0]!;
  const expectedKeys = [
    'audit_actor_types',
    'audit_organization_ids',
    'authorization_proven',
    'flow_id',
    'initiation_request_id',
    'revoked_session_ids',
    'subject_email',
    'subject_user_id',
    'superseded_flow_ids',
    'superseded_request_ids',
  ] as const;

  if (
    !exactKeys(row, expectedKeys) ||
    row.authorization_proven !== true ||
    !validIdentifier(row.flow_id) ||
    !validIdentifier(row.subject_user_id) ||
    typeof row.subject_email !== 'string' ||
    row.subject_email.length > 255 ||
    !EMAIL_PATTERN.test(row.subject_email) ||
    !validRequestId(row.initiation_request_id) ||
    !isCanonicalUniqueIdentifiers(row.audit_organization_ids, false) ||
    row.audit_organization_ids.length > 64 ||
    !Array.isArray(row.audit_actor_types) ||
    row.audit_actor_types.length !== row.audit_organization_ids.length ||
    !row.audit_actor_types.every(
      (actorType): actorType is 'ADMIN' | 'VIEWER' =>
        typeof actorType === 'string' && ACTOR_TYPES.has(actorType as 'ADMIN' | 'VIEWER')
    ) ||
    !isCanonicalUniqueIdentifiers(row.superseded_flow_ids, true) ||
    !Array.isArray(row.superseded_request_ids) ||
    row.superseded_request_ids.length !== row.superseded_flow_ids.length ||
    !row.superseded_request_ids.every(validRequestId) ||
    !isCanonicalUniqueIdentifiers(row.revoked_session_ids, true) ||
    row.superseded_flow_ids.includes(row.flow_id)
  ) {
    throw new Error('BOOTSTRAP_PASSWORD_RESET_REDEMPTION_ENVELOPE_INVALID');
  }

  return {
    flowId: row.flow_id,
    subjectUserId: row.subject_user_id,
    subjectEmail: row.subject_email,
    initiationRequestId: row.initiation_request_id,
    auditOrganizations: row.audit_organization_ids.map((organizationId, index) => ({
      organizationId,
      actorType: row.audit_actor_types[index]! as 'ADMIN' | 'VIEWER',
    })),
    supersededFlows: row.superseded_flow_ids.map((flowId, index) => ({
      flowId,
      requestId: row.superseded_request_ids[index]!,
    })),
    revokedSessionIds: row.revoked_session_ids,
  };
}

export class PasswordResetCapabilityRepository {
  constructor(private readonly client: PasswordResetCapabilityQueryClient = db) {}

  async candidateProven(storedTokenLookup: string): Promise<boolean> {
    if (!isStoredLookup(storedTokenLookup)) {
      return false;
    }

    const rows = await this.client.$queryRaw<CandidateRow[]>(
      Prisma.sql`
        SELECT candidate_proven
        FROM public.bootstrap_password_reset_candidate_v1(${storedTokenLookup}::text)
      `
    );
    return mapCandidate(rows);
  }

  async redeem(
    storedTokenLookup: string,
    passwordHash: string
  ): Promise<PasswordResetRedemption | null> {
    if (!isStoredLookup(storedTokenLookup) || !BCRYPT_COST_12_PATTERN.test(passwordHash)) {
      return null;
    }

    const rows = await this.client.$queryRaw<RedemptionRow[]>(
      Prisma.sql`
        SELECT
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
        FROM public.bootstrap_password_reset_redeem_v1(
          ${storedTokenLookup}::text,
          ${passwordHash}::text
        )
      `
    );
    return mapRedemption(rows);
  }
}

export const passwordResetCapabilityRepository = new PasswordResetCapabilityRepository();
