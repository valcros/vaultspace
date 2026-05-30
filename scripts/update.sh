#!/usr/bin/env bash
# =============================================================================
# VaultSpace update script
#
# Pulls latest images, rebuilds app and worker containers, performs a
# graceful restart, and waits for readiness.
#
# This script does NOT run git pull — update your source tree first.
#
# Usage:
#   ./scripts/update.sh [OPTIONS]
#
# Options:
#   --app-url URL    Public app URL to poll (default: reads .env, then http://localhost:3000)
#   --app-port PORT  Host port for the app (default: reads .env, then 3000)
#   --no-cache       Pass --no-cache to docker compose build
#   --dry-run        Print commands without executing
#   -y, --yes        Skip confirmation prompts
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# =============================================================================
# Colour support
# =============================================================================
if [[ -z "${NO_COLOR:-}" ]] && [[ -t 1 ]]; then
  RED=$(tput setaf 1 2>/dev/null || printf '')
  GREEN=$(tput setaf 2 2>/dev/null || printf '')
  YELLOW=$(tput setaf 3 2>/dev/null || printf '')
  CYAN=$(tput setaf 6 2>/dev/null || printf '')
  BOLD=$(tput bold 2>/dev/null || printf '')
  RESET=$(tput sgr0 2>/dev/null || printf '')
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' RESET=''
fi

info()    { printf '%s[info]%s  %s\n' "$CYAN"   "$RESET" "$*"; }
success() { printf '%s[ok]%s    %s\n' "$GREEN"  "$RESET" "$*"; }
warn()    { printf '%s[warn]%s  %s\n' "$YELLOW" "$RESET" "$*"; }
error()   { printf '%s[error]%s %s\n' "$RED"    "$RESET" "$*" >&2; }
die()     { error "$*"; exit 1; }
header()  { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }
hr()      { printf '%s\n' "────────────────────────────────────────"; }

# =============================================================================
# Argument defaults
# =============================================================================
OPT_APP_URL=''
OPT_APP_PORT='3000'
OPT_NO_CACHE=false
OPT_DRY_RUN=false
OPT_YES=false

# =============================================================================
# Argument parsing
# =============================================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-url)     OPT_APP_URL="$2";  shift 2 ;;
    --app-port)    OPT_APP_PORT="$2"; shift 2 ;;
    --no-cache)    OPT_NO_CACHE=true; shift ;;
    --dry-run)     OPT_DRY_RUN=true;  shift ;;
    -y|--yes)      OPT_YES=true;      shift ;;
    *)             die "Unknown option: $1" ;;
  esac
done

# =============================================================================
# Helpers
# =============================================================================
run() {
  if [[ "$OPT_DRY_RUN" == true ]]; then
    printf '%s[dry-run]%s %s\n' "$YELLOW" "$RESET" "$*"
  else
    "$@"
  fi
}

confirm() {
  [[ "$OPT_YES" == true ]] && return 0
  printf '%s%s [y/N]%s: ' "$BOLD" "$1" "$RESET"
  local input
  read -r input
  [[ "${input,,}" == 'y' || "${input,,}" == 'yes' ]]
}

# =============================================================================
# Load port/URL from existing .env so health polling hits the right address
# =============================================================================
_load_env_file() {
  local env_file="$REPO_ROOT/.env"
  [[ -f "$env_file" ]] || return
  local val
  val=$(grep -E '^APP_URL=' "$env_file" | head -1 | cut -d= -f2-)
  [[ -n "$val" ]] && OPT_APP_URL="$val"
  val=$(grep -E '^APP_PORT=' "$env_file" | head -1 | cut -d= -f2-)
  [[ -n "$val" ]] && OPT_APP_PORT="$val"
}

_show_health_checks() {
  local json="$1"
  if command -v jq &>/dev/null && [[ -f "$json" ]]; then
    printf '\n  Checks:\n'
    jq -r '.checks | to_entries[] | "    \(.key): \(.value.status)\(.value.latencyMs | if . then " (\(.)ms)" else "" end)\(.value.error | if . then " — \(.)" else "" end)"' \
      "$json" 2>/dev/null || true
  fi
}

# =============================================================================
# Prerequisite checks
# =============================================================================
check_prerequisites() {
  header "Checking prerequisites"

  if ! command -v docker &>/dev/null; then
    die "docker not found. Install Docker 24+ from https://docs.docker.com/get-docker/"
  fi
  if ! docker compose version &>/dev/null; then
    die "docker compose (v2) not found. Update Docker Desktop or install the Compose plugin."
  fi
  if ! command -v jq &>/dev/null; then
    die "jq not found. Required for health status parsing. Install: brew install jq / apt install jq"
  fi

  success "Prerequisites OK"
}

