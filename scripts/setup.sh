#!/usr/bin/env bash
# =============================================================================
# VaultSpace standalone installer
#
# Usage:
#   ./scripts/setup.sh [OPTIONS]
#
# Options:
#   --org-name NAME         Organization display name
#   --org-slug SLUG         Organization URL slug (lowercase, hyphens only)
#   --admin-first-name STR  Admin user first name
#   --admin-last-name STR   Admin user last name
#   --admin-email EMAIL     Admin user email address
#   --admin-password PASS   Admin user password (min 8 chars)
#   --smtp-host HOST        SMTP server hostname
#   --smtp-port PORT        SMTP port (default: 587)
#   --smtp-tls true|false   Enable TLS (default: false)
#   --smtp-user USER        SMTP username
#   --smtp-password PASS    SMTP password
#   --smtp-from EMAIL       Sender address
#   --storage local|s3      Storage backend (default: local)
#   --s3-endpoint URL       S3 endpoint (MinIO, Backblaze, etc.)
#   --s3-bucket BUCKET      S3 bucket name
#   --s3-key-id KEY         S3 access key ID
#   --s3-secret KEY         S3 secret access key
#   --s3-region REGION      S3 region (default: us-east-1)
#   --s3-path-style true|false  Force path-style (MinIO: true)
#   --app-url URL           Public app URL (default: http://localhost:3000)
#   --app-port PORT         Host port for the app (default: 3000)
#   --demo                  Install demo data (skips first-admin prompt)
#   --fresh                 Pass --no-cache to docker build
#   --non-interactive       Fail if any required prompt is unanswered
#   -y, --yes               Skip confirmation prompts
#   --dry-run               Print commands without executing
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
OPT_ORG_NAME=''
OPT_ORG_SLUG=''
OPT_ADMIN_FIRST=''
OPT_ADMIN_LAST=''
OPT_ADMIN_EMAIL=''
OPT_ADMIN_PASSWORD=''
OPT_SMTP_HOST=''
OPT_SMTP_PORT='587'
OPT_SMTP_TLS='false'
OPT_SMTP_USER=''
OPT_SMTP_PASSWORD=''
OPT_SMTP_FROM=''
OPT_STORAGE='local'
OPT_S3_ENDPOINT=''
OPT_S3_BUCKET=''
OPT_S3_KEY_ID=''
OPT_S3_SECRET=''
OPT_S3_REGION='us-east-1'
OPT_S3_PATH_STYLE='false'
OPT_APP_URL=''
OPT_APP_PORT='3000'
OPT_DEMO=false
OPT_FRESH=false
OPT_NON_INTERACTIVE=false
OPT_YES=false
OPT_DRY_RUN=false

# =============================================================================
# Argument parsing
# =============================================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org-name)          OPT_ORG_NAME="$2";          shift 2 ;;
    --org-slug)          OPT_ORG_SLUG="$2";          shift 2 ;;
    --admin-first-name)  OPT_ADMIN_FIRST="$2";       shift 2 ;;
    --admin-last-name)   OPT_ADMIN_LAST="$2";        shift 2 ;;
    --admin-email)       OPT_ADMIN_EMAIL="$2";       shift 2 ;;
    --admin-password)    OPT_ADMIN_PASSWORD="$2";    shift 2 ;;
    --smtp-host)         OPT_SMTP_HOST="$2";         shift 2 ;;
    --smtp-port)         OPT_SMTP_PORT="$2";         shift 2 ;;
    --smtp-tls)          OPT_SMTP_TLS="$2";          shift 2 ;;
    --smtp-user)         OPT_SMTP_USER="$2";         shift 2 ;;
    --smtp-password)     OPT_SMTP_PASSWORD="$2";     shift 2 ;;
    --smtp-from)         OPT_SMTP_FROM="$2";         shift 2 ;;
    --storage)           OPT_STORAGE="$2";           shift 2 ;;
    --s3-endpoint)       OPT_S3_ENDPOINT="$2";       shift 2 ;;
    --s3-bucket)         OPT_S3_BUCKET="$2";         shift 2 ;;
    --s3-key-id)         OPT_S3_KEY_ID="$2";         shift 2 ;;
    --s3-secret)         OPT_S3_SECRET="$2";         shift 2 ;;
    --s3-region)         OPT_S3_REGION="$2";         shift 2 ;;
    --s3-path-style)     OPT_S3_PATH_STYLE="$2";     shift 2 ;;
    --app-url)           OPT_APP_URL="$2";           shift 2 ;;
    --app-port)          OPT_APP_PORT="$2";          shift 2 ;;
    --demo)              OPT_DEMO=true;              shift ;;
    --fresh)             OPT_FRESH=true;             shift ;;
    --non-interactive)   OPT_NON_INTERACTIVE=true;   shift ;;
    -y|--yes)            OPT_YES=true;               shift ;;
    --dry-run)           OPT_DRY_RUN=true;           shift ;;
    *)                   die "Unknown option: $1" ;;
  esac
