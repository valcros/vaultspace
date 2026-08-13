import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

export const BOOTSTRAP_SESSION_CREATE_FUNCTION =
  'public.bootstrap_session_create_v1(text, text, text, timestamp with time zone, text, text)' as const;
export const BOOTSTRAP_SESSION_REFRESH_FUNCTION =
  'public.bootstrap_session_refresh_v1(text)' as const;
export const BOOTSTRAP_SESSION_INVALIDATE_FUNCTION =
  'public.bootstrap_session_invalidate_v1(text)' as const;
export const BOOTSTRAP_SESSION_REVOKE_USER_ORG_FUNCTION =
  'public.bootstrap_session_revoke_user_org_v1(text, text)' as const;
export const BOOTSTRAP_SESSION_REVOKE_USER_GLOBAL_FUNCTION =
  'public.bootstrap_session_revoke_user_global_v1(text, text)' as const;
export const BOOTSTRAP_SESSION_REVOKE_SELF_OTHERS_FUNCTION =
  'public.bootstrap_session_revoke_self_others_v1(text)' as const;
export const BOOTSTRAP_SESSION_REVOKE_ADMIN_USER_ORG_FUNCTION =
  'public.bootstrap_session_revoke_admin_user_org_v1(text, text)' as const;
export const BOOTSTRAP_SESSION_REVOKE_ADMIN_USER_GLOBAL_SINGLE_ORG_FUNCTION =
  'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)' as const;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

export interface CreateBootstrapSessionInput {
  userId: string;
  organizationId: string;
  token: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreatedBootstrapSession {
  sessionId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface RefreshedBootstrapSession {
  sessionId: string;
  expiresAt: Date;
}

interface CreatedBootstrapSessionRow {
  session_id: string;
  session_created_at: Date | string;
  session_expires_at: Date | string;
}

interface RefreshedBootstrapSessionRow {
  session_id: string;
  session_expires_at: Date | string;
}

interface SessionIdRow {
  session_id: string;
}

interface AuthorizedRevocationRow {
  authorization_proven: boolean;
  session_id: string | null;
}

export interface AuthorizedSessionRevocation {
  sessionIds: string[];
}

export type SessionMutationQueryClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

function validIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

function validToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

function requiredDate(value: Date | string, field: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`BOOTSTRAP_SESSION_MUTATION_${field}_INVALID`);
  }
  return date;
}

function mapSessionId(row: SessionIdRow): string {
  if (!row.session_id || !validIdentifier(row.session_id)) {
    throw new Error('BOOTSTRAP_SESSION_MUTATION_ROW_INVALID');
  }
  return row.session_id;
}

function mapCreatedSession(row: CreatedBootstrapSessionRow): CreatedBootstrapSession {
  return {
    sessionId: mapSessionId(row),
    createdAt: requiredDate(row.session_created_at, 'CREATED_AT'),
    expiresAt: requiredDate(row.session_expires_at, 'EXPIRES_AT'),
  };
}

function mapRefreshedSession(row: RefreshedBootstrapSessionRow): RefreshedBootstrapSession {
  return {
    sessionId: mapSessionId(row),
    expiresAt: requiredDate(row.session_expires_at, 'EXPIRES_AT'),
  };
}

function mapAtMostOne<T>(rows: T[], errorCode: string): T | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw new Error(errorCode);
  }
  return rows[0]!;
}

function mapAuthorizedRevocation(
  rows: AuthorizedRevocationRow[]
): AuthorizedSessionRevocation | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.some((row) => row.authorization_proven !== true)) {
    throw new Error('BOOTSTRAP_SESSION_REVOCATION_AUTHORIZATION_MARKER_INVALID');
  }

  const sentinelRows = rows.filter((row) => row.session_id === null);
  if (sentinelRows.length > 0 && (rows.length !== 1 || sentinelRows.length !== 1)) {
    throw new Error('BOOTSTRAP_SESSION_REVOCATION_SENTINEL_INVALID');
  }

  const sessionIds = rows
    .filter(
      (row): row is AuthorizedRevocationRow & { session_id: string } => row.session_id !== null
    )
    .map((row) => mapSessionId(row));
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new Error('BOOTSTRAP_SESSION_MUTATION_DUPLICATE_SESSION_ID');
  }

  return { sessionIds };
}