# =============================================================================
# Pull base images
# =============================================================================
pull_images() {
  header "Pulling base images"
  run docker compose pull --ignore-pull-failures
}

# =============================================================================
# Rebuild app and worker images
# =============================================================================
build_images() {
  header "Building application images"
  local build_args=()
  [[ "$OPT_NO_CACHE" == true ]] && build_args+=(--no-cache)
  run docker compose build "${build_args[@]}" app worker-general worker-preview worker-scan
}

# =============================================================================
# Warn if local storage volumes are in use (volumes are not backed up by update)
# =============================================================================
warn_local_storage() {
  local env_file="$REPO_ROOT/.env"
  if [[ -f "$env_file" ]]; then
    local storage_backend
    storage_backend=$(grep -E '^STORAGE_PROVIDER=' "$env_file" | head -1 | cut -d= -f2-)
    if [[ "$storage_backend" == 'local' || -z "$storage_backend" ]]; then
      warn "You are using local filesystem storage."
      warn "Uploaded files live in the 'storage' volume and are NOT backed up by this script."
      warn "Back up your data before proceeding:"
      warn "  docker run --rm -v vaultspace_postgres_data:/data -v \$(pwd)/backups:/out alpine tar czf /out/postgres-\$(date +%Y%m%d).tar.gz -C /data ."
      warn "  docker run --rm -v vaultspace_storage:/data -v \$(pwd)/backups:/out alpine tar czf /out/storage-\$(date +%Y%m%d).tar.gz -C /data ."
    fi
  fi
}

# =============================================================================
# Graceful restart: stop current containers, bring up rebuilt ones.
# docker-entrypoint.sh owns migrations — do not call migrate here.
# =============================================================================
graceful_restart() {
  header "Restarting services"
  run docker compose down
  run docker compose up -d
  success "Services started. Entrypoint is running migrations and RLS policies."
}

# =============================================================================
# Wait for app readiness (same semantics as setup.sh)
# =============================================================================
wait_for_app() {
  header "Waiting for application readiness"

  if [[ "$OPT_DRY_RUN" == true ]]; then
    info "[dry-run] Would poll /api/health?deep=true"
    return
  fi

  local url="${OPT_APP_URL:-http://localhost:${OPT_APP_PORT}}/api/health?deep=true"
  local elapsed=0
  local timeout=120

  info "Polling $url (timeout: ${timeout}s)"

  while [[ $elapsed -lt $timeout ]]; do
    local http_code status_val
    http_code=$(curl -s -o /tmp/vs_update_health.json -w '%{http_code}' "$url" 2>/dev/null || echo '000')
    if [[ "$http_code" == '200' ]]; then
      status_val=$(jq -r '.status // empty' /tmp/vs_update_health.json 2>/dev/null || echo '')
      if [[ "$status_val" == 'healthy' || "$status_val" == 'degraded' ]]; then
        printf '\n'
        if [[ "$status_val" == 'degraded' ]]; then
          local degraded_list
          degraded_list=$(jq -r '.degraded[]? // empty' /tmp/vs_update_health.json 2>/dev/null | tr '\n' ' ')
          warn "App is degraded. Reduced capabilities: $degraded_list"
          warn "Check individual service logs: docker compose logs clamav / gotenberg"
        else
          success "App is healthy"
        fi
        _show_health_checks /tmp/vs_update_health.json
        return 0
      fi
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    printf '.'
  done
  printf '\n'

  warn "App did not become ready within ${timeout}s."
  info "Recent app logs:"
  docker compose logs --tail=30 app || true
  die "Update failed — app did not come back healthy. Review logs above."
}

# =============================================================================
# Summary
# =============================================================================
print_summary() {
  local app_url="${OPT_APP_URL:-http://localhost:${OPT_APP_PORT}}"
  hr
  success "VaultSpace updated successfully"
  hr
  printf '\n'
  printf '  App:    %s\n' "$app_url"
  printf '\n'
  printf '  Useful commands:\n'
  printf '    docker compose logs -f\n'
  printf '    docker compose ps\n'
  printf '    make backup\n'
  printf '\n'
}

# =============================================================================
# Main
# =============================================================================
main() {
  cd "$REPO_ROOT"

  hr
  printf '%sVaultSpace Update%s\n' "$BOLD" "$RESET"
  hr

  _load_env_file
  check_prerequisites
  warn_local_storage

  confirm "Proceed with update? This will restart all services briefly." || die "Aborted."

  pull_images
  build_images
  graceful_restart
  wait_for_app
  print_summary
}

main "$@"
