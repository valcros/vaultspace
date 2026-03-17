#!/bin/sh
set -e

# VaultSpace Docker Entrypoint
# Runs database migrations and RLS policies before starting the application

echo "[entrypoint] VaultSpace starting..."

# Run database migrations in production
if [ "$NODE_ENV" = "production" ]; then
  echo "[entrypoint] Running database migrations..."
  npx prisma migrate deploy

  # Apply RLS policies in production (REQUIRED for multi-tenant security)
  if [ "$ENABLE_RLS" != "false" ]; then
    if [ -f "prisma/rls-policies.sql" ]; then
      echo "[entrypoint] Applying RLS policies (required for production)..."
      if command -v psql >/dev/null 2>&1; then
        if ! psql "$DATABASE_URL" -f prisma/rls-policies.sql; then
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
