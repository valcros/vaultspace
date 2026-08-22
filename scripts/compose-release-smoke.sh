#!/usr/bin/env bash
#
# Disposable self-hosted release smoke test.
#
# This script validates the same plain Compose contract documented for
# operators. It creates an isolated Compose project, never targets Azure or a
# deployed tenant, and removes only the resources it created before exit.
#
# Usage:
#   scripts/compose-release-smoke.sh [--full-stack]
#
# Required tooling: Docker Engine with the Docker Compose v2 plugin, curl, and
# node. The GitHub-hosted validation job provides all of them.

set -euo pipefail

FULL_STACK=false
if [ "${1:-}" = "--full-stack" ]; then
  FULL_STACK=true
elif [ "$#" -gt 0 ]; then
  echo "Usage: $0 [--full-stack]" >&2
  exit 64
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 is required. Install the 'docker compose' plugin before running this smoke test." >&2
  exit 1
fi

for command in curl node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: required command is unavailable: $command" >&2
    exit 1
  fi
done

SMOKE_PROJECT="vaultspace-smoke-${GITHUB_RUN_ID:-local}-$$"
SMOKE_PROJECT=$(printf '%s' "$SMOKE_PROJECT" | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-')
SMOKE_APP_PORT="${COMPOSE_SMOKE_APP_PORT:-38080}"
SMOKE_WAIT_TIMEOUT="${COMPOSE_SMOKE_WAIT_TIMEOUT:-300}"

random_secret() {
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
}

# Values are intentionally generated in-memory. Never echo Compose config,
# environment variables, or service logs because they may contain credentials.
export SESSION_SECRET="${SESSION_SECRET:-$(random_secret)}"
export DATABASE_PASSWORD="${DATABASE_PASSWORD:-$(random_secret)}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-$(random_secret)}"
export APP_PORT="$SMOKE_APP_PORT"
export APP_URL="http://127.0.0.1:${SMOKE_APP_PORT}"
export DATABASE_PORT="${COMPOSE_SMOKE_DATABASE_PORT:-35432}"
export REDIS_PORT="${COMPOSE_SMOKE_REDIS_PORT:-36379}"
export GOTENBERG_PORT="${COMPOSE_SMOKE_GOTENBERG_PORT:-33001}"
export CLAMAV_PORT="${COMPOSE_SMOKE_CLAMAV_PORT:-33310}"
export COMPOSE_CONTAINER_PREFIX="$SMOKE_PROJECT"

compose() {
  docker compose --project-name "$SMOKE_PROJECT" "$@"
}

redact_runtime_output() {
  # Startup diagnostics must be useful without making the disposable smoke
  # runner a secret-disclosure path. The app migration runner independently
  # redacts its connection string; this masks common URL forms again at the
  # boundary before CI emits the output.
  sed -E \
    -e 's#(postgres(ql)?://)[^[:space:]]+#\1<redacted>#g' \
    -e 's#(redis://)[^[:space:]]+#\1<redacted>#g'
}

report_app_startup_failure() {
  local app_container
  app_container=$(compose ps -q app 2>/dev/null || true)
  echo "ERROR: Compose app did not become healthy; safe startup diagnostic follows." >&2
  compose ps >&2 || true
  if [ -n "$app_container" ]; then
    docker inspect --format '{{range .State.Health.Log}}{{.Output}}{{end}}' "$app_container" \
      2>&1 | redact_runtime_output >&2 || true
  fi
  compose logs --no-log-prefix --tail 80 app 2>&1 \
    | grep -Ei '\[entrypoint\]|migration_startup_gucs|fatal|error|prisma|failed to start|cannot|module_not_found|eaddr|uncaught' \
    | redact_runtime_output >&2 || true
}

cleanup() {
  local exit_code="$?"
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT

services=(app worker-general)
if [ "$FULL_STACK" = true ]; then
  services=(app worker-general worker-preview worker-scan)
fi

echo "Validating disposable Compose configuration"
compose config --quiet

echo "Building and starting self-hosted services"
if ! compose up --build --wait --wait-timeout "$SMOKE_WAIT_TIMEOUT" "${services[@]}"; then
  report_app_startup_failure
  exit 1
fi

worker_container=$(compose ps -q worker-general)
if [ -z "$worker_container" ]; then
  echo "ERROR: general worker container was not created" >&2
  exit 1
fi

worker_status=$(docker inspect --format '{{.State.Status}}' "$worker_container")
if [ "$worker_status" != 'running' ]; then
  echo "ERROR: general worker is not running (state=$worker_status)" >&2
  exit 1
fi

health_response=$(curl --fail --silent --show-error --max-time 20 \
  "http://127.0.0.1:${SMOKE_APP_PORT}/api/health?deep=true")

printf '%s' "$health_response" | node -e '
  const input = require("fs").readFileSync(0, "utf8");
  let health;
  try {
    health = JSON.parse(input);
  } catch {
    console.error("ERROR: Compose health endpoint did not return JSON");
    process.exit(1);
  }
  const checks = health.checks || {};
  const valid =
    health.status === "healthy" &&
    health.mode === "standalone" &&
    checks.database?.status === "healthy" &&
    checks.cache?.status === "healthy" &&
    checks.storage?.status === "healthy";
  if (!valid) {
    console.error("ERROR: Compose deep health contract was not satisfied");
    process.exit(1);
  }
  console.log("Compose smoke passed: standalone app, database, cache, storage, and general worker are healthy.");
'
