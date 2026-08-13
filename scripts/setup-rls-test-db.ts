/**
 * Prepare a disposable PostgreSQL database for RLS integration tests.
 *
 * This is intentionally guarded so it cannot be pointed at shared Azure,
 * staging, or production databases by accident. CI uses a local Postgres
 * service, runs migrations as the owner/admin role, then runs application
 * queries as a NOBYPASSRLS role.
 */
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import {
  revokeAndVerifyPasswordResetProviderCorrelationAccess,
  revokeAndVerifyProviderInboxAccess,
} from '../src/lib/integrations/providerInboxDatabasePrivileges';

const APP_ROLE = 'vaultspace_app';
const LOGIN_CANDIDATE_FUNCTION = 'public.bootstrap_login_candidate_v1(text)';
const SESSION_RESOLVE_FUNCTION = 'public.bootstrap_session_resolve_v1(text)';
const ORGANIZATION_RESOLVE_FUNCTION = 'public.bootstrap_organization_resolve_v1(text, text)';
const SESSION_CREATE_FUNCTION =
  'public.bootstrap_session_create_v1(text, text, text, timestamp with time zone, text, text)';
const SESSION_REFRESH_FUNCTION = 'public.bootstrap_session_refresh_v1(text)';
const SESSION_INVALIDATE_FUNCTION = 'public.bootstrap_session_invalidate_v1(text)';
const SESSION_REVOKE_USER_ORG_FUNCTION = 'public.bootstrap_session_revoke_user_org_v1(text, text)';
const SESSION_REVOKE_USER_GLOBAL_FUNCTION =
  'public.bootstrap_session_revoke_user_global_v1(text, text)';
const SESSION_REVOKE_SELF_OTHERS_FUNCTION = 'public.bootstrap_session_revoke_self_others_v1(text)';
const SESSION_REVOKE_ADMIN_USER_ORG_FUNCTION =
  'public.bootstrap_session_revoke_admin_user_org_v1(text, text)';
const SESSION_REVOKE_ADMIN_USER_GLOBAL_SINGLE_ORG_FUNCTION =
  'public.bootstrap_session_revoke_admin_user_global_single_org_v1(text, text)';
