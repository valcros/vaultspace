#!/usr/bin/env bash

set -euo pipefail

required_vars=(
  APP_URL
  DEPLOY_SHA
  GITHUB_RUN_ATTEMPT
  GITHUB_RUN_ID
  RESOURCE_GROUP
  RUNNER_TEMP
  TARGET_WEB_IMAGE_PINNED
  WEB_CONTAINER_APP
  WEB_CONTAINER_NAME
)

for var_name in "${required_vars[@]}"; do
  if [ -z "${!var_name:-}" ]; then
    echo "ERROR: ${var_name} is required for forward web convergence verification" >&2
    exit 1
  fi
done

TIMEOUT_SECONDS="${WEB_CONVERGENCE_TIMEOUT_SECONDS:-210}"
MAX_ATTEMPTS="${WEB_CONVERGENCE_MAX_ATTEMPTS:-20}"
RETRY_SECONDS="${WEB_CONVERGENCE_RETRY_SECONDS:-10}"

for numeric_value in "$TIMEOUT_SECONDS" "$MAX_ATTEMPTS" "$RETRY_SECONDS"; do
  if ! [[ "$numeric_value" =~ ^[0-9]+$ ]]; then
    echo "ERROR: web convergence retry controls must be non-negative integers" >&2
    exit 1
  fi
done

if [ "$TIMEOUT_SECONDS" -le 0 ] || [ "$MAX_ATTEMPTS" -le 0 ]; then
  echo "ERROR: web convergence timeout and attempt count must be greater than zero" >&2
  exit 1
fi

START_SECONDS=$SECONDS
DEADLINE_SECONDS=$((START_SECONDS + TIMEOUT_SECONDS))
LAST_ERROR="web convergence was not evaluated"

verify_attempt() {
  local attempt="$1"
  local file_prefix="$RUNNER_TEMP/post-deploy-web-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${attempt}"
  local header_file="${file_prefix}-headers.txt"
  local body_file="${file_prefix}-body.json"
  local verifier_error_file="${file_prefix}-verification.log"
  local web_revision
  local web_image
  local active_web_revisions
  local traffic_json
  local cache_control
  local health_body
  local health_status
  local convergence_input

  if ! web_revision=$(az containerapp show \
    --name "$WEB_CONTAINER_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --query properties.latestRevisionName \
    --output tsv 2>"${file_prefix}-latest-revision.log"); then
    LAST_ERROR="latest Azure web revision query failed"
    return 1
  fi

  if ! web_image=$(az containerapp revision show \
    --name "$WEB_CONTAINER_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --revision "$web_revision" \
    --query "properties.template.containers[?name=='$WEB_CONTAINER_NAME'].image | [0]" \
    --output tsv 2>"${file_prefix}-image.log"); then
    LAST_ERROR="immutable Azure web image query failed"
    return 1
  fi

  if ! active_web_revisions=$(az containerapp revision list \
    --name "$WEB_CONTAINER_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --query '[?properties.active].name' \
    --output json 2>"${file_prefix}-active-revisions.log"); then
    LAST_ERROR="active Azure web revisions query failed"
    return 1
  fi

  if ! traffic_json=$(az containerapp ingress traffic show \
    --name "$WEB_CONTAINER_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --output json 2>"${file_prefix}-traffic.log"); then
    LAST_ERROR="Azure web traffic query failed"
    return 1
  fi

  if ! curl -fsS --max-time 15 \
    -H "Cache-Control: no-cache" \
    -H "Pragma: no-cache" \
    -D "$header_file" \
    -o "$body_file" \
    "$APP_URL/api/health?post_deploy_gate=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${attempt}-${DEPLOY_SHA}" \
    2>"${file_prefix}-health-request.log"; then
    LAST_ERROR="quick uncached public health request failed"
    return 1
  fi

  cache_control=$(awk \
    'BEGIN { IGNORECASE=1 } /^cache-control:/ { sub(/\r$/, ""); sub(/^[^:]*:[[:space:]]*/, ""); value=$0 } END { print value }' \
    "$header_file")
  health_body=$(<"$body_file")
  if ! health_status=$(printf '%s' "$health_body" | jq -er '.status | strings' \
    2>"${file_prefix}-health-json.log"); then
    LAST_ERROR="quick public health response is not valid identity JSON"
    return 1
  fi
  if [ "$health_status" != "healthy" ]; then
    LAST_ERROR="quick public health status is not healthy"
    return 1
  fi

  if ! convergence_input=$(jq -cn \
    --arg revision "$web_revision" \
    --arg image "$web_image" \
    --arg expectedImage "$TARGET_WEB_IMAGE_PINNED" \
    --arg expectedRelease "$DEPLOY_SHA" \
    --argjson activeWebRevisions "$active_web_revisions" \
    --argjson traffic "$traffic_json" \
    --arg cacheControl "$cache_control" \
    --argjson healthBody "$health_body" \
    '{
      convergence: {
        revision: $revision,
        image: $image,
        expectedImage: $expectedImage,
        expectedRelease: $expectedRelease,
        activeWebRevisions: $activeWebRevisions,
        traffic: $traffic,
        latestRevisionName: $revision,
        cacheControl: $cacheControl,
        healthBody: $healthBody
      }
    }' 2>"${file_prefix}-convergence-input.log"); then
    LAST_ERROR="Azure and quick-health convergence evidence is not valid JSON"
    return 1
  fi

  if ! printf '%s' "$convergence_input" | \
    node scripts/verify-password-reset-deployment-contract.mjs \
      >/dev/null 2>"$verifier_error_file"; then
    LAST_ERROR=$(<"$verifier_error_file")
    return 1
  fi

  echo "✓ Web revision $web_revision is healthy, sole active, exact-image, exact-release, and at 100 percent traffic after attempt $attempt"
  return 0
}

for ((ATTEMPT = 1; ATTEMPT <= MAX_ATTEMPTS; ATTEMPT += 1)); do
  if verify_attempt "$ATTEMPT"; then
    exit 0
  fi

  echo "Web convergence not ready (attempt $ATTEMPT/$MAX_ATTEMPTS): $LAST_ERROR"

  if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ] || [ "$SECONDS" -ge "$DEADLINE_SECONDS" ]; then
    break
  fi

  remaining_seconds=$((DEADLINE_SECONDS - SECONDS))
  sleep_seconds="$RETRY_SECONDS"
  if [ "$sleep_seconds" -gt "$remaining_seconds" ]; then
    sleep_seconds="$remaining_seconds"
  fi
  if [ "$sleep_seconds" -gt 0 ]; then
    sleep "$sleep_seconds"
  fi
done

echo "ERROR: target web did not satisfy the strict convergence contract within ${TIMEOUT_SECONDS} seconds: $LAST_ERROR" >&2
exit 1
