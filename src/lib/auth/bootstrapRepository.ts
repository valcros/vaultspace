import { Prisma, type PrismaClient } from '@prisma/client';

import { db } from '@/lib/db';

export const BOOTSTRAP_LOGIN_CANDIDATE_FUNCTION =
  'public.bootstrap_login_candidate_v1(text)' as const;
export const BOOTSTRAP_SESSION_RESOLVE_FUNCTION =
  'public.bootstrap_session_resolve_v1(text)' as const;
export const BOOTSTRAP_ORGANIZATION_RESOLVE_FUNCTION =
  'public.bootstrap_organization_resolve_v1(text, text)' as const;

export type BootstrapOrganizationRole = 'ADMIN' | 'VIEWER';

export interface BootstrapLoginCandidate {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  userIsActive: boolean;
  twoFactorEnabled: boolean;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationRole: BootstrapOrganizationRole;
}

export interface BootstrapSessionProjection {
  sessionId: string;
  userId: string;
  organizationId: string;
  createdAt: Date;
  expiresAt: Date;
  lastActiveAt: Date;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: true;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    role: BootstrapOrganizationRole;
    canManageUsers: boolean;
    canManageRooms: boolean;
  };
}

export interface BootstrapOrganizationProjection {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  logoUrl: string | null;
  primaryColor: string;
  faviconUrl: string | null;
}

interface BootstrapLoginCandidateRow {
  user_id: string;
  normalized_email: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  user_is_active: boolean;
  two_factor_enabled: boolean;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_role: string;
}

interface BootstrapSessionProjectionRow {
  session_id: string;
  user_id: string;
  organization_id: string;
  session_created_at: Date | string;
  session_expires_at: Date | string;
  session_last_active_at: Date | string;
  user_email: string;
  user_first_name: string;
  user_last_name: string;
  user_is_active: boolean;
  organization_name: string;
  organization_slug: string;
  organization_role: string;
  can_manage_users: boolean;
  can_manage_rooms: boolean;
}

interface BootstrapOrganizationProjectionRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_custom_domain: string | null;
  organization_logo_url: string | null;
  organization_primary_color: string;
  organization_favicon_url: string | null;
}

export type BootstrapQueryClient = Pick<PrismaClient, '$queryRaw'>;

function isOrganizationRole(value: string): value is BootstrapOrganizationRole {
  return value === 'ADMIN' || value === 'VIEWER';
}

function mapLoginCandidate(row: BootstrapLoginCandidateRow): BootstrapLoginCandidate {
  if (
    !row.user_id ||
    !row.normalized_email ||
    !row.first_name ||
    !row.last_name ||
    !row.password_hash ||
    row.user_is_active !== true ||
    typeof row.two_factor_enabled !== 'boolean' ||
    !row.organization_id ||
    !row.organization_name ||
    !row.organization_slug
  ) {
    throw new Error('BOOTSTRAP_LOGIN_CANDIDATE_ROW_INVALID');
  }

  if (!isOrganizationRole(row.organization_role)) {
    throw new Error('BOOTSTRAP_LOGIN_CANDIDATE_ROLE_INVALID');
  }

  return {
    userId: row.user_id,
    email: row.normalized_email,
    firstName: row.first_name,
    lastName: row.last_name,
    passwordHash: row.password_hash,
    userIsActive: row.user_is_active,
    twoFactorEnabled: row.two_factor_enabled,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    organizationRole: row.organization_role,
  };
}

function requiredDate(value: Date | string, field: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`BOOTSTRAP_SESSION_${field}_INVALID`);
  }
  return date;
}

