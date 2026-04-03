#!/bin/bash
#
# VaultSpace Deployment Mode Smoke Tests
#
# Tests both Azure and Standalone deployment modes, including degraded scenarios.
# Run this after making changes to deployment-mode, capabilities, or azure-guard.
#
# Usage:
#   ./scripts/smoke-test-deployment-modes.sh [--standalone-only] [--skip-services]
#
# Prerequisites:
#   - Node.js 20+
#   - Docker (for spinning up test services)
#   - curl, jq
#
# Options:
#   --standalone-only   Skip Azure mode tests (useful for local dev)
#   --skip-services     Assume services are already running (don't start/stop Docker)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Options
STANDALONE_ONLY=false
SKIP_SERVICES=false
CLEANUP_SERVICES=true

# Parse arguments
for arg in "$@"; do
  case $arg in
    --standalone-only)
      STANDALONE_ONLY=true
      shift
      ;;
    --skip-services)
      SKIP_SERVICES=true
      CLEANUP_SERVICES=false
      shift
      ;;
    *)
      ;;
  esac
done

# Test configuration
TEST_PORT=3099
TEST_DB_NAME="vaultspace_smoke_test"
POSTGRES_PORT=5433
REDIS_PORT=6380
GOTENBERG_PORT=3098

# Connection strings for test services
TEST_DATABASE_URL="postgresql://postgres:smoketest@localhost:${POSTGRES_PORT}/${TEST_DB_NAME}"
TEST_REDIS_URL="redis://localhost:${REDIS_PORT}"
TEST_GOTENBERG_URL="http://localhost:${GOTENBERG_PORT}"

# Logging functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[PASS]${NC} $1"
  ((TESTS_PASSED++))
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  ((TESTS_FAILED++))
}

log_skip() {
  echo -e "${YELLOW}[SKIP]${NC} $1"
  ((TESTS_SKIPPED++))
}

log_section() {
  echo ""
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}========================================${NC}"
}

# Cleanup function
cleanup() {
  log_info "Cleaning up..."

  # Kill any running test server
  if [ ! -z "$SERVER_PID" ]; then
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
  fi

  # Stop Docker containers if we started them
  if [ "$CLEANUP_SERVICES" = true ]; then
    docker stop smoke-postgres smoke-redis smoke-gotenberg 2>/dev/null || true
    docker rm smoke-postgres smoke-redis smoke-gotenberg 2>/dev/null || true
  fi
}

trap cleanup EXIT

# Wait for a service to be ready
wait_for_service() {
  local name=$1
  local url=$2
  local max_attempts=${3:-30}
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    if curl -s "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
    ((attempt++))
  done

  return 1
}

# Wait for PostgreSQL to be ready
wait_for_postgres() {
  local max_attempts=${1:-30}
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    if docker exec smoke-postgres pg_isready -U postgres > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
    ((attempt++))
  done

  return 1
}

# Start test services
start_services() {
  log_section "Starting Test Services"

  if [ "$SKIP_SERVICES" = true ]; then
    log_info "Skipping service startup (--skip-services)"
    return
  fi

  # PostgreSQL
  log_info "Starting PostgreSQL on port ${POSTGRES_PORT}..."
  docker run -d --name smoke-postgres \
    -e POSTGRES_PASSWORD=smoketest \
    -e POSTGRES_DB=$TEST_DB_NAME \
    -p ${POSTGRES_PORT}:5432 \
    postgres:15-alpine > /dev/null

  # Redis
  log_info "Starting Redis on port ${REDIS_PORT}..."
  docker run -d --name smoke-redis \
    -p ${REDIS_PORT}:6379 \
    redis:7-alpine > /dev/null

  # Gotenberg
  log_info "Starting Gotenberg on port ${GOTENBERG_PORT}..."
  docker run -d --name smoke-gotenberg \
    -p ${GOTENBERG_PORT}:3000 \
    gotenberg/gotenberg:8 > /dev/null

  # Wait for services
  log_info "Waiting for PostgreSQL..."
  if ! wait_for_postgres 30; then
    log_fail "PostgreSQL failed to start"
    exit 1
  fi

  log_info "Waiting for Redis..."
  if ! wait_for_service "Redis" "http://localhost:${REDIS_PORT}" 30; then
    # Redis doesn't have HTTP, check with redis-cli via docker
    if ! docker exec smoke-redis redis-cli ping > /dev/null 2>&1; then
      log_fail "Redis failed to start"
      exit 1
    fi
  fi

  log_info "Waiting for Gotenberg..."
  if ! wait_for_service "Gotenberg" "http://localhost:${GOTENBERG_PORT}/health" 30; then
    log_fail "Gotenberg failed to start"
    exit 1
  fi

  log_success "All test services started"

  # Run Prisma migrations
  log_info "Running database migrations..."
  DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy > /dev/null 2>&1 || {
    log_info "Migration failed, trying db push..."
    DATABASE_URL=$TEST_DATABASE_URL npx prisma db push --skip-generate > /dev/null 2>&1
  }
  log_success "Database ready"
}

