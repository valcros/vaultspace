#!/usr/bin/env bash
#
# Validate that every Container App in the VaultSpace environment has the
# required environment variables wired up. Designed for the deploy pipeline:
# fails the deploy when an env var is missing instead of letting a worker
# crash-loop silently behind a "Healthy" status.
#
# Usage:
#   scripts/validate-container-env.sh <resource-group> <web-app-name> <web-container-name> \
#     <worker-app-name> <worker-container-name> <waker-job-name> <waker-container-name> \
#     <lifecycle-job-name> [reset-reconciler-job-name]

set -euo pipefail

image_repository() {
  local image_reference="${1:?image reference is required}"
  local image_without_digest="${image_reference%%@*}"
  local repository_with_optional_tag="${image_without_digest##*/}"

  printf '%s\n' "${repository_with_optional_tag%%:*}"
}

# Permit focused tests to source the production parser without executing live
# Azure validation. Direct execution continues below.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi

RG="${1:?resource group is required}"
WEB_APP="${2:?web Container App name is required}"
WEB_CONTAINER_NAME="${3:?web container name is required}"
WORKER_APP="${4:?worker Container App name is required}"
WORKER_CONTAINER_NAME="${5:?worker container name is required}"
WAKER_JOB="${6:?delayed waker Container Apps Job name is required}"
WAKER_CONTAINER_NAME="${7:?delayed waker container name is required}"
LIFECYCLE_JOB="${8:?invitation lifecycle Container Apps Job name is required}"
RESET_RECONCILER_JOB="${9:-}"

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

WORKER_FORBIDDEN=(
  DATABASE_URL_ADMIN
  # Redis runtime authentication is part of REDIS_URL. This independent legacy
  # password binding is unused and must not remain as a second credential path.
  REDIS_PASSWORD
)

# Vars whose value MUST come from a Key Vault secretRef (never plaintext).
SECRET_BACKED=(
  SESSION_SECRET
  DATABASE_URL
  DATABASE_URL_ADMIN
  REDIS_URL
  AZURE_STORAGE_ACCOUNT_KEY
  ACS_CONNECTION_STRING
  PASSWORD_RESET_RECOVERY_KEYS
)

errors=0

WAKER_REQUIRED=(
  REDIS_URL
)

LIFECYCLE_REQUIRED=(
  DATABASE_URL
  DATABASE_URL_ADMIN
  ACS_CONNECTION_STRING
)

RESET_RECONCILER_REQUIRED=(
  DATABASE_URL
  REDIS_URL
  SESSION_SECRET
  PASSWORD_RESET_RECOVERY_KEYS
)

RESET_RECONCILER_FORBIDDEN=(
  DATABASE_URL_ADMIN
)

is_secret_backed() {
  local candidate="$1"
  local secret_var
  for secret_var in "${SECRET_BACKED[@]}"; do
    if [ "$candidate" = "$secret_var" ]; then
      return 0
    fi
  done
  return 1
}

