import { describe, expect, it } from 'vitest';

import { isServable, SERVABLE_SCAN_STATUSES, SERVABLE_SCAN_STATUS_FILTER } from './scanGate';

describe('scanGate', () => {
  describe('isServable', () => {
    it.each(['CLEAN', 'SKIPPED'])('returns true for the servable status %s', (status) => {
      expect(isServable(status)).toBe(true);
    });

    it.each(['INFECTED', 'PENDING', 'SCANNING', 'ERROR'])(
      'returns false for the non-servable status %s',
      (status) => {
        expect(isServable(status)).toBe(false);
      }
    );

    it('returns false for null / undefined / empty (fail closed)', () => {
      expect(isServable(null)).toBe(false);
      expect(isServable(undefined)).toBe(false);
      expect(isServable('')).toBe(false);
    });

    it('returns false for an unknown status (fail closed)', () => {
      expect(isServable('DEFINITELY_NOT_A_STATUS')).toBe(false);
    });
  });

  describe('SERVABLE_SCAN_STATUSES', () => {
    it('contains exactly CLEAN and SKIPPED', () => {
      expect([...SERVABLE_SCAN_STATUSES].sort()).toEqual(['CLEAN', 'SKIPPED']);
    });

    it('every listed status is servable, and no non-listed common status is', () => {
      for (const status of SERVABLE_SCAN_STATUSES) {
        expect(isServable(status)).toBe(true);
      }
      for (const status of ['INFECTED', 'PENDING', 'SCANNING', 'ERROR']) {
        expect(SERVABLE_SCAN_STATUSES).not.toContain(status);
      }
    });
  });

  describe('SERVABLE_SCAN_STATUS_FILTER', () => {
    it('is a Prisma `where` fragment matching only the servable statuses', () => {
      expect(SERVABLE_SCAN_STATUS_FILTER).toEqual({
        scanStatus: { in: ['CLEAN', 'SKIPPED'] },
      });
    });

    it('is an array assignable to Prisma `in`', () => {
      expect(Array.isArray(SERVABLE_SCAN_STATUS_FILTER.scanStatus.in)).toBe(true);
    });

    it('cannot be mutated open by an importer (frozen policy)', () => {
      // Pushing a non-servable status must not silently make every shared filter
      // fail open. The array is frozen, so a mutation attempt throws (strict mode)
      // or is a no-op; either way the policy set is unchanged.
      expect(Object.isFrozen(SERVABLE_SCAN_STATUSES)).toBe(true);
      expect(Object.isFrozen(SERVABLE_SCAN_STATUS_FILTER.scanStatus.in)).toBe(true);
      try {
        (SERVABLE_SCAN_STATUSES as string[]).push('INFECTED');
      } catch {
        // frozen array throws in strict mode — expected
      }
      expect(SERVABLE_SCAN_STATUSES).not.toContain('INFECTED');
      expect(isServable('INFECTED')).toBe(false);
    });
  });
});