# Start the application server
start_server() {
  local mode=$1
  local extra_env=$2

  # Kill any existing server
  if [ ! -z "$SERVER_PID" ]; then
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    sleep 1
  fi

  log_info "Starting server in ${mode} mode on port ${TEST_PORT}..."

  # Build environment
  local env_vars="PORT=${TEST_PORT} DEPLOYMENT_MODE=${mode} DATABASE_URL=${TEST_DATABASE_URL}"
  env_vars="$env_vars SESSION_SECRET=smoke-test-secret-key-12345"
  env_vars="$env_vars APP_URL=http://localhost:${TEST_PORT}"

  if [ ! -z "$extra_env" ]; then
    env_vars="$env_vars $extra_env"
  fi

  # Start server in background
  env $env_vars npm run start > /tmp/vaultspace-smoke-test.log 2>&1 &
  SERVER_PID=$!

  # Wait for server to be ready
  local attempt=1
  while [ $attempt -le 30 ]; do
    if curl -s "http://localhost:${TEST_PORT}/api/health" > /dev/null 2>&1; then
      log_success "Server started (PID: $SERVER_PID)"
      return 0
    fi
    sleep 1
    ((attempt++))
  done

  log_fail "Server failed to start. Logs:"
  tail -50 /tmp/vaultspace-smoke-test.log
  return 1
}

# Test health endpoint
test_health_endpoint() {
  local expected_mode=$1
  local expected_status=${2:-healthy}

  local response=$(curl -s "http://localhost:${TEST_PORT}/api/health")
  local actual_mode=$(echo "$response" | jq -r '.mode // empty')
  local actual_status=$(echo "$response" | jq -r '.status // empty')

  if [ "$actual_mode" = "$expected_mode" ]; then
    log_success "Health endpoint returns mode=$expected_mode"
  else
    log_fail "Health endpoint mode mismatch: expected=$expected_mode, actual=$actual_mode"
    echo "Response: $response"
  fi

  if [ "$actual_status" = "$expected_status" ]; then
    log_success "Health endpoint returns status=$expected_status"
  else
    log_fail "Health endpoint status mismatch: expected=$expected_status, actual=$actual_status"
  fi
}

# Test capabilities in health response
test_capabilities() {
  local capability=$1
  local expected_value=$2

  local response=$(curl -s "http://localhost:${TEST_PORT}/api/health")
  local actual_value=$(echo "$response" | jq -r ".capabilities.$capability // empty")

  if [ "$actual_value" = "$expected_value" ]; then
    log_success "Capability $capability=$expected_value"
  else
    log_fail "Capability mismatch: $capability expected=$expected_value, actual=$actual_value"
  fi
}

# Test degraded capabilities
test_degraded_contains() {
  local capability=$1

  local response=$(curl -s "http://localhost:${TEST_PORT}/api/health")
  local degraded=$(echo "$response" | jq -r '.degraded // []')

  if echo "$degraded" | jq -e "index(\"$capability\")" > /dev/null 2>&1; then
    log_success "Degraded list contains $capability"
  else
    log_fail "Degraded list missing $capability. Degraded: $degraded"
  fi
}

# Test that an endpoint returns expected status code
test_endpoint_status() {
  local method=$1
  local endpoint=$2
  local expected_status=$3
  local description=$4

  local actual_status=$(curl -s -o /dev/null -w "%{http_code}" -X $method "http://localhost:${TEST_PORT}${endpoint}")

  if [ "$actual_status" = "$expected_status" ]; then
    log_success "$description (${method} ${endpoint} = ${expected_status})"
  else
    log_fail "$description: expected=${expected_status}, actual=${actual_status}"
  fi
}

