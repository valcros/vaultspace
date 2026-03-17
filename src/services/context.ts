/**
 * Service Context Factory
 *
 * Creates service contexts for request handling.
 * Contexts include session, event bus, and provider access.
 */

import { createEventBus } from '@/lib/events/EventBus';
import { getProviders } from '@/providers';

import type { CreateServiceContextOptions, ServiceContext } from './types';

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create a service context from session data
 */
export function createServiceContext(options: CreateServiceContextOptions): ServiceContext {
  const { session, ipAddress, userAgent } = options;
  const requestId = options.requestId ?? generateRequestId();
  const providers = getProviders();

  const eventBus = createEventBus(session.organizationId, {
    requestId,
    actorId: session.userId,
    actorEmail: session.user.email,
    actorType: session.organization.role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
    ipAddress,
    userAgent,
    // Note: sessionId on events references ViewSession (external viewer sessions),
    // not the user's login Session. User actions don't set sessionId.
  });

  return {
    session,
    requestId,
    eventBus,
    providers,
    ipAddress,
    userAgent,
  };
}

/**
 * Create a system service context (for background jobs)
 */
export function createSystemContext(organizationId: string): ServiceContext {
  const requestId = generateRequestId();
  const providers = getProviders();

  const eventBus = createEventBus(organizationId, {
    requestId,
    actorType: 'SYSTEM',
  });

  // System context uses a minimal session
  const session = {
    sessionId: 'system',
    userId: 'system',
    organizationId,
    user: {
      id: 'system',
      email: 'system@vaultspace.local',
      firstName: 'System',
      lastName: 'Process',
      isActive: true,
    },
    organization: {
      id: organizationId,
      name: 'System',
      slug: 'system',
      role: 'ADMIN' as const,
      canManageUsers: true,
      canManageRooms: true,
    },
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    issuedAt: new Date(),
  };

  return {
    session,
    requestId,
    eventBus,
    providers,
  };
}
