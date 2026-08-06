#!/bin/sh
set -e

# VaultSpace Docker Entrypoint
# Runs database migrations and RLS policies before starting the application
#
# Connection model:
#   DATABASE_URL        -- application runtime (low-privilege, NOBYPASSRLS app role)
#   DATABASE_URL_ADMIN  -- migrations and RLS DDL (table owner / DDL-capable role)
#
# DATABASE_URL_ADMIN is required for a reviewed production migration. The
# fallback remains only for local single-role compatibility; setting a runtime
# URL into MIGRATION_DATABASE_URL does not satisfy the inbox migration-owner
# requirement and the migration's final posture proof rejects that drift.

echo "[entrypoint] VaultSpace starting..."

if [ "$NODE_ENV" = "production" ] && [ -z "${DATABASE_URL_ADMIN:-}" ]; then
  echo "[entrypoint] FATAL: DATABASE_URL_ADMIN is required for production migrations"
  exit 1
fi

ADMIN_DB_URL="${DATABASE_URL_ADMIN:-$DATABASE_URL}"

# Run database migrations in production
if [ "$NODE_ENV" = "production" ]; then
  echo "[entrypoint] Running database migrations as admin role..."

  if [ "$PRISMA_FORCE_SCHEMA_SYNC" = "true" ]; then
    echo "[entrypoint] FATAL: PRISMA_FORCE_SCHEMA_SYNC is not permitted in production"
    echo "[entrypoint] Run the reviewed migration procedure; db push cannot establish migration evidence boundaries."
    exit 1
  fi
  MIGRATION_DATABASE_URL="$ADMIN_DB_URL" node scripts/run-prisma-migrate-deploy.mjs

  # Apply RLS policies in production (REQUIRED for multi-tenant security)
  if [ "$ENABLE_RLS" != "false" ]; then
    if [ -f "prisma/rls-policies.sql" ]; then
      echo "[entrypoint] Applying RLS policies (required for production)..."
      if command -v psql >/dev/null 2>&1; then
        # ON_ERROR_STOP=1 makes psql exit non-zero on the first error, so a
        # missing table or syntax issue in the SQL fails the deploy instead of
        # silently leaving the database half-configured.
        if ! psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -f prisma/rls-policies.sql; then
          echo "[entrypoint] FATAL: Failed to apply RLS policies"
          echo "[entrypoint] RLS is REQUIRED for production multi-tenant security."
          echo "[entrypoint] Set ENABLE_RLS=false to skip (NOT recommended for production)."
          exit 1
        fi
        echo "[entrypoint] RLS policies applied successfully"
      else
        echo "[entrypoint] FATAL: psql not available - cannot apply RLS policies"
        echo "[entrypoint] Install postgresql-client or set ENABLE_RLS=false"
        exit 1
      fi
    else
      echo "[entrypoint] WARNING: prisma/rls-policies.sql not found"
    fi
  else
    echo "[entrypoint] WARNING: RLS disabled (ENABLE_RLS=false) - NOT recommended for production"
  fi
fi

echo "[entrypoint] Starting application..."
exec "$@"
