import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

export const BOOTSTRAP_PASSWORD_RESET_ISSUE_ANONYMOUS_FUNCTION =
  'public.bootstrap_password_reset_issue_anonymous_v1(text, text, text, text, text, integer, text, bytea, bytea, bytea, text)' as const;
export const BOOTSTRAP_PASSWORD_RESET_ADMIN_RECIPIENT_FUNCTION =
  'public.bootstrap_password_reset_admin_recipient_v1(text, text)' as const;
export const BOOTSTRAP_PASSWORD_RESET_ISSUE_ADMIN_SINGLE_ORG_FUNCTION =
  'public.bootstrap_password_reset_issue_admin_single_org_v1(text, text, text, text, text, text, integer, text, bytea, bytea, bytea, text)' as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const STORED_LOOKUP_PATTERN = /^prh1:[a-f0-9]{64}$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,100}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

interface IssueRow {
  authorization_proven: boolean;
  flow_id: string;
  audit_organization_ids: string[];
  superseded_flow_ids: string[];
  superseded_request_ids: Array<string | null>;
}

interface AdminRecipientRow {
  authorization_proven: boolean;
  recipient_email: string;
}

export interface PasswordResetIssuanceEnvelopeV2 {
  cipherVersion: 2;
  keyId: string;
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
  recipientFingerprint: string;
}

export interface AnonymousPasswordResetIssueInput {
  normalizedEmail: string;
  requestedSenderOrgSlug: string | null;
  flowId: string;
  storedToken: string;
  requestId: string;
  envelope: PasswordResetIssuanceEnvelopeV2;
}

export interface AdminPasswordResetIssueInput {
  actorToken: string;
  targetUserId: string;
  expectedNormalizedEmail: string;
  flowId: string;
  storedToken: string;
  requestId: string;
  envelope: PasswordResetIssuanceEnvelopeV2;
}

export interface PasswordResetIssuance {
  flowId: string;
  auditOrganizationIds: string[];
  supersededFlows: Array<{ flowId: string; requestId: string | null }>;
}

export interface PasswordResetAdminRecipient {
  recipientEmail: string;
}

export type PasswordResetIssuanceCapabilityQueryClient = Pick<
  Prisma.TransactionClient,
  '$queryRaw'
>;

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

function canonicalUniqueIdentifiers(values: unknown, allowEmpty: boolean): values is string[] {
  return (
    Array.isArray(values) &&
    (allowEmpty || values.length > 0) &&
    values.every(validIdentifier) &&
    new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || values[index - 1]! < value)
  );
}

function validEnvelope(envelope: PasswordResetIssuanceEnvelopeV2): boolean {
  return (
    envelope.cipherVersion === 2 &&
    KEY_ID_PATTERN.test(envelope.keyId) &&
    Buffer.isBuffer(envelope.nonce) &&
    envelope.nonce.length === 12 &&
    Buffer.isBuffer(envelope.ciphertext) &&
    envelope.ciphertext.length >= 48 &&
    envelope.ciphertext.length <= 128 &&
    Buffer.isBuffer(envelope.authTag) &&
    envelope.authTag.length === 16 &&
    FINGERPRINT_PATTERN.test(envelope.recipientFingerprint)
  );
}

function validNormalizedEmail(value: string): boolean {
  return value.length <= 255 && value === value.trim().toLowerCase() && EMAIL_PATTERN.test(value);
}

function validIssueCore(input: {
  flowId: string;
  storedToken: string;
  requestId: string;
  envelope: PasswordResetIssuanceEnvelopeV2;
}): boolean {
  return (
    validIdentifier(input.flowId) &&
    STORED_LOOKUP_PATTERN.test(input.storedToken) &&
    REQUEST_ID_PATTERN.test(input.requestId) &&
    validEnvelope(input.envelope)
  );
}

function mapIssue(rows: IssueRow[], admin: boolean): PasswordResetIssuance | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw new Error('BOOTSTRAP_PASSWORD_RESET_ISSUANCE_DUPLICATE');
  }

  const row = rows[0]!;
  const expectedKeys = [
    'audit_organization_ids',
    'authorization_proven',
    'flow_id',
    'superseded_flow_ids',
    'superseded_request_ids',
  ] as const;
  if (
    !exactKeys(row, expectedKeys) ||
    row.authorization_proven !== true ||
    !validIdentifier(row.flow_id) ||
    !canonicalUniqueIdentifiers(row.audit_organization_ids, false) ||
    row.audit_organization_ids.length > 64 ||
    (admin && row.audit_organization_ids.length !== 1) ||
    !canonicalUniqueIdentifiers(row.superseded_flow_ids, true) ||
    row.superseded_flow_ids.includes(row.flow_id) ||
    !Array.isArray(row.superseded_request_ids) ||
    row.superseded_request_ids.length !== row.superseded_flow_ids.length ||
    !row.superseded_request_ids.every(validRequestId)
  ) {
    throw new Error('BOOTSTRAP_PASSWORD_RESET_ISSUANCE_ENVELOPE_INVALID');
  }

  return {
    flowId: row.flow_id,
    auditOrganizationIds: row.audit_organization_ids,
    supersededFlows: row.superseded_flow_ids.map((flowId, index) => ({
      flowId,
      requestId: row.superseded_request_ids[index]!,
    })),
  };
}

