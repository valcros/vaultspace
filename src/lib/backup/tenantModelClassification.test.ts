import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

import {
  MODEL_CLASSIFICATION,
  RESTORE_ORDER,
  assertClassificationComplete,
  assertRestoreOrderComplete,
  backupModelNames,
  userReferenceFields,
  bigIntFieldNames,
} from './tenantModelClassification';

describe('tenant model classification (completeness drift guard)', () => {
  it('classifies EVERY Prisma model — no unclassified, no stale (fail-closed)', () => {
    // This is the core completeness guarantee: if a model is added to the schema
    // without being classified here, this throws and the backup refuses to run.
    expect(() => assertClassificationComplete()).not.toThrow();
  });

  it('covers exactly the live DMMF model set', () => {
    const dmmfModels = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
    const classified = new Set(Object.keys(MODEL_CLASSIFICATION));
    expect(classified).toEqual(dmmfModels);
  });

  it('every TENANT model actually has an organizationId column', () => {
    for (const model of Prisma.dmmf.datamodel.models) {
      if (MODEL_CLASSIFICATION[model.name]?.kind === 'TENANT') {
        expect(
          model.fields.some((f) => f.name === 'organizationId'),
          `${model.name} classified TENANT but lacks organizationId`
        ).toBe(true);
      }
    }
  });

  it('every model with organizationId is TENANT (none silently dropped)', () => {
    for (const model of Prisma.dmmf.datamodel.models) {
      const hasOrgId = model.fields.some((f) => f.name === 'organizationId');
      if (hasOrgId) {
        const kind = MODEL_CLASSIFICATION[model.name]?.kind;
        // org-scoped models are either backed up (TENANT) or explicitly EXCLUDE'd
        // with a documented reason (e.g. Session, PasswordResetToken).
        expect(['TENANT', 'EXCLUDE']).toContain(kind);
        if (kind === 'EXCLUDE') {
          expect(MODEL_CLASSIFICATION[model.name]?.reason).toBeTruthy();
        }
      }
    }
  });

  it('every EXCLUDE has a documented reason', () => {
    for (const [name, c] of Object.entries(MODEL_CLASSIFICATION)) {
      if (c.kind === 'EXCLUDE') {
        expect(c.reason, `${name} EXCLUDE without reason`).toBeTruthy();
      }
    }
  });

  it('PARENT_SCOPED models declare a real scopeField and parent', () => {
    for (const [name, c] of Object.entries(MODEL_CLASSIFICATION)) {
      if (c.kind === 'PARENT_SCOPED') {
        expect(c.scopeField, `${name} missing scopeField`).toBeTruthy();
        expect(MODEL_CLASSIFICATION[c.parentModel!], `${name} parent unclassified`).toBeTruthy();
        const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;
        expect(model.fields.some((f) => f.name === c.scopeField)).toBe(true);
      }
    }
  });

  it('RESTORE_ORDER covers exactly the backup set, each once', () => {
    expect(() => assertRestoreOrderComplete()).not.toThrow();
    expect(new Set(RESTORE_ORDER).size).toBe(RESTORE_ORDER.length); // no dupes
    expect(new Set(RESTORE_ORDER)).toEqual(new Set(backupModelNames()));
  });

  it('Event is restored last (append-only)', () => {
    expect(RESTORE_ORDER[RESTORE_ORDER.length - 1]).toBe('Event');
  });

  it('userReferenceFields catches non-*UserId User FKs (e.g. Event.actorId)', () => {
    // The name heuristic (*UserId) would MISS these — the DMMF relation graph does not.
    expect(userReferenceFields('Event')).toContain('actorId');
    expect(userReferenceFields('UserOrganization')).toContain('userId');
  });

  it('every backup model with a User relation exposes its FK columns', () => {
    // Sanity: models that FK to User must yield at least one column so referenced
    // users are collected (else restore hits a dangling non-nullable FK).
    for (const name of backupModelNames()) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;
      const hasUserRelation = model.fields.some(
        (f) => f.kind === 'object' && f.type === 'User' && (f.relationFromFields?.length ?? 0) > 0
      );
      if (hasUserRelation) {
        expect(userReferenceFields(name).length).toBeGreaterThan(0);
      }
    }
  });

  it('bigIntFieldNames reports BigInt columns (e.g. Organization.maxStorageBytes)', () => {
    expect(bigIntFieldNames('Organization')).toContain('maxStorageBytes');
  });

  it('backup set excludes Session and the transient token tables', () => {
    const set = new Set(backupModelNames());
    expect(set.has('Session')).toBe(false);
    expect(set.has('PasswordResetToken')).toBe(false);
    expect(set.has('EmailVerificationToken')).toBe(false);
    // and it includes the tables the hand-lists missed:
    for (const t of [
      'Question',
      'Answer',
      'Message',
      'Webhook',
      'AccessRequest',
      'GroupMembership',
    ]) {
      expect(set.has(t), `backup set missing ${t}`).toBe(true);
    }
  });
});