function mapSessionProjection(row: BootstrapSessionProjectionRow): BootstrapSessionProjection {
  if (
    !row.session_id ||
    !row.user_id ||
    !row.organization_id ||
    !row.user_email ||
    !row.user_first_name ||
    !row.user_last_name ||
    row.user_is_active !== true ||
    !row.organization_name ||
    !row.organization_slug ||
    typeof row.can_manage_users !== 'boolean' ||
    typeof row.can_manage_rooms !== 'boolean'
  ) {
    throw new Error('BOOTSTRAP_SESSION_ROW_INVALID');
  }

  if (!isOrganizationRole(row.organization_role)) {
    throw new Error('BOOTSTRAP_SESSION_ROLE_INVALID');
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    organizationId: row.organization_id,
    createdAt: requiredDate(row.session_created_at, 'CREATED_AT'),
    expiresAt: requiredDate(row.session_expires_at, 'EXPIRES_AT'),
    lastActiveAt: requiredDate(row.session_last_active_at, 'LAST_ACTIVE_AT'),
    user: {
      id: row.user_id,
      email: row.user_email,
      firstName: row.user_first_name,
      lastName: row.user_last_name,
      isActive: true,
    },
    organization: {
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
      role: row.organization_role,
      canManageUsers: row.can_manage_users,
      canManageRooms: row.can_manage_rooms,
    },
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function normalizeOrganizationSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 1 || normalized.length > 100 || !/^[a-z0-9-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeCustomDomain(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 1 || normalized.length > 255) {
    return null;
  }

  const labels = normalized.split('.');
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) {
    return null;
  }

  return normalized;
}

function mapOrganizationProjection(
  row: BootstrapOrganizationProjectionRow
): BootstrapOrganizationProjection {
  if (
    !row.organization_id ||
    !row.organization_name ||
    normalizeOrganizationSlug(row.organization_slug) !== row.organization_slug ||
    !isNullableString(row.organization_custom_domain) ||
    (row.organization_custom_domain !== null &&
      normalizeCustomDomain(row.organization_custom_domain) !== row.organization_custom_domain) ||
    !isNullableString(row.organization_logo_url) ||
    !/^#[0-9a-fA-F]{6}$/.test(row.organization_primary_color) ||
    !isNullableString(row.organization_favicon_url)
  ) {
    throw new Error('BOOTSTRAP_ORGANIZATION_ROW_INVALID');
  }

  return {
    id: row.organization_id,
    name: row.organization_name,
    slug: row.organization_slug,
    customDomain: row.organization_custom_domain,
    logoUrl: row.organization_logo_url,
    primaryColor: row.organization_primary_color,
    faviconUrl: row.organization_favicon_url,
  };
}

export class BootstrapRepository {
  constructor(private readonly client: BootstrapQueryClient = db) {}

  async findLoginCandidate(email: string): Promise<BootstrapLoginCandidate | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail.length < 3 || normalizedEmail.length > 255) {
      return null;
    }

    const rows = await this.client.$queryRaw<BootstrapLoginCandidateRow[]>(
      Prisma.sql`
        SELECT
          user_id,
          normalized_email,
          first_name,
          last_name,
          password_hash,
          user_is_active,
          two_factor_enabled,
          organization_id,
          organization_name,
          organization_slug,
          organization_role
        FROM public.bootstrap_login_candidate_v1(${normalizedEmail}::text)
      `
    );

    if (rows.length === 0) {
      return null;
    }
    if (rows.length !== 1) {
      throw new Error('BOOTSTRAP_LOGIN_CANDIDATE_DUPLICATE');
    }

    return mapLoginCandidate(rows[0]!);
  }

  async resolveSession(token: string): Promise<BootstrapSessionProjection | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return null;
    }

    const rows = await this.client.$queryRaw<BootstrapSessionProjectionRow[]>(
      Prisma.sql`
        SELECT
          session_id,
          user_id,
          organization_id,
          session_created_at,
          session_expires_at,
          session_last_active_at,
          user_email,
          user_first_name,
          user_last_name,
          user_is_active,
          organization_name,
          organization_slug,
          organization_role,
          can_manage_users,
          can_manage_rooms
        FROM public.bootstrap_session_resolve_v1(${token}::text)
      `
    );

    if (rows.length === 0) {
      return null;
    }
    if (rows.length !== 1) {
      throw new Error('BOOTSTRAP_SESSION_DUPLICATE');
    }

    return mapSessionProjection(rows[0]!);
  }

  async resolveOrganizationBySlug(slug: string): Promise<BootstrapOrganizationProjection | null> {
    const normalized = normalizeOrganizationSlug(slug);
    if (!normalized) {
      return null;
    }
    return this.resolveOrganization('SLUG', normalized);
  }

  async resolveOrganizationByCustomDomain(
    customDomain: string
  ): Promise<BootstrapOrganizationProjection | null> {
    const normalized = normalizeCustomDomain(customDomain);
    if (!normalized) {
      return null;
    }
    return this.resolveOrganization('CUSTOM_DOMAIN', normalized);
  }

  private async resolveOrganization(
    lookupKind: 'SLUG' | 'CUSTOM_DOMAIN',
    lookupValue: string
  ): Promise<BootstrapOrganizationProjection | null> {
    const rows = await this.client.$queryRaw<BootstrapOrganizationProjectionRow[]>(
      Prisma.sql`
        SELECT
          organization_id,
          organization_name,
          organization_slug,
          organization_custom_domain,
          organization_logo_url,
          organization_primary_color,
          organization_favicon_url
        FROM public.bootstrap_organization_resolve_v1(
          ${lookupKind}::text,
          ${lookupValue}::text
        )
      `
    );

    if (rows.length === 0) {
      return null;
    }
    if (rows.length !== 1) {
      throw new Error('BOOTSTRAP_ORGANIZATION_DUPLICATE');
    }

    return mapOrganizationProjection(rows[0]!);
  }
}

export const bootstrapRepository = new BootstrapRepository();
