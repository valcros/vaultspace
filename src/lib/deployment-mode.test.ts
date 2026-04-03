/**
 * Deployment Mode Tests
 *
 * Tests for deployment mode detection and helpers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Store original env
const originalEnv = process.env;

describe('deployment-mode', () => {
  beforeEach(() => {
    // Reset modules to clear cached values
    vi.resetModules();
    // Create a fresh copy of env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getDeploymentMode', () => {
    it('returns azure by default when DEPLOYMENT_MODE is not set', async () => {
      delete process.env['DEPLOYMENT_MODE'];
      const { getDeploymentMode } = await import('./deployment-mode');
      expect(getDeploymentMode()).toBe('azure');
    });

    it('returns azure when DEPLOYMENT_MODE=azure', async () => {
      process.env['DEPLOYMENT_MODE'] = 'azure';
      const { getDeploymentMode } = await import('./deployment-mode');
      expect(getDeploymentMode()).toBe('azure');
    });

    it('returns standalone when DEPLOYMENT_MODE=standalone', async () => {
      process.env['DEPLOYMENT_MODE'] = 'standalone';
      const { getDeploymentMode } = await import('./deployment-mode');
      expect(getDeploymentMode()).toBe('standalone');
    });

    it('is case-insensitive', async () => {
      process.env['DEPLOYMENT_MODE'] = 'STANDALONE';
      const { getDeploymentMode } = await import('./deployment-mode');
      expect(getDeploymentMode()).toBe('standalone');
    });

    it('returns azure for invalid values', async () => {
      process.env['DEPLOYMENT_MODE'] = 'invalid';
      const { getDeploymentMode } = await import('./deployment-mode');
      expect(getDeploymentMode()).toBe('azure');
    });

    it('handles whitespace as invalid (returns default azure)', async () => {
      // Whitespace is not trimmed - '  standalone  ' is not equal to 'standalone'
      process.env['DEPLOYMENT_MODE'] = '  standalone  ';
      const { getDeploymentMode } = await import('./deployment-mode');
      expect(getDeploymentMode()).toBe('azure');
    });
  });

  describe('isAzureMode', () => {
    it('returns true when mode is azure', async () => {
      process.env['DEPLOYMENT_MODE'] = 'azure';
      const { isAzureMode } = await import('./deployment-mode');
      expect(isAzureMode()).toBe(true);
    });

    it('returns true by default', async () => {
      delete process.env['DEPLOYMENT_MODE'];
      const { isAzureMode } = await import('./deployment-mode');
      expect(isAzureMode()).toBe(true);
    });

    it('returns false when mode is standalone', async () => {
      process.env['DEPLOYMENT_MODE'] = 'standalone';
      const { isAzureMode } = await import('./deployment-mode');
      expect(isAzureMode()).toBe(false);
    });
  });

  describe('isStandaloneMode', () => {
    it('returns true when mode is standalone', async () => {
      process.env['DEPLOYMENT_MODE'] = 'standalone';
      const { isStandaloneMode } = await import('./deployment-mode');
      expect(isStandaloneMode()).toBe(true);
    });

    it('returns false by default', async () => {
      delete process.env['DEPLOYMENT_MODE'];
      const { isStandaloneMode } = await import('./deployment-mode');
      expect(isStandaloneMode()).toBe(false);
    });

    it('returns false when mode is azure', async () => {
      process.env['DEPLOYMENT_MODE'] = 'azure';
      const { isStandaloneMode } = await import('./deployment-mode');
      expect(isStandaloneMode()).toBe(false);
    });
  });
});
