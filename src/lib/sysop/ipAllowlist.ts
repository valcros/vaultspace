import { db } from '@/lib/db';
import { isIpAllowed, isValidIpOrCidr } from '@/lib/utils/ip';
import { AuthorizationError } from '@/lib/errors';
import { captureSecurityAudit } from '@/lib/audit/securityAudit';

export interface SysopIpAllowlistEntry {
  id: string;
  cidr: string;
  label: string | null;
  enabled: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Service to manage SysOp In-App IP allowlist settings and enforcement.
 */
export class SysopIpAllowlistService {
  /**
   * Check if a given client IP is authorized for SysOp access.
   */
  static async isClientIpAllowed(clientIp: string | null): Promise<{ allowed: boolean; reason?: string }> {
    // Environment bypass emergency override
    if (process.env['SYSOP_IP_ALLOWLIST_BYPASS'] === 'true') {
      return { allowed: true, reason: 'Bypassed via SYSOP_IP_ALLOWLIST_BYPASS env' };
    }

    const settings = await db.sysopSecuritySettings.findUnique({
      where: { id: 'global' },
    });

    if (!settings || !settings.ipAllowlistEnabled) {
      return { allowed: true, reason: 'Allowlist enforcement is disabled' };
    }

    if (!clientIp) {
      return { allowed: false, reason: 'Client IP address is unresolvable' };
    }

    const activeEntries = await db.sysopIpAllowlist.findMany({
      where: { enabled: true },
      select: { cidr: true },
    });

    if (activeEntries.length === 0) {
      return { allowed: true, reason: 'Allowlist is empty' };
    }

    const allowedCidrs = activeEntries.map((e) => e.cidr);
    const allowed = isIpAllowed(clientIp, allowedCidrs);

    return {
      allowed,
      reason: allowed ? 'Client IP matched allowlist' : `IP address ${clientIp} not in SysOp allowlist`,
    };
  }

  /**
   * Enable or disable global IP allowlist enforcement.
   * SELF-LOCKOUT GUARD: Ensures the acting operator's current IP is in the allowlist before enabling.
   */
  static async setEnforcement(
    operatorUserId: string,
    operatorOrgId: string,
    currentClientIp: string | null,
    enabled: boolean
  ): Promise<{ success: boolean; enabled: boolean }> {
    if (enabled) {
      const check = await this.validateOperatorIpAgainstAllowlist(currentClientIp);
      if (!check.valid) {
        throw new AuthorizationError(
          `Lockout prevented: Your current IP address (${currentClientIp ?? 'unknown'}) is not in the allowlist.`
        );
      }
    }

    await db.sysopSecuritySettings.upsert({
      where: { id: 'global' },
      update: { ipAllowlistEnabled: enabled, updatedByUserId: operatorUserId },
      create: { id: 'global', ipAllowlistEnabled: enabled, updatedByUserId: operatorUserId },
    });

    await captureSecurityAudit({
      organizationId: operatorOrgId,
      eventType: 'SYSOP_IP_ALLOWLIST_UPDATED',
      actorType: 'ADMIN',
      actorId: operatorUserId,
      requestId: `sysop_ip_toggle_${Date.now()}`,
      description: `SysOp IP allowlist enforcement ${enabled ? 'ENABLED' : 'DISABLED'}`,
      metadata: { enabled, operatorIp: currentClientIp },
    });

    return { success: true, enabled };
  }

  /**
   * Add a new CIDR entry to the SysOp allowlist.
   */
  static async addEntry(
    operatorUserId: string,
    operatorOrgId: string,
    cidrInput: string,
    label?: string
  ): Promise<SysopIpAllowlistEntry> {
    const cidr = cidrInput.trim();
    if (!isValidIpOrCidr(cidr)) {
      throw new Error('Invalid IP address or CIDR notation (e.g. 203.0.113.45 or 198.51.100.0/24)');
    }

    // Auto-append /32 if single IPv4 provided without prefix
    const normalizedCidr = cidr.includes('/') ? cidr : `${cidr}/32`;

    const entry = await db.sysopIpAllowlist.create({
      data: {
        cidr: normalizedCidr,
        label: label?.trim() || null,
        enabled: true,
        createdByUserId: operatorUserId,
      },
    });

    await captureSecurityAudit({
      organizationId: operatorOrgId,
      eventType: 'SYSOP_IP_ALLOWLIST_UPDATED',
      actorType: 'ADMIN',
      actorId: operatorUserId,
      requestId: `sysop_ip_add_${Date.now()}`,
      description: `Added ${normalizedCidr} to SysOp IP allowlist`,
      metadata: { cidr: normalizedCidr, label },
    });

    return entry;
  }

  /**
   * Delete an entry from the SysOp allowlist.
   * SELF-LOCKOUT GUARD: Prevents deleting the entry that covers the acting operator's current IP if enforcement is enabled.
   */
  static async deleteEntry(
    operatorUserId: string,
    operatorOrgId: string,
    currentClientIp: string | null,
    entryId: string
  ): Promise<void> {
    const settings = await db.sysopSecuritySettings.findUnique({ where: { id: 'global' } });
    if (settings?.ipAllowlistEnabled && currentClientIp) {
      const remainingEntries = await db.sysopIpAllowlist.findMany({
        where: { enabled: true, NOT: { id: entryId } },
        select: { cidr: true },
      });
      const allowed = isIpAllowed(currentClientIp, remainingEntries.map((e) => e.cidr));
      if (!allowed) {
        throw new AuthorizationError(
          `Lockout prevented: Deleting this entry would block your current IP address (${currentClientIp}).`
        );
      }
    }

    const deleted = await db.sysopIpAllowlist.delete({ where: { id: entryId } });

    await captureSecurityAudit({
      organizationId: operatorOrgId,
      eventType: 'SYSOP_IP_ALLOWLIST_UPDATED',
      actorType: 'ADMIN',
      actorId: operatorUserId,
      requestId: `sysop_ip_del_${Date.now()}`,
      description: `Removed ${deleted.cidr} from SysOp IP allowlist`,
      metadata: { cidr: deleted.cidr },
    });
  }

  /**
   * Private helper to check if an operator IP is covered by current active entries.
   */
  private static async validateOperatorIpAgainstAllowlist(
    clientIp: string | null
  ): Promise<{ valid: boolean }> {
    if (!clientIp) {
      return { valid: false };
    }

    const activeEntries = await db.sysopIpAllowlist.findMany({
      where: { enabled: true },
      select: { cidr: true },
    });

    if (activeEntries.length === 0) {
      return { valid: false };
    }

    return { valid: isIpAllowed(clientIp, activeEntries.map((e) => e.cidr)) };
  }
}