done

# =============================================================================
# run / dryrun wrapper
# =============================================================================
run() {
  if [[ "$OPT_DRY_RUN" == true ]]; then
    printf '%s[dry-run]%s %s\n' "$YELLOW" "$RESET" "$*"
  else
    "$@"
  fi
}

# =============================================================================
# Prompt helper (skips in non-interactive or --yes mode when appropriate)
# =============================================================================
# Usage: prompt_text VARNAME "prompt text" [default]
prompt_text() {
  local var="$1" prompt="$2" default="${3:-}"
  if [[ "$OPT_NON_INTERACTIVE" == true ]]; then
    [[ -n "${!var:-}" ]] || die "--non-interactive: missing required value for $var"
    return
  fi
  local display_default=''
  [[ -n "$default" ]] && display_default=" [${default}]"
  printf '%s%s%s: ' "$BOLD" "${prompt}${display_default}" "$RESET"
  local input
  read -r input
  if [[ -z "$input" ]] && [[ -n "$default" ]]; then
    printf -v "$var" '%s' "$default"
  elif [[ -n "$input" ]]; then
    printf -v "$var" '%s' "$input"
  fi
  [[ -n "${!var:-}" ]] || die "Value required for: $prompt"
}

# Usage: prompt_secret VARNAME "prompt text"
prompt_secret() {
  local var="$1" prompt="$2"
  if [[ "$OPT_NON_INTERACTIVE" == true ]]; then
    [[ -n "${!var:-}" ]] || die "--non-interactive: missing required secret for $var"
    return
  fi
  printf '%s%s%s: ' "$BOLD" "$prompt" "$RESET"
  local input
  read -rs input
  printf '\n'
  [[ -n "$input" ]] || die "Value required for: $prompt"
  printf -v "$var" '%s' "$input"
}

# Usage: prompt_optional VARNAME "prompt text"
# Like prompt_text but does NOT die if input is empty (for optional fields).
prompt_optional() {
  local var="$1" prompt="$2"
  if [[ "$OPT_NON_INTERACTIVE" == true ]]; then
    return  # Keep whatever flag value was set (may be empty — that is valid here)
  fi
  printf '%s%s (leave blank to skip)%s: ' "$BOLD" "$prompt" "$RESET"
  local input
  read -r input
  [[ -n "$input" ]] && printf -v "$var" '%s' "$input"
}

# Usage: prompt_choice VARNAME "prompt" option1 option2 ...
prompt_choice() {
  local var="$1" prompt="$2"; shift 2
  local opts=("$@")
  if [[ "$OPT_NON_INTERACTIVE" == true ]]; then
    [[ -n "${!var:-}" ]] || die "--non-interactive: missing required choice for $var"
    return
  fi
  local opts_str; opts_str=$(IFS='/'; echo "${opts[*]}")
  printf '%s%s (%s)%s: ' "$BOLD" "$prompt" "$opts_str" "$RESET"
  local input
  read -r input
  input="${input:-${opts[0]}}"
  printf -v "$var" '%s' "$input"
}

# Usage: confirm "question" — returns 0 if yes, 1 if no
# --yes bypasses confirmations; --non-interactive does NOT (it dies instead of prompting)
confirm() {
  [[ "$OPT_YES" == true ]] && return 0
  if [[ "$OPT_NON_INTERACTIVE" == true ]]; then
    die "--non-interactive: confirmation required but no --yes flag. Add --yes or resolve the issue first: $1"
  fi
  printf '%s%s [y/N]%s: ' "$BOLD" "$1" "$RESET"
  local input
  read -r input
  [[ "${input,,}" == 'y' || "${input,,}" == 'yes' ]]
}