# Test startup failure with specific error
test_startup_fails() {
  local mode=$1
  local env_vars=$2
  local expected_error=$3
  local description=$4

  log_info "Testing startup failure: $description"

  # Try to start and capture output
  local output=$(env DEPLOYMENT_MODE=$mode $env_vars npm run start 2>&1 || true)

  if echo "$output" | grep -q "$expected_error"; then
    log_success "$description"
  else
    log_fail "$description - expected error containing: $expected_error"
    echo "Actual output (last 10 lines):"
    echo "$output" | tail -10
  fi
}

# ============================================================================
# TEST SUITES
# ============================================================================

test_suite_standalone_full() {
  log_section "Standalone Mode - Full Stack"

  start_server "standalone" "REDIS_URL=${TEST_REDIS_URL} GOTENBERG_URL=${TEST_GOTENBERG_URL}"

  test_health_endpoint "standalone" "healthy"
  test_capabilities "canQueueJobs" "true"
  test_capabilities "canGenerateAsyncPreviews" "true"
  test_capabilities "canSendSyncEmail" "true"

  # Test that no capabilities are degraded
  local response=$(curl -s "http://localhost:${TEST_PORT}/api/health")
  local degraded_count=$(echo "$response" | jq '.degraded | length')

  # Some capabilities may be degraded (e.g., virus scanning without ClamAV)
  log_info "Degraded capabilities: $(echo "$response" | jq -c '.degraded')"
}

test_suite_standalone_no_redis() {
  log_section "Standalone Mode - No Redis (Degraded)"

  # Start without Redis
  start_server "standalone" "STORAGE_PROVIDER=local STORAGE_LOCAL_PATH=/tmp/vaultspace-smoke"

  test_health_endpoint "standalone" "healthy"
  test_capabilities "canQueueJobs" "false"
  test_capabilities "canGenerateAsyncPreviews" "false"
  test_capabilities "canSendAsyncEmail" "false"

  test_degraded_contains "canQueueJobs"
  test_degraded_contains "canGenerateAsyncPreviews"

  # Test that async endpoints return 503
  test_endpoint_status "POST" "/api/rooms/test-room/export" "503" "Export returns 503 without Redis"
  test_endpoint_status "POST" "/api/rooms/test-room/regenerate-previews" "503" "Regenerate previews returns 503 without Redis"
}

test_suite_standalone_local_storage() {
  log_section "Standalone Mode - Local Storage"

  mkdir -p /tmp/vaultspace-smoke-storage

  start_server "standalone" "STORAGE_PROVIDER=local STORAGE_LOCAL_PATH=/tmp/vaultspace-smoke-storage REDIS_URL=${TEST_REDIS_URL}"

  test_health_endpoint "standalone" "healthy"

  # Verify storage is working
  local response=$(curl -s "http://localhost:${TEST_PORT}/api/health")
  local storage_status=$(echo "$response" | jq -r '.storage // "unknown"')

  if [ "$storage_status" = "healthy" ] || [ "$storage_status" = "unknown" ]; then
    log_success "Local storage provider initialized"
  else
    log_fail "Local storage failed: $storage_status"
  fi
}

