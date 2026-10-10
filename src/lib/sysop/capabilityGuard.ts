import { randomUUID } from 'node:crypto';
import type { PlatformCapability } from '@prisma/client';

import type { SessionData } from '@/lib/auth';
import { bootstrapDb } from '@/lib/db';
import { AuthorizationError } from '@/lib/errors';
import { getActiveSysopSession } from '@/lib/sysop/platformSession';

export function capabilitiesEnforced(): boolean {
  return process.env['SYSOP_CAPABILITY_ENFORCEMENT_ENABLED'] === 'true';
}

/**
 * Call only after requirePlatformOperator(). Both the active MFA-backed mode
 * and an unrevoked named grant are required when capability rollout is on.
 */
export async function assertPlatformCapability(
  session: SessionData,
  capability: PlatformCapability
): Promise<void> {
  if (!capabilitiesEnforced()) {
    return;
  }

  const [mode, grant] = await Promise.all([
    getActiveSysopSession(session),
    bootstrapDb.platformCapabilityGrant.findFirst({
      where: { userId: session.userId, capability, revokedAt: null },
      select: { id: true },
    }),
  ]);
  if (mode && grant) {
    return;
  }

  await bootstrapDb.platformAuditEvent.create({
    data: {
      action: 'SYSOP_ACTION_DENIED',
      outcome: 'DENIED',
      actorUserId: session.userId,
      requestId: `capability_${randomUUID()}`,
      platformSessionId: mode?.id ?? null,
      reasonCode: mode ? 'CAPABILITY_MISSING' : 'SYSOP_MODE_REQUIRED',
      correlationId: capability,
      changedFields: ['operator.capability'],
    },
  });
  throw new AuthorizationError(mode ? 'Platform capability required' : 'SysOp mode required');
}

/** Layout navigation is advisory; API guards remain authoritative. */
export async function listUsablePlatformCapabilities(
  session: SessionData
): Promise<Set<PlatformCapability>> {
  if (!capabilitiesEnforced()) {
    return new Set([
      'SYSOP_CONSOLE_ACCESS',
      'SYSOP_OVERVIEW_READ',
      'SYSOP_ORGANIZATION_MANAGE',
      'SYSOP_SECURITY_MANAGE',
      'SYSOP_SYSTEM_TEMPLATE_MANAGE',
    ]);
  }
  if (!(await getActiveSysopSession(session))) {
    return new Set();
  }
  const grants = await bootstrapDb.platformCapabilityGrant.findMany({
    where: { userId: session.userId, revokedAt: null },
    select: { capability: true },
  });
  return new Set(grants.map((grant) => grant.capability));
}