# =============================================================================
# Prerequisites
# =============================================================================
check_prerequisites() {
  header "Checking prerequisites"

  # Bash version
  local bash_major="${BASH_VERSINFO[0]}"
  if [[ "$bash_major" -lt 4 ]]; then
    die "Bash 4+ required (found $bash_major). macOS ships Bash 3; install via: brew install bash"
  fi
  success "bash $BASH_VERSION"

  # Docker
  if ! command -v docker &>/dev/null; then
    die "docker not found. Install Docker Desktop or Docker Engine 24+."
  fi
  local docker_ver; docker_ver=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  local docker_major; docker_major=$(echo "$docker_ver" | cut -d. -f1)
  if [[ "$docker_major" -lt 24 ]]; then
    warn "Docker $docker_ver detected; 24+ recommended."
  fi
  success "docker $docker_ver"

  # Docker Compose v2 (plugin form: 'docker compose')
  if ! docker compose version &>/dev/null; then
    die "'docker compose' (v2 plugin) not found. 'docker-compose' (v1) is not supported."
  fi
  local compose_ver; compose_ver=$(docker compose version --short 2>/dev/null || echo 'unknown')
  success "docker compose $compose_ver"

  # openssl
  if ! command -v openssl &>/dev/null; then
    die "openssl not found. Install via your OS package manager."
  fi
  success "openssl $(openssl version | awk '{print $2}')"

  # curl
  if ! command -v curl &>/dev/null; then
    die "curl not found. Install via your OS package manager."
  fi
  success "curl"

  # jq (required — used for health status parsing and setup API response)
  if ! command -v jq &>/dev/null; then
    die "jq not found. Required for health check and setup API parsing. Install: brew install jq / apt install jq"
  fi
  success "jq $(jq --version)"
  HAS_JQ=true
}

# =============================================================================
# Port availability check
# =============================================================================
check_ports() {
  header "Checking port availability"

  local app_port="${OPT_APP_PORT:-3000}"
  local db_port="${DATABASE_PORT:-5432}"
  local redis_port="${REDIS_PORT:-6379}"
  local gotenberg_port=3001
  local clamav_port=3310

  local ports=("$app_port:app" "$db_port:postgres" "$redis_port:redis" \
               "$gotenberg_port:gotenberg" "$clamav_port:clamav")

  local blocked=false
  for entry in "${ports[@]}"; do
    local port="${entry%%:*}" label="${entry##*:}"
    if _port_in_use "$port"; then
      warn "Port $port ($label) is already in use"
      blocked=true
    else
      success "Port $port ($label) free"
    fi
  done

  if [[ "$blocked" == true ]]; then
    confirm "One or more ports are in use. Continue anyway?" || die "Aborting — free up the ports and retry."
  fi
}

_port_in_use() {
  local port="$1"
  if command -v ss &>/dev/null; then
    ss -ltn 2>/dev/null | grep -qE ":${port}\s"
  elif command -v lsof &>/dev/null; then
    lsof -i :"$port" -sTCP:LISTEN &>/dev/null
  else
    # Cannot check; assume free
    return 1
  fi
}

# =============================================================================
# Existing .env detection
# =============================================================================

# Populate OPT_APP_URL and OPT_APP_PORT from an existing .env so that the
# health-check URL and summary are correct when keeping existing config.
_load_env_file() {
  local env_file="$REPO_ROOT/.env"
  [[ -f "$env_file" ]] || return
  local val
  val=$(grep -E '^APP_URL=' "$env_file" | head -1 | cut -d= -f2-)
  [[ -n "$val" ]] && OPT_APP_URL="$val"
  val=$(grep -E '^APP_PORT=' "$env_file" | head -1 | cut -d= -f2-)
  [[ -n "$val" ]] && OPT_APP_PORT="$val"
}