function mapAdminRecipient(rows: AdminRecipientRow[]): PasswordResetAdminRecipient | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw new Error('BOOTSTRAP_PASSWORD_RESET_ADMIN_RECIPIENT_DUPLICATE');
  }
  const row = rows[0]!;
  if (
    !exactKeys(row, ['authorization_proven', 'recipient_email']) ||
    row.authorization_proven !== true ||
    typeof row.recipient_email !== 'string' ||
    !validNormalizedEmail(row.recipient_email)
  ) {
    throw new Error('BOOTSTRAP_PASSWORD_RESET_ADMIN_RECIPIENT_ENVELOPE_INVALID');
  }
  return { recipientEmail: row.recipient_email };
}

export class PasswordResetIssuanceCapabilityRepository {
  constructor(private readonly client: PasswordResetIssuanceCapabilityQueryClient = db) {}

  async issueAnonymous(
    input: AnonymousPasswordResetIssueInput
  ): Promise<PasswordResetIssuance | null> {
    if (
      !validNormalizedEmail(input.normalizedEmail) ||
      (input.requestedSenderOrgSlug !== null &&
        (input.requestedSenderOrgSlug.length > 100 ||
          !SLUG_PATTERN.test(input.requestedSenderOrgSlug))) ||
      !validIssueCore(input)
    ) {
      return null;
    }

    const rows = await this.client.$queryRaw<IssueRow[]>(Prisma.sql`
      SELECT
        authorization_proven,
        flow_id,
        audit_organization_ids,
        superseded_flow_ids,
        superseded_request_ids
      FROM public.bootstrap_password_reset_issue_anonymous_v1(
        ${input.normalizedEmail}::text,
        ${input.requestedSenderOrgSlug}::text,
        ${input.flowId}::text,
        ${input.storedToken}::text,
        ${input.requestId}::text,
        ${input.envelope.cipherVersion}::integer,
        ${input.envelope.keyId}::text,
        ${input.envelope.nonce}::bytea,
        ${input.envelope.ciphertext}::bytea,
        ${input.envelope.authTag}::bytea,
        ${input.envelope.recipientFingerprint}::text
      )
    `);
    return mapIssue(rows, false);
  }

  async prepareAdminRecipient(
    actorToken: string,
    targetUserId: string
  ): Promise<PasswordResetAdminRecipient | null> {
    if (!SESSION_TOKEN_PATTERN.test(actorToken) || !validIdentifier(targetUserId)) {
      return null;
    }
    const rows = await this.client.$queryRaw<AdminRecipientRow[]>(Prisma.sql`
      SELECT authorization_proven, recipient_email
      FROM public.bootstrap_password_reset_admin_recipient_v1(
        ${actorToken}::text,
        ${targetUserId}::text
      )
    `);
    return mapAdminRecipient(rows);
  }

  async issueAdminSingleOrg(
    input: AdminPasswordResetIssueInput
  ): Promise<PasswordResetIssuance | null> {
    if (
      !SESSION_TOKEN_PATTERN.test(input.actorToken) ||
      !validIdentifier(input.targetUserId) ||
      !validNormalizedEmail(input.expectedNormalizedEmail) ||
      !validIssueCore(input)
    ) {
      return null;
    }

    const rows = await this.client.$queryRaw<IssueRow[]>(Prisma.sql`
      SELECT
        authorization_proven,
        flow_id,
        audit_organization_ids,
        superseded_flow_ids,
        superseded_request_ids
      FROM public.bootstrap_password_reset_issue_admin_single_org_v1(
        ${input.actorToken}::text,
        ${input.targetUserId}::text,
        ${input.expectedNormalizedEmail}::text,
        ${input.flowId}::text,
        ${input.storedToken}::text,
        ${input.requestId}::text,
        ${input.envelope.cipherVersion}::integer,
        ${input.envelope.keyId}::text,
        ${input.envelope.nonce}::bytea,
        ${input.envelope.ciphertext}::bytea,
        ${input.envelope.authTag}::bytea,
        ${input.envelope.recipientFingerprint}::text
      )
    `);
    return mapIssue(rows, true);
  }
}

export const passwordResetIssuanceCapabilityRepository =
  new PasswordResetIssuanceCapabilityRepository();
