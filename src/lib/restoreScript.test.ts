import { describe, expect, it } from 'vitest';

import {
  DESTRUCTIVE_RESET_ACKNOWLEDGEMENT,
  getEventResetPlan,
  parseArgs,
  RestoreUsageError,
} from '../../scripts/restore';

describe('restore script safety helpers', () => {
  describe('parseArgs', () => {
    it('keeps --force limited to skipping the general confirmation prompt', () => {
      const options = parseArgs(['/tmp/backup', '--force']);

      expect(options).toEqual({
        backupDir: '/tmp/backup',
        dryRun: false,
        force: true,
        allowDestructiveReset: false,
      });
    });

    it('parses destructive reset as a separate explicit flag and acknowledgement', () => {
      const options = parseArgs([
        '/tmp/backup',
        '--dry-run',
        '--allow-destructive-reset',
        '--acknowledge-destructive-reset',
        DESTRUCTIVE_RESET_ACKNOWLEDGEMENT,
      ]);

      expect(options).toEqual({
        backupDir: '/tmp/backup',
        dryRun: true,
        force: false,
        allowDestructiveReset: true,
        destructiveResetAcknowledgement: DESTRUCTIVE_RESET_ACKNOWLEDGEMENT,
      });
    });

    it('rejects unknown options', () => {
      expect(() => parseArgs(['/tmp/backup', '--force-events'])).toThrow(RestoreUsageError);
    });
  });

  describe('getEventResetPlan', () => {
    it('uses the normal delete path when no audit events exist', () => {
      expect(
        getEventResetPlan(0, {
          dryRun: false,
          allowDestructiveReset: false,
        })
      ).toEqual({
        canProceed: true,
        mode: 'delete-many',
        warnings: [],
      });
    });

    it('blocks a live restore when immutable audit events already exist by default', () => {
      const plan = getEventResetPlan(3, {
        dryRun: false,
        allowDestructiveReset: false,
      });

      expect(plan.canProceed).toBe(false);
      expect(plan.mode).toBe('none');
      expect(plan.message).toContain('Restore target already contains 3 immutable audit event(s)');
      expect(plan.message).toContain('--allow-destructive-reset');
    });

    it('allows dry-run to report existing immutable audit events without clearing data', () => {
      const plan = getEventResetPlan(2, {
        dryRun: true,
        allowDestructiveReset: false,
      });

      expect(plan.canProceed).toBe(true);
      expect(plan.mode).toBe('none');
      expect(plan.warnings[0]).toContain('A live restore without --allow-destructive-reset');
    });

    it('requires explicit acknowledgement before destructive disposable reset proceeds', () => {
      const plan = getEventResetPlan(1, {
        dryRun: false,
        allowDestructiveReset: true,
      });

      expect(plan.canProceed).toBe(false);
      expect(plan.message).toContain('--acknowledge-destructive-reset');
      expect(plan.message).toContain(DESTRUCTIVE_RESET_ACKNOWLEDGEMENT);
    });

    it('uses TRUNCATE only after destructive disposable reset is acknowledged', () => {
      const plan = getEventResetPlan(1, {
        dryRun: false,
        allowDestructiveReset: true,
        destructiveResetAcknowledgement: DESTRUCTIVE_RESET_ACKNOWLEDGEMENT,
      });

      expect(plan.canProceed).toBe(true);
      expect(plan.mode).toBe('truncate');
      expect(plan.warnings[0]).toContain('without disabling or dropping the immutability trigger');
    });
  });
});