handle_existing_env() {
  local env_file="$REPO_ROOT/.env"
  if [[ ! -f "$env_file" ]]; then
    return
  fi

  warn ".env already exists at $env_file"
  if [[ "$OPT_NON_INTERACTIVE" == true ]] || [[ "$OPT_YES" == true ]]; then
    info "Overwriting existing .env (--yes or --non-interactive)"
    return
  fi

  printf '%s%s%s\n' "$BOLD" "What would you like to do?" "$RESET"
  printf '  (k) Keep existing .env and continue (you may be re-prompted for admin setup)\n'
  printf '  (r) Replace .env with new configuration\n'
  printf '  (a) Abort\n'
  printf 'Choice [k/r/a]: '
  local choice; read -r choice
  case "${choice,,}" in
    r) info "Replacing .env" ;;
    a) die "Aborted." ;;
    *) info "Keeping existing .env"; KEEP_ENV=true; _load_env_file ;;
  esac
}
KEEP_ENV=false

# =============================================================================
# Configuration prompts
# =============================================================================
configure_storage() {
  header "Storage configuration"

  if [[ "$OPT_STORAGE" == 'local' ]] && [[ "$OPT_NON_INTERACTIVE" != true ]]; then
    local choice='l'
    prompt_choice choice "Storage backend" "l (local filesystem)" "s (S3-compatible)"
    [[ "${choice,,}" == 's'* ]] && OPT_STORAGE='s3' || OPT_STORAGE='local'
  fi

  if [[ "$OPT_STORAGE" == 's3' ]]; then
    info "S3-compatible storage selected"
    prompt_text OPT_S3_ENDPOINT "S3 endpoint URL (e.g. https://s3.amazonaws.com or http://minio:9000)" ""
    prompt_text OPT_S3_BUCKET   "S3 bucket name" "vaultspace"
    prompt_text OPT_S3_KEY_ID   "S3 access key ID" ""
    prompt_secret OPT_S3_SECRET "S3 secret access key"
    prompt_text OPT_S3_REGION   "S3 region" "us-east-1"
    local ps_choice='n'
    prompt_choice ps_choice "Force path-style URLs (required for MinIO)" "n (no)" "y (yes)"
    [[ "${ps_choice,,}" == 'y'* ]] && OPT_S3_PATH_STYLE='true' || OPT_S3_PATH_STYLE='false'
    success "Storage: S3 ($OPT_S3_ENDPOINT)"
  else
    success "Storage: local filesystem (./storage volume)"
  fi
}

configure_email() {
  header "Email configuration"

  if [[ "$OPT_NON_INTERACTIVE" == false ]]; then
    local choice='s'
    prompt_choice choice "Email transport" "s (SMTP)" "c (Console — prints to logs, no delivery)"
    if [[ "${choice,,}" == 'c'* ]]; then
      EMAIL_PROVIDER_VAL='console'
      success "Email: console (dev mode — emails printed to logs)"
      return
    fi
  fi

  EMAIL_PROVIDER_VAL='smtp'
  if [[ -z "$OPT_SMTP_HOST" ]]; then
    prompt_text OPT_SMTP_HOST "SMTP hostname" ""
  fi
  prompt_text OPT_SMTP_PORT "SMTP port" "587"
  local tls_choice='n'
  if [[ -z "$OPT_SMTP_USER" ]]; then
    prompt_optional OPT_SMTP_USER "SMTP username"
  fi
  if [[ -z "$OPT_SMTP_PASSWORD" ]] && [[ -n "$OPT_SMTP_USER" ]]; then
    prompt_secret OPT_SMTP_PASSWORD "SMTP password"
  fi
  if [[ -z "$OPT_SMTP_FROM" ]]; then
    prompt_text OPT_SMTP_FROM "Sender address (SMTP_FROM)" "noreply@example.com"
  fi
  prompt_choice tls_choice "Enable TLS/SSL (port 465 = yes, 587 = usually no)" "n (no)" "y (yes)"
  [[ "${tls_choice,,}" == 'y'* ]] && OPT_SMTP_TLS='true' || OPT_SMTP_TLS='false'
  success "Email: SMTP ($OPT_SMTP_HOST:$OPT_SMTP_PORT)"
}
EMAIL_PROVIDER_VAL='smtp'

configure_app() {
  header "Application URL"
  if [[ -z "$OPT_APP_URL" ]]; then
    prompt_text OPT_APP_URL "Public app URL" "http://localhost:${OPT_APP_PORT}"
  fi
  success "App URL: $OPT_APP_URL"
}

