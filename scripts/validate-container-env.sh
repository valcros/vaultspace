#!/usr/bin/env bash
#
# Validate that every Container App in the VaultSpace environment has the
# required environment variables wired up. Designed for the deploy pipeline:
# fails the deploy when an env var is missing instead of letting a worker
# crash-loop silently behind a "Healthy" status.
#
# Usage:
#   scripts/validate-container-env.sh <resource-group> <web-app-name> <worker-app-name> [worker-container-name]

set -euo pipefail

RG="${1:?resource group is required}"
WEB_APP="${2:?web Container App name is required}"
WORKER_APP="${3:?worker Container App name is required}"
WORKER_CONTAINER_NAME="${4:-${WORKER_APP}}"

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

# The worker Container App MUST run the worker image (vaultspace-worker), not the
# web image. On 2026-07-17 the worker was repointed to vaultspace-web, which boots
# the Next.js server (node server.js) instead of the BullMQ consumer
# (npm run worker). The async queue silently stopped draining while probes still
# passed, because port 3000 is open either way. This is the primary guard for that
# failure mode.
echo ""
echo "=== Validating ${WORKER_APP} image repository ==="
worker_image=$(az containerapp show \
  --name "${WORKER_APP}" \
  --resource-group "${RG}" \
  --query "properties.template.containers[?name=='${WORKER_CONTAINER_NAME}'] | [0].image" \
  -o tsv 2>/dev/null || echo "")
worker_repo=$(printf '%s' "${worker_image}" | sed -E 's#.*/([^/:]+):.*#\1#')
if [ "${worker_repo}" != "vaultspace-worker" ]; then
  echo "  ERROR: ${WORKER_APP} runs image '${worker_image}' (repo '${worker_repo:-<none>}'); expected the 'vaultspace-worker' image."
  echo "         The web image boots node server.js, not the BullMQ worker, so the queue would not drain."
  errors=$((errors + 1))
else
  echo "  OK: image repo is vaultspace-worker"
fi

# Defense in depth: if the worker is ever (mis)pointed at the web image again, the
# web entrypoint runs migration/RLS DDL as the low-privilege runtime role and
# crash-loops on "must be owner of table". ENABLE_RLS=false makes that entrypoint
# skip the DDL step. It is a harmless no-op for the correct worker image (which
# does not run docker-entrypoint.sh) and does not affect runtime RLS enforcement
# (isRLSEnabled() stays true under NODE_ENV=production).
echo ""
echo "=== Validating ${WORKER_APP} ENABLE_RLS ==="
worker_enable_rls=$(az containerapp show \
  --name "${WORKER_APP}" \
  --resource-group "${RG}" \
  --query "properties.template.containers[?name=='${WORKER_CONTAINER_NAME}'] | [0].env[?name=='ENABLE_RLS'].value | [0]" \
  -o tsv 2>/dev/null || echo "")
if [ "${worker_enable_rls}" != "false" ]; then
  echo "  ERROR: ${WORKER_APP} must set ENABLE_RLS=false (found: '${worker_enable_rls:-<unset>}')"
  errors=$((errors + 1))
else
  echo "  OK: ENABLE_RLS=false"
fi

# Probes: the worker has no HTTP ingress, so the only signal that distinguishes
# a healthy worker from a crash-looping one is the TCP socket on port 3000.
# Require at least one probe on that port.
echo ""
echo "=== Validating ${WORKER_APP} probes ==="
worker_probes=$(az containerapp show \
  --name "${WORKER_APP}" \
  --resource-group "${RG}" \
  --query "properties.template.containers[?name=='${WORKER_CONTAINER_NAME}'].probes | [0]" \
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
