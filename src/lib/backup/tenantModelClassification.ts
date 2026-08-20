/**
 * Per-tenant backup — model classification with a FAIL-CLOSED drift guard.
 *
 * The #1 catastrophic risk for a backup tool is a silently-missed table: the
 * manifest looks internally consistent, but restoring a purged org drops data
 * that is gone forever. To make that impossible, EVERY Prisma model must be
 * explicitly classified here. `assertClassificationComplete()` reads the live
 * Prisma DMMF and THROWS if any model is unclassified — so a newly-added model
 * fails the backup loudly instead of being dropped silently.
 *
 * This module is pure (DMMF introspection only) and fully unit-testable without
 * a database.
 */

import { Prisma } from '@prisma/client';

export type ModelKind =
  | 'ROOT' // the Organization row itself
  | 'SHARED' // User — spans orgs; handled via referenced-user collection, never bulk-scoped
  | 'TENANT' // org-scoped by an `organizationId` column
  | 'PARENT_SCOPED' // no organizationId; scoped through a parent FK (e.g. groupId)
  | 'EXCLUDE'; // deliberately NOT backed up (with a reason)

export interface ModelClassification {
  kind: ModelKind;
  /** For PARENT_SCOPED: the FK column that scopes the row to a parent. */
  scopeField?: string;
  /** For PARENT_SCOPED: the classified parent model whose ids bound the scope. */
  parentModel?: string;
  /** For EXCLUDE: why it is intentionally omitted. */
  reason?: string;
}

/**
 * The authoritative classification. Keyed by Prisma model name. Every model in
 * the schema MUST appear here (enforced by assertClassificationComplete()).
 */
export const MODEL_CLASSIFICATION: Record<string, ModelClassification> = {
  // Root + shared identity
  Organization: { kind: 'ROOT' },
  User: { kind: 'SHARED' },

  // Org-scoped tenant data (has organizationId)
  UserOrganization: { kind: 'TENANT' },
  Room: { kind: 'TENANT' },
  Folder: { kind: 'TENANT' },
  Document: { kind: 'TENANT' },
  DocumentVersion: { kind: 'TENANT' },
  FileBlob: { kind: 'TENANT' },
  PreviewAsset: { kind: 'TENANT' },
  ExtractedText: { kind: 'TENANT' },
  SearchIndex: { kind: 'TENANT' },
  Link: { kind: 'TENANT' },
  LinkVisit: { kind: 'TENANT' },
  ViewSession: { kind: 'TENANT' },
  Permission: { kind: 'TENANT' },
  RoleAssignment: { kind: 'TENANT' },
  Group: { kind: 'TENANT' },
  RoomTemplate: { kind: 'TENANT' },
  Event: { kind: 'TENANT' },
  Notification: { kind: 'TENANT' },
  NotificationPreference: { kind: 'TENANT' },
  NotificationTemplate: { kind: 'TENANT' },
  Invitation: { kind: 'TENANT' },
  Question: { kind: 'TENANT' },
  Answer: { kind: 'TENANT' },
  Checklist: { kind: 'TENANT' },
  ChecklistItem: { kind: 'TENANT' },
  CalendarEvent: { kind: 'TENANT' },
  Bookmark: { kind: 'TENANT' },
  AccessRequest: { kind: 'TENANT' },
  Message: { kind: 'TENANT' },
  PageView: { kind: 'TENANT' },
  SignatureRequest: { kind: 'TENANT' },
  Webhook: { kind: 'TENANT' },
  UserDashboardLayout: { kind: 'TENANT' },

  // Parent-scoped (no organizationId column)
  GroupMembership: { kind: 'PARENT_SCOPED', scopeField: 'groupId', parentModel: 'Group' },

  // Deliberately excluded — transient auth/security state. Users re-authenticate;
  // restoring these would resurrect stale/again-usable secrets.
  Session: { kind: 'EXCLUDE', reason: 'ephemeral auth session; users re-login after restore' },
  PasswordResetToken: { kind: 'EXCLUDE', reason: 'transient reset token; short-lived, security' },
  EmailVerificationToken: { kind: 'EXCLUDE', reason: 'transient verification token; security' },
  PasswordResetRecovery: { kind: 'EXCLUDE', reason: 'transient reset-recovery envelope; security' },
  PasswordResetProviderCorrelation: {
    kind: 'EXCLUDE',
    reason: 'transient delivery-correlation registry; not tenant content',
  },
  ProviderEventInbox: {
    kind: 'EXCLUDE',
    reason: 'global provider webhook inbox; not org-scoped tenant data',
  },
};

/**
 * FK-dependency-ordered list of the TENANT + PARENT_SCOPED models for RESTORE
 * (parents before children). Backup can use any order; restore MUST insert in
 * this order. Self-referential Folder is handled with in-table depth ordering at
 * restore time (not solvable by cross-table order alone).
 *
 * Kept in sync with the classification by assertRestoreOrderComplete().
 */