configure_admin() {
  header "Admin account"
  if [[ "$OPT_DEMO" == true ]]; then
    info "Demo mode — demo admin (admin@demo.vaultspace.app / Demo123!) will be created by seed."
    return
  fi

  prompt_text   OPT_ORG_NAME     "Organization name" "My Organization"
  if [[ -z "$OPT_ORG_SLUG" ]]; then
    local auto_slug; auto_slug=$(echo "$OPT_ORG_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
    prompt_text OPT_ORG_SLUG "Organization slug" "$auto_slug"
  fi
  prompt_text   OPT_ADMIN_FIRST  "Admin first name" ""
  prompt_text   OPT_ADMIN_LAST   "Admin last name" ""
  prompt_text   OPT_ADMIN_EMAIL  "Admin email" ""
  if [[ -z "$OPT_ADMIN_PASSWORD" ]]; then
    prompt_secret OPT_ADMIN_PASSWORD "Admin password (min 8 chars)"
    local confirm_pass=''
    prompt_secret confirm_pass "Confirm password"
    [[ "$OPT_ADMIN_PASSWORD" == "$confirm_pass" ]] || die "Passwords do not match."
  fi

  success "Admin: $OPT_ADMIN_EMAIL"
}

configure_demo() {
  if [[ "$OPT_DEMO" == true ]]; then return; fi
  if [[ "$OPT_NON_INTERACTIVE" == true ]]; then return; fi
  if confirm "Install demo data? (org: Series A Funding, login: admin@demo.vaultspace.app / Demo123!)"; then
    OPT_DEMO=true
    info "Demo data will be seeded."
  fi
}

# =============================================================================
# Secret generation
# =============================================================================
generate_secrets() {
  header "Generating secrets"
  SESSION_SECRET_VAL=$(openssl rand -hex 32)
  DATABASE_PASSWORD_VAL=$(openssl rand -hex 16)
  REDIS_PASSWORD_VAL=$(openssl rand -hex 16)
  success "SESSION_SECRET, DATABASE_PASSWORD, REDIS_PASSWORD generated"
}

# =============================================================================
# Write .env
# =============================================================================
write_env() {
  [[ "$KEEP_ENV" == true ]] && { info "Keeping existing .env"; return; }

  header "Writing .env"
  local env_file="$REPO_ROOT/.env"

  local storage_section=''
  if [[ "$OPT_STORAGE" == 's3' ]]; then
    storage_section="STORAGE_PROVIDER=s3
STORAGE_ENDPOINT=${OPT_S3_ENDPOINT}
STORAGE_BUCKET=${OPT_S3_BUCKET}
STORAGE_KEY_ID=${OPT_S3_KEY_ID}
STORAGE_SECRET_KEY=${OPT_S3_SECRET}
STORAGE_REGION=${OPT_S3_REGION}
S3_FORCE_PATH_STYLE=${OPT_S3_PATH_STYLE}"
  else
    storage_section="STORAGE_PROVIDER=local"
  fi

  local smtp_section=''
  if [[ "$EMAIL_PROVIDER_VAL" == 'smtp' ]]; then
    smtp_section="EMAIL_PROVIDER=smtp
SMTP_HOST=${OPT_SMTP_HOST}
SMTP_PORT=${OPT_SMTP_PORT}
SMTP_TLS=${OPT_SMTP_TLS}
SMTP_USER=${OPT_SMTP_USER}
SMTP_PASSWORD=${OPT_SMTP_PASSWORD}
SMTP_FROM=${OPT_SMTP_FROM}"
  else
    smtp_section="EMAIL_PROVIDER=console"
  fi

  if [[ "$OPT_DRY_RUN" == true ]]; then
    info "[dry-run] Would write .env to $env_file"
    return
  fi

  cat > "$env_file" <<ENVEOF
# VaultSpace — generated by scripts/setup.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ')
# Do not commit this file. Add .env to .gitignore.
DEPLOYMENT_MODE=standalone
NODE_ENV=production
APP_URL=${OPT_APP_URL}
APP_PORT=${OPT_APP_PORT}
APP_NAME=VaultSpace
DEFAULT_ORG_NAME=My Organization
LOG_LEVEL=info
SESSION_SECRET=${SESSION_SECRET_VAL}
DATABASE_PASSWORD=${DATABASE_PASSWORD_VAL}
REDIS_PASSWORD=${REDIS_PASSWORD_VAL}
${storage_section}
SIGNED_URL_EXPIRY_SECONDS=300
${smtp_section}
PREVIEW_ENGINE=gotenberg
SCAN_ENGINE=clamav
SEARCH_PROVIDER=postgres
ENCRYPTION_PROVIDER=noop
ENVEOF

  chmod 600 "$env_file"
  success ".env written to $env_file (mode 600)"
  warn "Keep .env secure — it contains database and session secrets."
}

# =============================================================================
# Build
# =============================================================================
build_images() {
  header "Building Docker images"
  local build_args=('--build-arg' 'DEPLOYMENT_MODE=standalone')
  [[ "$OPT_FRESH" == true ]] && build_args+=('--no-cache')

  info "docker compose build ${build_args[*]}"
  run docker compose build "${build_args[@]}"
  success "Images built"
}

# =============================================================================
# Infrastructure startup (postgres + redis first)
# =============================================================================
start_infrastructure() {
  header "Starting database and cache"
  run docker compose up -d postgres redis

  if [[ "$OPT_DRY_RUN" == true ]]; then
    info "[dry-run] Would wait for postgres and redis health"
    return
  fi

  info "Waiting for postgres..."
  _wait_container_healthy vaultspace-postgres 60

  info "Waiting for redis..."
  _wait_container_healthy vaultspace-redis 60

  success "Database and cache are healthy"
}

_wait_container_healthy() {
  local container="$1" timeout="$2"
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    local status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo 'unknown')
    if [[ "$status" == 'healthy' ]]; then
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    printf '.'
  done
  printf '\n'
  die "Container $container did not become healthy within ${timeout}s. Check: docker logs $container"
}

