/**
 * Service Layer Types
 *
 * Core types for the service layer following the CoreService pattern.
 * All business logic flows through services, which emit events for mutations.
 */

import type { EventBus } from '@/lib/events/EventBus';
import type { Providers } from '@/providers';
import type { SessionData } from '@/lib/auth';

/**
 * Context passed to all service methods
 */
export interface ServiceContext {
  /** Current session/user context */
  session: SessionData;
  /** Request ID for tracing */
  requestId: string;
  /** EventBus for emitting audit events */
  eventBus: EventBus;
  /** Provider instances */
  providers: Providers;
  /** Client IP address */
  ipAddress?: string;
  /** User agent string */
  userAgent?: string;
}

/**
 * Options for creating a service context
 */
export interface CreateServiceContextOptions {
  session: SessionData;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Pagination options for list operations
 */
export interface PaginationOptions {
  /** Number of items to skip */
  offset?: number;
  /** Maximum number of items to return */
  limit?: number;
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Sort options for list operations
 */
export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * Common filter options
 */
export interface FilterOptions {
  search?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  updatedAfter?: Date;
  updatedBefore?: Date;
}