const PASSWORD_RESET_CANDIDATE_FUNCTION = 'public.bootstrap_password_reset_candidate_v1(text)';
const PASSWORD_RESET_REDEEM_FUNCTION = 'public.bootstrap_password_reset_redeem_v1(text, text)';
const REQUIRED_ALLOW_FLAG = 'true';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for RLS test database setup`);
  }
  return value;
}

function parseDatabaseUrl(name: string): URL {
  const value = requireEnv(name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL`);
  }

  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use the PostgreSQL URL protocol`);
  }

  return parsed;
}

function assertDisposableDatabase(url: URL, name: string) {
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`${name} must point to local disposable PostgreSQL for this setup script`);
  }
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main() {
  if (process.env['ALLOW_RLS_TEST_DB_SETUP'] !== REQUIRED_ALLOW_FLAG) {
    throw new Error('Set ALLOW_RLS_TEST_DB_SETUP=true to run RLS test database setup');
  }

  if (process.env['DEPLOYMENT_MODE'] !== 'standalone') {
    throw new Error('RLS test database setup only supports DEPLOYMENT_MODE=standalone');
  }

  const adminUrl = parseDatabaseUrl('DATABASE_URL_ADMIN');
  const appUrl = parseDatabaseUrl('DATABASE_URL');
  assertDisposableDatabase(adminUrl, 'DATABASE_URL_ADMIN');
  assertDisposableDatabase(appUrl, 'DATABASE_URL');

  const appRolePassword = decodeURIComponent(appUrl.password);
  if (decodeURIComponent(appUrl.username) !== APP_ROLE) {
    throw new Error(`DATABASE_URL must connect as ${APP_ROLE} for RLS integration tests`);
  }
  if (!appRolePassword) {
    throw new Error('DATABASE_URL must include a password for the RLS app role');
  }

  const admin = new PrismaClient({
    datasources: {
      db: {
        url: adminUrl.toString(),
      },
    },
  });

  try {
    await admin.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(APP_ROLE)}) THEN
          CREATE ROLE ${APP_ROLE}
            WITH LOGIN PASSWORD ${sqlLiteral(appRolePassword)}
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
        ELSE
          ALTER ROLE ${APP_ROLE}
            WITH LOGIN PASSWORD ${sqlLiteral(appRolePassword)}
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
        END IF;
      END
      $$;
    `);

    execFileSync(
      'npx',
      [
        'prisma',
        'db',
        'execute',
        '--file',
        'prisma/rls-policies.sql',
        '--schema',
        'prisma/schema.prisma',
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: adminUrl.toString(),
        },
        stdio: 'inherit',
      }
    );

    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE};`);
    await admin.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(`REVOKE UPDATE, DELETE ON events FROM ${APP_ROLE};`);
    await revokeAndVerifyProviderInboxAccess(admin, APP_ROLE);
    await revokeAndVerifyPasswordResetProviderCorrelationAccess(admin, APP_ROLE);
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${LOGIN_CANDIDATE_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${SESSION_RESOLVE_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${ORGANIZATION_RESOLVE_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${SESSION_CREATE_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${SESSION_REFRESH_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${SESSION_INVALIDATE_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${SESSION_REVOKE_SELF_OTHERS_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${SESSION_REVOKE_ADMIN_USER_ORG_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${SESSION_REVOKE_ADMIN_USER_GLOBAL_SINGLE_ORG_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${PASSWORD_RESET_CANDIDATE_FUNCTION} TO ${APP_ROLE};`
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${PASSWORD_RESET_REDEEM_FUNCTION} TO ${APP_ROLE};`
    );

    const [bootstrapGrants] = await admin.$queryRawUnsafe<
      Array<{
        login_execute: boolean;
        session_execute: boolean;
        organization_execute: boolean;
        session_create_execute: boolean;
        session_refresh_execute: boolean;
        session_invalidate_execute: boolean;
        session_revoke_user_org_execute: boolean;
        session_revoke_user_global_execute: boolean;
        session_revoke_self_others_execute: boolean;
        session_revoke_admin_user_org_execute: boolean;
        session_revoke_admin_user_global_single_org_execute: boolean;
        password_reset_candidate_execute: boolean;
        password_reset_redeem_execute: boolean;
        unexpected_login_acl_count: bigint;
        unexpected_session_acl_count: bigint;
        unexpected_organization_acl_count: bigint;
        unexpected_bootstrap_execute_count: bigint;
      }>
    >(
      `SELECT
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${LOGIN_CANDIDATE_FUNCTION}', 'EXECUTE'
         ) AS login_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${SESSION_RESOLVE_FUNCTION}', 'EXECUTE'
         ) AS session_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${ORGANIZATION_RESOLVE_FUNCTION}', 'EXECUTE'
         ) AS organization_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${SESSION_CREATE_FUNCTION}', 'EXECUTE'
         ) AS session_create_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${SESSION_REFRESH_FUNCTION}', 'EXECUTE'
         ) AS session_refresh_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${SESSION_INVALIDATE_FUNCTION}', 'EXECUTE'
         ) AS session_invalidate_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${SESSION_REVOKE_USER_ORG_FUNCTION}', 'EXECUTE'
         ) AS session_revoke_user_org_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${SESSION_REVOKE_USER_GLOBAL_FUNCTION}', 'EXECUTE'
         ) AS session_revoke_user_global_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${SESSION_REVOKE_SELF_OTHERS_FUNCTION}', 'EXECUTE'
         ) AS session_revoke_self_others_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${SESSION_REVOKE_ADMIN_USER_ORG_FUNCTION}', 'EXECUTE'
         ) AS session_revoke_admin_user_org_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${SESSION_REVOKE_ADMIN_USER_GLOBAL_SINGLE_ORG_FUNCTION}', 'EXECUTE'
         ) AS session_revoke_admin_user_global_single_org_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${PASSWORD_RESET_CANDIDATE_FUNCTION}', 'EXECUTE'
         ) AS password_reset_candidate_execute,
         pg_catalog.has_function_privilege(
           '${APP_ROLE}', '${PASSWORD_RESET_REDEEM_FUNCTION}', 'EXECUTE'
         ) AS password_reset_redeem_execute,
         (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_proc AS function
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
           ) AS acl
           WHERE function.oid = pg_catalog.to_regprocedure('${LOGIN_CANDIDATE_FUNCTION}')
             AND acl.privilege_type = 'EXECUTE'
             AND acl.grantee NOT IN (
               function.proowner,
               (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = '${APP_ROLE}')
             )
         ) AS unexpected_login_acl_count,
         (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_proc AS function
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
           ) AS acl
           WHERE function.oid = pg_catalog.to_regprocedure('${SESSION_RESOLVE_FUNCTION}')
             AND acl.privilege_type = 'EXECUTE'
             AND acl.grantee NOT IN (
               function.proowner,
               (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = '${APP_ROLE}')
             )
         ) AS unexpected_session_acl_count,
         (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_proc AS function
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
           ) AS acl
           WHERE function.oid = pg_catalog.to_regprocedure('${ORGANIZATION_RESOLVE_FUNCTION}')
             AND acl.privilege_type = 'EXECUTE'
             AND acl.grantee NOT IN (
               function.proowner,
               (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = '${APP_ROLE}')
             )
         ) AS unexpected_organization_acl_count,
         (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_proc AS function
           INNER JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = function.pronamespace
           WHERE namespace.nspname = 'public'
             AND function.proname LIKE 'bootstrap!_%' ESCAPE '!'
             AND pg_catalog.has_function_privilege(
               '${APP_ROLE}', function.oid, 'EXECUTE'
             )
             AND function.oid NOT IN (
               pg_catalog.to_regprocedure('${LOGIN_CANDIDATE_FUNCTION}'),
               pg_catalog.to_regprocedure('${SESSION_RESOLVE_FUNCTION}'),
               pg_catalog.to_regprocedure('${ORGANIZATION_RESOLVE_FUNCTION}'),
               pg_catalog.to_regprocedure('${SESSION_CREATE_FUNCTION}'),
               pg_catalog.to_regprocedure('${SESSION_REFRESH_FUNCTION}'),
               pg_catalog.to_regprocedure('${SESSION_INVALIDATE_FUNCTION}'),
               pg_catalog.to_regprocedure('${SESSION_REVOKE_SELF_OTHERS_FUNCTION}'),
               pg_catalog.to_regprocedure('${SESSION_REVOKE_ADMIN_USER_ORG_FUNCTION}'),
               pg_catalog.to_regprocedure('${SESSION_REVOKE_ADMIN_USER_GLOBAL_SINGLE_ORG_FUNCTION}'),
               pg_catalog.to_regprocedure('${PASSWORD_RESET_CANDIDATE_FUNCTION}'),
               pg_catalog.to_regprocedure('${PASSWORD_RESET_REDEEM_FUNCTION}')
             )
         ) AS unexpected_bootstrap_execute_count`
    );

    if (
      !bootstrapGrants?.login_execute ||
      !bootstrapGrants.session_execute ||
      !bootstrapGrants.organization_execute ||
      !bootstrapGrants.session_create_execute ||
      !bootstrapGrants.session_refresh_execute ||
      !bootstrapGrants.session_invalidate_execute ||
      bootstrapGrants.session_revoke_user_org_execute ||
      bootstrapGrants.session_revoke_user_global_execute ||
      !bootstrapGrants.session_revoke_self_others_execute ||
      !bootstrapGrants.session_revoke_admin_user_org_execute ||
      !bootstrapGrants.session_revoke_admin_user_global_single_org_execute ||
      !bootstrapGrants.password_reset_candidate_execute ||
      !bootstrapGrants.password_reset_redeem_execute ||
      Number(bootstrapGrants.unexpected_login_acl_count) !== 0 ||
      Number(bootstrapGrants.unexpected_session_acl_count) !== 0 ||
      Number(bootstrapGrants.unexpected_organization_acl_count) !== 0 ||
      Number(bootstrapGrants.unexpected_bootstrap_execute_count) !== 0
    ) {
      throw new Error(
        'runtime bootstrap function grants must match the exact routed resolve, session-mutation, and password-reset redemption families only'
      );
    }

    const verification = await admin.$queryRawUnsafe<
      Array<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>
    >(`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = '${APP_ROLE}';`);

    const role = verification[0];
    if (!role || role.rolbypassrls || role.rolsuper) {
      throw new Error(`${APP_ROLE} must exist as a non-superuser role without BYPASSRLS`);
    }
  } finally {
    await admin.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