# =============================================================================
# Full stack startup (app + workers, entrypoint runs migration + RLS)
# =============================================================================
start_full_stack() {
  header "Starting application and workers"
  run docker compose up -d
  success "All containers started. Entrypoint is running migrations and RLS policies."
}

# =============================================================================
# Wait for app readiness (primary signal that migration succeeded)
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

  while [[ $elapsed -lt $timeout ]]; do
    local http_code status_val
    http_code=$(curl -s -o /tmp/vs_health.json -w '%{http_code}' "$url" 2>/dev/null || echo '000')
    if [[ "$http_code" == '200' ]]; then
      status_val=$(jq -r '.status // empty' /tmp/vs_health.json 2>/dev/null || echo '')
      if [[ "$status_val" == 'healthy' || "$status_val" == 'degraded' ]]; then
        printf '\n'
        if [[ "$status_val" == 'degraded' ]]; then
          local degraded_list; degraded_list=$(jq -r '.degraded[]? // empty' /tmp/vs_health.json 2>/dev/null | tr '\n' ' ')
          warn "App is degraded. Reduced capabilities: $degraded_list"
          warn "Check individual service logs: docker compose logs clamav / gotenberg"
        else
          success "App is healthy"
        fi
        _show_health_checks /tmp/vs_health.json
        return 0
      fi
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    printf '.'
  done
  printf '\n'

  # Print diagnostic logs before dying
  warn "App did not become ready within ${timeout}s."
  info "Recent app logs:"
  docker compose logs --tail=30 app || true
  die "Startup failed. Review logs above."
}

_show_health_checks() {
  local json="$1"
  if [[ "$HAS_JQ" == true ]] && [[ -f "$json" ]]; then
    printf '\n  Checks:\n'
    jq -r '.checks | to_entries[] | "    \(.key): \(.value.status)\(.value.latencyMs | if . then " (\(.)ms)" else "" end)\(.value.error | if . then " — \(.)" else "" end)"' \
      "$json" 2>/dev/null || true
  fi
}

# =============================================================================
# Demo seed
# =============================================================================
run_demo_seed() {
  [[ "$OPT_DEMO" == false ]] && return

  header "Seeding demo data"
  info "Creating demo organization and users..."
  run docker compose run --rm app npm run db:seed
  success "Demo data seeded. Login: admin@demo.vaultspace.app / Demo123!"
}