export class SessionMutationRepository {
  constructor(private readonly client: SessionMutationQueryClient = db) {}

  async createSession(input: CreateBootstrapSessionInput): Promise<CreatedBootstrapSession | null> {
    if (
      !validIdentifier(input.userId) ||
      !validIdentifier(input.organizationId) ||
      !validToken(input.token) ||
      !(input.expiresAt instanceof Date) ||
      Number.isNaN(input.expiresAt.getTime()) ||
      (input.ipAddress !== null && input.ipAddress !== undefined && input.ipAddress.length > 50) ||
      (input.userAgent !== null && input.userAgent !== undefined && input.userAgent.length > 4096)
    ) {
      return null;
    }

    const rows = await this.client.$queryRaw<CreatedBootstrapSessionRow[]>(
      Prisma.sql`
        SELECT
          session_id,
          session_created_at,
          session_expires_at
        FROM public.bootstrap_session_create_v1(
          ${input.userId}::text,
          ${input.organizationId}::text,
          ${input.token}::text,
          ${input.expiresAt}::timestamptz,
          ${input.ipAddress ?? null}::text,
          ${input.userAgent ?? null}::text
        )
      `
    );

    const row = mapAtMostOne(rows, 'BOOTSTRAP_SESSION_CREATE_DUPLICATE');
    return row ? mapCreatedSession(row) : null;
  }

  async refreshSession(token: string): Promise<RefreshedBootstrapSession | null> {
    if (!validToken(token)) {
      return null;
    }

    const rows = await this.client.$queryRaw<RefreshedBootstrapSessionRow[]>(
      Prisma.sql`
        SELECT
          session_id,
          session_expires_at
        FROM public.bootstrap_session_refresh_v1(${token}::text)
      `
    );

    const row = mapAtMostOne(rows, 'BOOTSTRAP_SESSION_REFRESH_DUPLICATE');
    return row ? mapRefreshedSession(row) : null;
  }

  async invalidateSession(token: string): Promise<string | null> {
    if (!validToken(token)) {
      return null;
    }

    const rows = await this.client.$queryRaw<SessionIdRow[]>(
      Prisma.sql`
        SELECT session_id
        FROM public.bootstrap_session_invalidate_v1(${token}::text)
      `
    );

    const row = mapAtMostOne(rows, 'BOOTSTRAP_SESSION_INVALIDATE_DUPLICATE');
    return row ? mapSessionId(row) : null;
  }

  async revokeSelfOtherSessions(actorToken: string): Promise<AuthorizedSessionRevocation | null> {
    if (!validToken(actorToken)) {
      return null;
    }

    const rows = await this.client.$queryRaw<AuthorizedRevocationRow[]>(
      Prisma.sql`
        SELECT authorization_proven, session_id
        FROM public.bootstrap_session_revoke_self_others_v1(${actorToken}::text)
      `
    );

    return mapAuthorizedRevocation(rows);
  }

  async revokeAdminUserOrganizationSessions(
    actorToken: string,
    targetUserId: string
  ): Promise<AuthorizedSessionRevocation | null> {
    if (!validToken(actorToken) || !validIdentifier(targetUserId)) {
      return null;
    }

    const rows = await this.client.$queryRaw<AuthorizedRevocationRow[]>(
      Prisma.sql`
        SELECT authorization_proven, session_id
        FROM public.bootstrap_session_revoke_admin_user_org_v1(
          ${actorToken}::text,
          ${targetUserId}::text
        )
      `
    );

    return mapAuthorizedRevocation(rows);
  }

  async revokeAdminUserGlobalSingleOrganizationSessions(
    actorToken: string,
    targetUserId: string
  ): Promise<AuthorizedSessionRevocation | null> {
    if (!validToken(actorToken) || !validIdentifier(targetUserId)) {
      return null;
    }

    const rows = await this.client.$queryRaw<AuthorizedRevocationRow[]>(
      Prisma.sql`
        SELECT authorization_proven, session_id
        FROM public.bootstrap_session_revoke_admin_user_global_single_org_v1(
          ${actorToken}::text,
          ${targetUserId}::text
        )
      `
    );

    return mapAuthorizedRevocation(rows);
  }
}

export const sessionMutationRepository = new SessionMutationRepository();