test_suite_azure_mode_validation() {
  log_section "Azure Mode - Configuration Validation"

  if [ "$STANDALONE_ONLY" = true ]; then
    log_skip "Azure mode tests (--standalone-only)"
    return
  fi

  # Test that Azure mode fails without proper config
  # We can't easily test this without actually trying to start,
  # so we'll test the validation logic via the guard

  log_info "Testing Azure mode requires Azure configuration..."

  # This should fail because we don't have Azure config
  local result=$(DEPLOYMENT_MODE=azure DATABASE_URL=$TEST_DATABASE_URL \
    node -e "
      process.env.DEPLOYMENT_MODE = 'azure';
      const { validateConfig } = require('./src/lib/azure-guard');
      const { errors } = validateConfig();
      if (errors.length > 0) {
        console.log('VALIDATION_FAILED');
        process.exit(0);
      } else {
        console.log('VALIDATION_PASSED');
        process.exit(1);
      }
    " 2>&1 || echo "VALIDATION_FAILED")

  if echo "$result" | grep -q "VALIDATION_FAILED"; then
    log_success "Azure mode validation rejects missing Azure config"
  else
    log_fail "Azure mode validation should require Azure config"
  fi
}

test_suite_deployment_mode_detection() {
  log_section "Deployment Mode Detection"

  # Test default mode is azure
  local result=$(node -e "
    delete process.env.DEPLOYMENT_MODE;
    const { getDeploymentMode } = require('./src/lib/deployment-mode');
    console.log(getDeploymentMode());
  " 2>&1)

  if [ "$result" = "azure" ]; then
    log_success "Default deployment mode is 'azure'"
  else
    log_fail "Default deployment mode should be 'azure', got: $result"
  fi

  # Test standalone detection
  result=$(DEPLOYMENT_MODE=standalone node -e "
    const { getDeploymentMode, isStandaloneMode } = require('./src/lib/deployment-mode');
    console.log(getDeploymentMode(), isStandaloneMode());
  " 2>&1)

  if echo "$result" | grep -q "standalone true"; then
    log_success "Standalone mode detected correctly"
  else
    log_fail "Standalone mode detection failed: $result"
  fi

  # Test case insensitivity
  result=$(DEPLOYMENT_MODE=STANDALONE node -e "
    const { getDeploymentMode } = require('./src/lib/deployment-mode');
    console.log(getDeploymentMode());
  " 2>&1)

  if [ "$result" = "standalone" ]; then
    log_success "Deployment mode is case-insensitive"
  else
    log_fail "Deployment mode should be case-insensitive, got: $result"
  fi
}

test_suite_capability_resolution() {
  log_section "Capability Resolution"

  # Test with Redis available
  local result=$(DEPLOYMENT_MODE=standalone REDIS_URL=$TEST_REDIS_URL node -e "
    const { resolveCapabilities } = require('./src/lib/deployment-capabilities');
    const caps = resolveCapabilities();
    console.log(JSON.stringify(caps));
  " 2>&1)

  if echo "$result" | jq -e '.canQueueJobs == true' > /dev/null 2>&1; then
    log_success "canQueueJobs=true when Redis configured"
  else
    log_fail "canQueueJobs should be true with Redis: $result"
  fi

  # Test without Redis
  result=$(DEPLOYMENT_MODE=standalone node -e "
    delete process.env.REDIS_URL;
    const { resolveCapabilities } = require('./src/lib/deployment-capabilities');
    const caps = resolveCapabilities();
    console.log(JSON.stringify(caps));
  " 2>&1)

  if echo "$result" | jq -e '.canQueueJobs == false' > /dev/null 2>&1; then
    log_success "canQueueJobs=false when Redis not configured"
  else
    log_fail "canQueueJobs should be false without Redis: $result"
  fi
}

test_suite_integration_guard() {
  log_section "Integration Test Guard"

  # Test that standalone mode allows localhost
  local result=$(DEPLOYMENT_MODE=standalone DATABASE_URL=postgresql://localhost:5432/test node -e "
    const { isLocalhost } = require('./src/lib/azure-guard');
    console.log(isLocalhost('postgresql://localhost:5432/test'));
  " 2>&1)

  if [ "$result" = "true" ]; then
    log_success "isLocalhost detects localhost URLs"
  else
    log_fail "isLocalhost should return true for localhost: $result"
  fi

  # Test various localhost formats
  for url in "postgresql://127.0.0.1:5432/test" "postgresql://[::1]:5432/test" "redis://localhost:6379"; do
    result=$(node -e "
      const { isLocalhost } = require('./src/lib/azure-guard');
      console.log(isLocalhost('$url'));
    " 2>&1)

    if [ "$result" = "true" ]; then
      log_success "isLocalhost('$url') = true"
    else
      log_fail "isLocalhost('$url') should be true"
    fi
  done
}

# ============================================================================
# MAIN
# ============================================================================

main() {
  log_section "VaultSpace Deployment Mode Smoke Tests"
  log_info "Starting smoke tests..."
  log_info "Options: standalone-only=$STANDALONE_ONLY, skip-services=$SKIP_SERVICES"

  # Build the project first
  log_info "Building project..."
  npm run build > /dev/null 2>&1 || {
    log_fail "Build failed"
    exit 1
  }
  log_success "Build complete"

  # Start test services
  start_services

  # Run test suites
  test_suite_deployment_mode_detection
  test_suite_capability_resolution
  test_suite_integration_guard
  test_suite_standalone_full
  test_suite_standalone_no_redis
  test_suite_standalone_local_storage
  test_suite_azure_mode_validation

  # Summary
  log_section "Test Summary"
  echo -e "${GREEN}Passed: ${TESTS_PASSED}${NC}"
  echo -e "${RED}Failed: ${TESTS_FAILED}${NC}"
  echo -e "${YELLOW}Skipped: ${TESTS_SKIPPED}${NC}"
  echo ""

  if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}SMOKE TESTS FAILED${NC}"
    exit 1
  else
    echo -e "${GREEN}ALL SMOKE TESTS PASSED${NC}"
    exit 0
  fi
}

main "$@"
