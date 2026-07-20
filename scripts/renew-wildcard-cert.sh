#!/usr/bin/env bash
#
# Renew (re-issue) the *.vaultspace.org wildcard TLS certificate and bind it to
# the web Container App ingress.
#
# Why this exists: Azure Container Apps managed certificates cannot cover a
# wildcard, so the wildcard must be an externally issued cert. The first one
# lapsed because nothing renewed it -- and, just as importantly, nothing NOTICED
# it had lapsed. This script is the renewal path, run on a schedule by
# .github/workflows/renew-wildcard-cert.yml using the repo's Azure OIDC identity
# (Contributor on the resource group).
#
# Reliability contract (this is the point of the script, so read it):
#   * It only issues when the currently-served cert is within RENEW_THRESHOLD_DAYS
#     of expiry, unless FORCE_RENEW=true. This protects the Let's Encrypt
#     production rate limit against repeated dispatches.
#   * Every certificate is uploaded under a UNIQUE name (UTC timestamp), so
#     same-day reruns never collide and never silently bind a stale cert.
#   * Upload failures are FATAL (no error swallowing) so auth/quota/PFX problems
#     surface instead of hiding behind a rebind of the wrong cert.
#   * After binding it VERIFIES the endpoint is actually serving the newly issued
#     leaf (SHA-256 fingerprint match, with retry/backoff). A successful TLS
#     handshake alone is NOT accepted -- the old cert is still valid, so "some
#     valid TLS" would be a false pass. This is the exact failure mode that let
#     the first cert lapse unnoticed.
#
# It does NOT delete old certs (repo policy requires explicit approval for Azure
# resource deletion); prune unbound old wildcard certs manually in a maintenance
# window.
#
# Deferred hardening (tracked follow-ups, intentionally out of scope here):
#   * Pin acme.sh to a reviewed commit + checksum instead of `curl | sh`.
#   * A dedicated minimal Azure role (DNS TXT + env cert upload + hostname bind)
#     instead of resource-group Contributor.
#   * Automated rollback to the previous binding if verification fails.
#
# Required environment (provided by the workflow from GitHub variables/secrets):
#   RESOURCE_GROUP        - resource group holding the Container Apps env + DNS zone
#   WEB_CONTAINER_APP     - name of the web Container App (ingress host binding)
#   DOMAIN                - apex domain (default: vaultspace.org)
#   FORCE_RENEW           - "true" to reissue regardless of remaining validity
#   RENEW_THRESHOLD_DAYS  - renew only within this many days of expiry (default 30)
#
# Requires an authenticated `az` session (azure/login OIDC) before running.

set -euo pipefail

RG="${RESOURCE_GROUP:?RESOURCE_GROUP is required}"
WEB="${WEB_CONTAINER_APP:?WEB_CONTAINER_APP is required}"
DOMAIN="${DOMAIN:-vaultspace.org}"
WILDCARD="*.${DOMAIN}"
EMAIL="${ACME_EMAIL:-mmunger@markmunger.com}"
FORCE_RENEW="${FORCE_RENEW:-false}"
RENEW_THRESHOLD_DAYS="${RENEW_THRESHOLD_DAYS:-30}"
# A throwaway subdomain: the wildcard cert + wildcard DNS make it resolve and be
# served without depending on any specific tenant existing.
VERIFY_HOST="renewcheck.${DOMAIN}"

# --- helpers ----------------------------------------------------------------

# True (0) only if $1 is serving a fully valid public TLS certificate whose leaf
# fingerprint equals $2. Two independent gates, both must hold:
#   1. curl validates the chain + hostname against the system trust store and
#      returns nonzero on ANY TLS failure (unreachable, untrusted, expired,
#      hostname mismatch). This is the "must be a real TLS success, not a 000
#      connection failure" check -- HTTP status is irrelevant, so no -f.
#   2. openssl extracts the served leaf fingerprint to prove it is the exact cert
#      we just issued (not the still-valid previous cert).
# Called only from an `if`, so `set -e` is suppressed inside it; a failed pipeline
# yields an empty $got and a normal false return, never a spurious match.
verify_served() {
  local host="$1" want="$2" got
  curl -sS --max-time 20 -o /dev/null "https://${host}/" || return 1
  got="$(echo | timeout 20 openssl s_client -connect "${host}:443" -servername "${host}" 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null \
    | sed 's/.*=//; s/://g' | tr 'A-F' 'a-f')"
  [ -n "$got" ] && [ "$got" = "$want" ]
}

# notAfter of the served leaf cert as a unix epoch, or 0 if unreadable.
served_notafter_epoch() {
  local host="$1" end
  end="$(echo | timeout 20 openssl s_client -connect "${host}:443" -servername "${host}" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//')"
  [ -z "$end" ] && { echo 0; return 0; }
  # GNU date on the runner; BSD fallback for local dev.
  date -u -d "$end" +%s 2>/dev/null || date -u -j -f '%b %e %T %Y %Z' "$end" +%s 2>/dev/null || echo 0
}

# --- expiry gate (cheapest short-circuit; no Azure calls) -------------------

if [ "$FORCE_RENEW" = "true" ]; then
  echo "==> FORCE_RENEW=true; skipping expiry check"
