import { Prisma, type PrismaClient } from '@prisma/client';

import { db } from '@/lib/db';

export const BOOTSTRAP_LOGIN_CANDIDATE_FUNCTION =
  'public.bootstrap_login_candidate_v1(text)' as const;

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
}

export const bootstrapRepository = new BootstrapRepository();