# =============================================================================
# First admin setup (via /api/setup — skipped when demo seed ran)
# =============================================================================
create_first_admin() {
  [[ "$OPT_DEMO" == true ]] && return

  header "Creating first admin account"

  if [[ "$OPT_DRY_RUN" == true ]]; then
    info "[dry-run] Would POST /api/setup with org '$OPT_ORG_NAME' / admin '$OPT_ADMIN_EMAIL'"
    return
  fi

  local setup_url="${OPT_APP_URL:-http://localhost:${OPT_APP_PORT}}/api/setup"

  local payload
  payload=$(jq -n \
    --arg org   "$OPT_ORG_NAME" \
    --arg slug  "$OPT_ORG_SLUG" \
    --arg first "$OPT_ADMIN_FIRST" \
    --arg last  "$OPT_ADMIN_LAST" \
    --arg email "$OPT_ADMIN_EMAIL" \
    --arg pass  "$OPT_ADMIN_PASSWORD" \
    '{organizationName:$org,organizationSlug:$slug,adminFirstName:$first,adminLastName:$last,adminEmail:$email,adminPassword:$pass}')

  local http_code response
  response=$(curl -s -o /tmp/vs_setup.json -w '%{http_code}' \
    -X POST "$setup_url" \
    -H 'Content-Type: application/json' \
    -d "$payload" 2>/dev/null || echo '000')
  http_code="$response"

  case "$http_code" in
    200)
      success "Admin account created: $OPT_ADMIN_EMAIL"
      ;;
    400)
      local msg; msg=$(jq -r '.error // "unknown"' /tmp/vs_setup.json 2>/dev/null || cat /tmp/vs_setup.json)
      if [[ "$msg" == *"already been completed"* ]]; then
        warn "Setup already completed (org already exists). Skipping admin creation."
      else
        die "Setup API returned 400: $msg"
      fi
      ;;
    *)
      local body; body=$(cat /tmp/vs_setup.json 2>/dev/null || echo '(no body)')
      die "Setup API returned HTTP $http_code: $body"
      ;;
  esac
}

# =============================================================================
# Success summary
# =============================================================================
print_success() {
  local app_url="${OPT_APP_URL:-http://localhost:${OPT_APP_PORT}}"
  printf '\n'
  hr
  printf '%s%s%s\n' "$GREEN$BOLD" "VaultSpace is running" "$RESET"
  hr
  printf '  URL:   %s\n' "$app_url"
  if [[ "$OPT_DEMO" == true ]]; then
    printf '  Login: admin@demo.vaultspace.app\n'
    printf '  Pass:  Demo123!\n'
  else
    printf '  Login: %s\n' "$OPT_ADMIN_EMAIL"
  fi
  printf '\n'
  printf '  Useful commands:\n'
  printf '    docker compose logs -f  # tail all service logs\n'
  printf '    docker compose stop     # stop all containers\n'
  printf '    docker compose ps       # check container status\n'
  printf '\n'
  printf '  Health endpoint:\n'
  printf '    %s/api/health?deep=true\n' "$app_url"
  hr
}

# =============================================================================
# Main
# =============================================================================
main() {
  printf '\n'
  printf '%sVaultSpace Standalone Installer%s\n' "$BOLD" "$RESET"
  info "Mode: standalone (self-hosted Docker Compose)"
  info "Azure provisioning is available via the Azure CLI guide in docs/INSTALL.md"
  printf '\n'

  cd "$REPO_ROOT"

  check_prerequisites
  handle_existing_env

  if [[ "$KEEP_ENV" == false ]]; then
    configure_app
    configure_storage
    configure_email
    configure_demo
    configure_admin

    generate_secrets
    write_env
  fi

  check_ports

  hr
  printf '\n'
  info "Configuration summary:"
  printf '  App URL:  %s\n' "${OPT_APP_URL:-http://localhost:${OPT_APP_PORT}}"
  printf '  Storage:  %s\n' "$OPT_STORAGE"
  printf '  Email:    %s\n' "$EMAIL_PROVIDER_VAL"
  printf '  Demo:     %s\n' "$OPT_DEMO"
  printf '\n'

  if ! confirm "Proceed with build and start?"; then
    info "Aborted. Configuration is saved in .env — re-run to start."
    exit 0
  fi

  build_images
  start_infrastructure
  start_full_stack
  wait_for_app
  run_demo_seed
  create_first_admin
  print_success
}

main "$@"