is_key_vault_url() {
  local key_vault_url="$1"
  [[ "$key_vault_url" =~ ^https://[A-Za-z0-9-]+\.vault\.azure\.net/secrets/[A-Za-z0-9-]+(/[^/?#]+)?$ ]]
}

is_managed_identity() {
  local identity="$1"
  [ "$identity" = "system" ] || [[ "$identity" =~ ^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft.ManagedIdentity/userAssignedIdentities/[^/]+$ ]]
}

get_workload_json() {
  local kind="$1"
  local workload="$2"
  if [ "$kind" = "app" ]; then
    az containerapp show \
      --name "${workload}" \
      --resource-group "${RG}" \
      --output json
  else
    az containerapp job show \
      --name "${workload}" \
      --resource-group "${RG}" \
      --output json
  fi
}

check_workload() {
  local kind="$1"
  local workload="$2"
  local container_name="$3"
  shift 3
  local required_vars=("$@")

  echo ""
  echo "=== Validating ${kind} ${workload} ==="

  # Read configuration metadata only. Do not request or print secret values.
  local workload_json env_json
  workload_json=$(get_workload_json "$kind" "$workload")
  if [ "$container_name" = "__first__" ]; then
    env_json=$(echo "${workload_json}" | jq -c \
      '.properties.template.containers[0].env // empty')
  else
    env_json=$(echo "${workload_json}" | jq -c --arg container "$container_name" \
      '[.properties.template.containers[] | select(.name == $container) | (.env // [])] | first // empty')
  fi

  if [ -z "$env_json" ]; then
    echo "  ERROR: ${workload} missing expected container: ${container_name}"
    errors=$((errors + 1))
    return
  fi

  for var in "${required_vars[@]}"; do
    local entry entry_count
    entry_count=$(echo "${env_json}" | jq --arg var "$var" '[.[] | select(.name == $var)] | length')
    entry=$(echo "${env_json}" | jq -c --arg var "$var" '[.[] | select(.name == $var)] | first // empty')

    if [ -z "${entry}" ]; then
      echo "  ERROR: ${workload} missing required env var: ${var}"
      errors=$((errors + 1))
      continue
    fi

    if [ "$entry_count" -ne 1 ]; then
      echo "  ERROR: ${workload} has duplicate env var: ${var}"
      errors=$((errors + 1))
      continue
    fi

    if is_secret_backed "$var"; then
      local secret_ref has_literal secret_metadata key_vault_url identity
      secret_ref=$(echo "${entry}" | jq -r '.secretRef // empty')
      has_literal=$(echo "${entry}" | jq -r 'has("value") and (.value != null) and (.value != "")')

      if [ -z "${secret_ref}" ]; then
        echo "  ERROR: ${workload} ${var} must use a secretRef"
        errors=$((errors + 1))
        continue
      fi
      if [ "${has_literal}" != "false" ]; then
        echo "  ERROR: ${workload} ${var} must not include a literal value"
        errors=$((errors + 1))
        continue
      fi

      secret_metadata=$(echo "${workload_json}" | jq -c --arg ref "$secret_ref" \
        '[(.properties.configuration.secrets // [])[] | select(.name == $ref)] | first // empty')
      if [ -z "${secret_metadata}" ]; then
        echo "  ERROR: ${workload} ${var} references an undefined secret"
        errors=$((errors + 1))
        continue
      fi

      key_vault_url=$(echo "${secret_metadata}" | jq -r '.keyVaultUrl // empty')
      identity=$(echo "${secret_metadata}" | jq -r '.identity // empty')
      if ! is_key_vault_url "$key_vault_url"; then
        echo "  ERROR: ${workload} ${var} must resolve through an Azure Key Vault secret"
        errors=$((errors + 1))
        continue
      fi
      if ! is_managed_identity "$identity"; then
        echo "  ERROR: ${workload} ${var} Key Vault reference must use a managed identity"
        errors=$((errors + 1))
        continue
      fi
    fi

    echo "  OK: ${var}"
  done
}

check_workload app "${WEB_APP}" "${WEB_CONTAINER_NAME}" "${SHARED_REQUIRED[@]}" "${WEB_ONLY_REQUIRED[@]}"
check_workload app "${WORKER_APP}" "${WORKER_CONTAINER_NAME}" "${SHARED_REQUIRED[@]}" "${WORKER_ONLY_REQUIRED[@]}"
check_workload job "${WAKER_JOB}" "${WAKER_CONTAINER_NAME}" "${WAKER_REQUIRED[@]}"
check_workload job "${LIFECYCLE_JOB}" "__first__" "${LIFECYCLE_REQUIRED[@]}"
if [ -n "${RESET_RECONCILER_JOB}" ]; then
  check_workload job "${RESET_RECONCILER_JOB}" "__first__" "${RESET_RECONCILER_REQUIRED[@]}"
fi

worker_env_json=$(az containerapp show \
  --name "${WORKER_APP}" \
  --resource-group "${RG}" \
  --query "properties.template.containers[?name=='${WORKER_CONTAINER_NAME}'] | [0].env" \
  -o json)
for var in "${WORKER_FORBIDDEN[@]}"; do
  if echo "${worker_env_json}" | jq -e --arg var "${var}" '.[] | select(.name == $var)' >/dev/null; then
    echo "  ERROR: ${WORKER_APP} has forbidden runtime env var: ${var}"
    errors=$((errors + 1))
  else
    echo "  OK: ${var} is absent from runtime worker"
  fi
done

if [ -n "${RESET_RECONCILER_JOB}" ]; then
  reset_reconciler_env_json=$(az containerapp job show \
    --name "${RESET_RECONCILER_JOB}" \
    --resource-group "${RG}" \
    --query "properties.template.containers[0].env" \
    -o json)
  for var in "${RESET_RECONCILER_FORBIDDEN[@]}"; do
    if echo "${reset_reconciler_env_json}" | jq -e --arg var "${var}" '.[] | select(.name == $var)' >/dev/null; then
      echo "  ERROR: ${RESET_RECONCILER_JOB} has forbidden runtime env var: ${var}"
      errors=$((errors + 1))
    else
      echo "  OK: ${var} is absent from password reset reconciler"
    fi
  done
fi

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
worker_repo=$(image_repository "${worker_image}")
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