else
  cur_end="$(served_notafter_epoch "$VERIFY_HOST" || echo 0)"
  now="$(date -u +%s)"
  if [ "$cur_end" -gt 0 ]; then
    days_left=$(( (cur_end - now) / 86400 ))
    echo "==> Current cert on ${VERIFY_HOST}: ${days_left} day(s) remaining (threshold ${RENEW_THRESHOLD_DAYS})"
    if [ "$days_left" -gt "$RENEW_THRESHOLD_DAYS" ]; then
      echo "==> Renewal not needed; exiting 0."
      exit 0
    fi
  else
    echo "==> Could not read current cert expiry on ${VERIFY_HOST}; proceeding (fail-safe toward renewal)."
  fi
fi

# --- issue ------------------------------------------------------------------

echo "==> Deriving Container Apps environment from ${WEB}"
ENV_ID="$(az containerapp show -n "$WEB" -g "$RG" --query properties.environmentId -o tsv)"
ENV_NAME="$(basename "$ENV_ID")"
SUB_ID="$(az account show --query id -o tsv)"
echo "    env=${ENV_NAME} subscription=${SUB_ID}"

echo "==> Ensuring acme.sh is installed"
# NOTE: unpinned installer -- see "Deferred hardening" above.
ACME="${HOME}/.acme.sh/acme.sh"
if [ ! -f "$ACME" ]; then
  curl -fsS https://get.acme.sh | sh -s "email=${EMAIL}"
fi

echo "==> Issuing ${WILDCARD} via Let's Encrypt DNS-01 (Azure DNS)"
# acme.sh's Azure plugin accepts a short-lived ARM bearer token directly, so we
# reuse the OIDC session's token instead of a long-lived service principal secret.
export AZUREDNS_SUBSCRIPTIONID="$SUB_ID"
AZUREDNS_BEARERTOKEN="$(az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv)"
# Mask before anything can echo it; the dynamically-minted token is not a
# registered GitHub secret, so it is not auto-redacted otherwise.
echo "::add-mask::${AZUREDNS_BEARERTOKEN}"
export AZUREDNS_BEARERTOKEN

"$ACME" --issue --dns dns_azure \
  -d "$DOMAIN" -d "$WILDCARD" \
  --server letsencrypt --force

# Token is only needed for the DNS-01 challenge; drop it once issuance is done.
unset AZUREDNS_BEARERTOKEN

CDIR="${HOME}/.acme.sh/${DOMAIN}_ecc"
WORK="$(mktemp -d)"
PFX="${WORK}/wildcard.pfx"
PFX_PASS="$(openssl rand -base64 24)"
trap 'rm -rf "$WORK"' EXIT

# Fingerprint of the leaf we just issued; the verify step must see this exact
# cert being served before we call the renewal a success.
NEW_FP="$(openssl x509 -in "${CDIR}/${DOMAIN}.cer" -noout -fingerprint -sha256 \
  | sed 's/.*=//; s/://g' | tr 'A-F' 'a-f')"
echo "==> New leaf fingerprint: ${NEW_FP}"

echo "==> Packaging PFX"
openssl pkcs12 -export -out "$PFX" \
  -inkey "${CDIR}/${DOMAIN}.key" -in "${CDIR}/fullchain.cer" \
  -passout pass:"$PFX_PASS"

# Unique name per run so same-day / concurrent reruns never collide, and an
# upload failure can never be masked by an existing cert of the same name.
CERT_NAME="wildcard-$(echo "$DOMAIN" | tr '.' '-')-$(date -u +%Y%m%d-%H%M%S)"
echo "==> Uploading cert to environment as ${CERT_NAME}"
az containerapp env certificate upload -n "$ENV_NAME" -g "$RG" \
  --certificate-file "$PFX" --password "$PFX_PASS" \
  --certificate-name "$CERT_NAME" -o none

CERT_ID="$(az containerapp env certificate list -n "$ENV_NAME" -g "$RG" \
  --query "[?name=='${CERT_NAME}'].id" -o tsv)"
if [ -z "$CERT_ID" ]; then
  echo "ERROR: could not resolve uploaded certificate id for ${CERT_NAME}" >&2
  exit 1
fi

echo "==> Binding ${WILDCARD} to ${CERT_NAME}"
# `hostname bind` updates the existing wildcard binding atomically; the old cert
# stays served until this returns, so there is no unbound window.
az containerapp hostname bind -n "$WEB" -g "$RG" \
  --hostname "$WILDCARD" --environment "$ENV_NAME" \
  --certificate "$CERT_ID" -o none

# --- verify the NEW cert is actually being served ---------------------------

echo "==> Verifying ${VERIFY_HOST} serves the new cert (valid public TLS + fingerprint match)"
verified=0
for i in $(seq 1 12); do
  if verify_served "$VERIFY_HOST" "$NEW_FP"; then
    echo "    verified on attempt ${i}: sha256=${NEW_FP}"
    verified=1
    break
  fi
  echo "    attempt ${i}/12: ${VERIFY_HOST} not yet serving ${NEW_FP} over valid TLS; retrying in 15s"
  sleep 15
done

if [ "$verified" -ne 1 ]; then
  echo "ERROR: ${VERIFY_HOST} is not serving the newly issued cert after ~3m." >&2
  echo "       The bind call returned success but the ingress is not presenting" >&2
  echo "       ${NEW_FP}. Investigate before the current cert expires." >&2
  exit 1
fi

echo "==> Done. ${WILDCARD} now served by ${CERT_NAME} (verified)."
