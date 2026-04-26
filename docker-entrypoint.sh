#!/bin/sh
set -e

# VaultSpace Docker Entrypoint
# Runs database migrations and RLS policies before starting the application
#
# Connection model:
#   DATABASE_URL        -- application runtime (low-privilege, NOBYPASSRLS app role)
#   DATABASE_URL_ADMIN  -- migrations and RLS DDL (table owner / DDL-capable role)
#
# DATABASE_URL_ADMIN is required when DATABASE_URL points at a non-owner role
# (the recommended production posture). When DATABASE_URL_ADMIN is unset the
# entrypoint falls back to DATABASE_URL for backward compatibility — useful for
# local dev where a single role does both.

echo "[entrypoint] VaultSpace starting..."

ADMIN_DB_URL="${DATABASE_URL_ADMIN:-$DATABASE_URL}"

# Run database migrations in production
if [ "$NODE_ENV" = "production" ]; then
  echo "[entrypoint] Running database migrations as admin role..."

  if [ "$PRISMA_FORCE_SCHEMA_SYNC" = "true" ]; then
    echo "[entrypoint] Force-syncing schema (PRISMA_FORCE_SCHEMA_SYNC=true)..."
    DATABASE_URL="$ADMIN_DB_URL" node ./node_modules/prisma/build/index.js db push --accept-data-loss
  else
    DATABASE_URL="$ADMIN_DB_URL" node ./node_modules/prisma/build/index.js migrate deploy
  fi

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
