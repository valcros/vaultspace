#!/usr/bin/env bash
#
# Validate that every Container App in the VaultSpace environment has the
# required environment variables wired up. Designed for the deploy pipeline:
# fails the deploy when an env var is missing instead of letting a worker
# crash-loop silently behind a "Healthy" status.
#
# Usage:
#   scripts/validate-container-env.sh <resource-group> [web-app-name] [worker-app-name]
#
# Defaults match the staging environment.

set -euo pipefail

RG="${1:-rg-vaultspace-staging}"
WEB_APP="${2:-ca-vaultspace-web}"
WORKER_APP="${3:-ca-vaultspace-worker}"

# Vars that every container needs (web image and worker image share the same
# bootstrapping path through enforceDeploymentMode + validateConfig).
SHARED_REQUIRED=(
  NODE_ENV
  APP_URL
  SESSION_SECRET
  DATABASE_URL
  REDIS_URL
  STORAGE_PROVIDER
  AZURE_STORAGE_ACCOUNT_NAME
  AZURE_STORAGE_ACCOUNT_KEY
  EMAIL_PROVIDER
  ACS_CONNECTION_STRING
  ACS_SENDER_ADDRESS
  SCAN_ENGINE
)

# Web only: needs an admin connection for migrations and RLS DDL because the
# runtime DATABASE_URL points at a low-privilege NOBYPASSRLS app role.
WEB_ONLY_REQUIRED=(
  DATABASE_URL_ADMIN
)

WORKER_ONLY_REQUIRED=(
  WORKER_TYPE
)

# Vars whose value MUST come from a Key Vault secretRef (never plaintext).
SECRET_BACKED=(
  SESSION_SECRET
  DATABASE_URL
  DATABASE_URL_ADMIN
  REDIS_URL
  AZURE_STORAGE_ACCOUNT_KEY
  ACS_CONNECTION_STRING
)

errors=0

check_app() {
  local app="$1"
  shift
  local required_vars=("$@")

  echo ""
  echo "=== Validating ${app} ==="

  # One az call per app, then parse with jq.
  local env_json
  env_json=$(az containerapp show \
    --name "${app}" \
    --resource-group "${RG}" \
    --query "properties.template.containers[0].env" \
    -o json)

  for var in "${required_vars[@]}"; do
    local entry
    entry=$(echo "${env_json}" | jq -r ".[] | select(.name == \"${var}\")")

    if [ -z "${entry}" ]; then
      echo "  ERROR: ${app} missing required env var: ${var}"
      errors=$((errors + 1))
      continue
    fi

    # If this var must be secret-backed, confirm secretRef is set and value is empty.
    for secret_var in "${SECRET_BACKED[@]}"; do
      if [ "${var}" = "${secret_var}" ]; then
        local has_secretref has_value
        has_secretref=$(echo "${entry}" | jq -r '.secretRef // ""')
        has_value=$(echo "${entry}" | jq -r '.value // ""')

        if [ -z "${has_secretref}" ]; then
          echo "  ERROR: ${app} ${var} is not bound via secretRef (literal value present)"
          errors=$((errors + 1))
        elif [ -n "${has_value}" ]; then
          echo "  ERROR: ${app} ${var} has both secretRef and a literal value"
          errors=$((errors + 1))
        fi
        break
      fi
    done

    echo "  OK: ${var}"
  done
}

check_app "${WEB_APP}" "${SHARED_REQUIRED[@]}" "${WEB_ONLY_REQUIRED[@]}"
check_app "${WORKER_APP}" "${SHARED_REQUIRED[@]}" "${WORKER_ONLY_REQUIRED[@]}"

# Probes: the worker has no HTTP ingress, so the only signal that distinguishes
# a healthy worker from a crash-looping one is the TCP socket on port 3000.
# Require at least one probe on that port.
echo ""
echo "=== Validating ${WORKER_APP} probes ==="
worker_probes=$(az containerapp show \
  --name "${WORKER_APP}" \
  --resource-group "${RG}" \
  --query "properties.template.containers[?name=='${WORKER_APP}'].probes | [0]" \
  -o json)
probe_count=$(echo "${worker_probes}" | jq -r 'if . == null then 0 else map(select(.tcpSocket.port == 3000)) | length end')
if [ "${probe_count}" -lt 1 ]; then
  echo "  ERROR: ${WORKER_APP} has no TCP probe on port 3000 (worker health endpoint)"
  errors=$((errors + 1))
else
  echo "  OK: ${probe_count} probe(s) targeting port 3000"
fi

echo ""
if [ "${errors}" -gt 0 ]; then
  echo "Validation failed: ${errors} error(s) found"
  exit 1
fi

echo "Validation passed: all required env vars present and correctly bound"