export const RESTORE_ORDER: string[] = [
  'UserOrganization',
  'Group',
  'GroupMembership',
  'RoomTemplate',
  'Room',
  'Folder', // self-referential — depth-order within the table at restore
  'Document',
  'DocumentVersion',
  'FileBlob',
  'PreviewAsset',
  'ExtractedText',
  'SearchIndex',
  'Permission',
  'RoleAssignment',
  'Link',
  'LinkVisit',
  'ViewSession',
  'Question',
  'Answer',
  'Checklist',
  'ChecklistItem',
  'CalendarEvent',
  'Bookmark',
  'AccessRequest',
  'Message',
  'PageView',
  'SignatureRequest',
  'Webhook',
  'Notification',
  'NotificationPreference',
  'NotificationTemplate',
  'UserDashboardLayout',
  'Invitation',
  'Event', // append-only; last
];

export class BackupClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupClassificationError';
  }
}

/** Every Prisma model must be classified. Throws (fail-closed) if any is not. */
export function assertClassificationComplete(): void {
  const modelNames = Prisma.dmmf.datamodel.models.map((m) => m.name);

  const unclassified = modelNames.filter((n) => !(n in MODEL_CLASSIFICATION));
  if (unclassified.length > 0) {
    throw new BackupClassificationError(
      `Unclassified model(s) — refusing to back up (data-loss risk). Classify in ` +
        `tenantModelClassification.ts: ${unclassified.join(', ')}`
    );
  }

  // No stale entries either (a renamed/removed model would mask drift).
  const stale = Object.keys(MODEL_CLASSIFICATION).filter((n) => !modelNames.includes(n));
  if (stale.length > 0) {
    throw new BackupClassificationError(
      `Classification lists model(s) that no longer exist in the schema: ${stale.join(', ')}`
    );
  }

  // A TENANT model must actually carry organizationId; a PARENT_SCOPED must not.
  for (const model of Prisma.dmmf.datamodel.models) {
    const c = MODEL_CLASSIFICATION[model.name]!;
    const hasOrgId = model.fields.some((f) => f.name === 'organizationId');
    if (c.kind === 'TENANT' && !hasOrgId) {
      throw new BackupClassificationError(
        `${model.name} is classified TENANT but has no organizationId column`
      );
    }
    if (c.kind === 'PARENT_SCOPED' && hasOrgId) {
      throw new BackupClassificationError(
        `${model.name} is PARENT_SCOPED but HAS organizationId — classify it TENANT`
      );
    }
    if (c.kind === 'PARENT_SCOPED' && !model.fields.some((f) => f.name === c.scopeField)) {
      throw new BackupClassificationError(
        `${model.name} PARENT_SCOPED scopeField "${c.scopeField}" is not a field on the model`
      );
    }
  }
}

/**
 * Scalar FK columns on a model that reference User — derived from the DMMF
 * relation graph, NOT a name heuristic (so it catches Event.actorId,
 * Permission.grantedById, etc., which don't end in "UserId").
 */
export function userReferenceFields(modelName: string): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) {
    return [];
  }
  const cols = new Set<string>();
  for (const f of model.fields) {
    if (f.kind === 'object' && f.type === 'User' && Array.isArray(f.relationFromFields)) {
      for (const col of f.relationFromFields) {
        cols.add(col);
      }
    }
  }
  return [...cols];
}

/** BigInt-typed field names on a model, from the DMMF. */
export function bigIntFieldNames(modelName: string): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  return (model?.fields ?? []).filter((f) => f.type === 'BigInt').map((f) => f.name);
}

/** The models that must be exported for a tenant (TENANT + PARENT_SCOPED). */
export function backupModelNames(): string[] {
  return Object.entries(MODEL_CLASSIFICATION)
    .filter(([, c]) => c.kind === 'TENANT' || c.kind === 'PARENT_SCOPED')
    .map(([name]) => name);
}

/** RESTORE_ORDER must cover exactly the backup set, each once. Throws otherwise. */
export function assertRestoreOrderComplete(): void {
  const backupSet = new Set(backupModelNames());
  const orderSet = new Set(RESTORE_ORDER);

  if (orderSet.size !== RESTORE_ORDER.length) {
    throw new BackupClassificationError('RESTORE_ORDER contains duplicates');
  }
  const missing = [...backupSet].filter((n) => !orderSet.has(n));
  const extra = RESTORE_ORDER.filter((n) => !backupSet.has(n));
  if (missing.length || extra.length) {
    throw new BackupClassificationError(
      `RESTORE_ORDER drift — missing: [${missing.join(', ')}], extra: [${extra.join(', ')}]`
    );
  }
}
