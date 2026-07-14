#!/usr/bin/env bash
#
# Renew (re-issue) the *.vaultspace.org wildcard TLS certificate and bind it to
# the web Container App ingress.
#
# Why this exists: Azure Container Apps managed certificates cannot cover a
# wildcard, so the wildcard must be an externally issued cert. The first one
# lapsed because nothing renewed it. This script is the renewal path, run on a
# schedule by .github/workflows/renew-wildcard-cert.yml using the repo's Azure
# OIDC identity (Contributor on the resource group).
#
# It is idempotent and safe to run repeatedly: it issues a fresh Let's Encrypt
# cert via DNS-01 (Azure DNS), uploads it under a date-stamped name, and rebinds
# the wildcard host to the new cert. It does NOT delete old certs (repo policy
# requires explicit approval for Azure resource deletion); prune unbound old
# wildcard certs manually during a maintenance window.
#
# Required environment (provided by the workflow from GitHub variables/secrets):
#   RESOURCE_GROUP      - resource group holding the Container Apps env + DNS zone
#   WEB_CONTAINER_APP   - name of the web Container App (ingress host binding)
#   DOMAIN              - apex domain (default: vaultspace.org)
#
# Requires an authenticated `az` session (azure/login OIDC) before running.

set -euo pipefail

RG="${RESOURCE_GROUP:?RESOURCE_GROUP is required}"
WEB="${WEB_CONTAINER_APP:?WEB_CONTAINER_APP is required}"
DOMAIN="${DOMAIN:-vaultspace.org}"
WILDCARD="*.${DOMAIN}"
EMAIL="${ACME_EMAIL:-mmunger@markmunger.com}"

echo "==> Deriving Container Apps environment from ${WEB}"
ENV_ID="$(az containerapp show -n "$WEB" -g "$RG" --query properties.environmentId -o tsv)"
ENV_NAME="$(basename "$ENV_ID")"
SUB_ID="$(az account show --query id -o tsv)"
echo "    env=${ENV_NAME} subscription=${SUB_ID}"

echo "==> Ensuring acme.sh is installed"
ACME="${HOME}/.acme.sh/acme.sh"
if [ ! -f "$ACME" ]; then
  curl -fsS https://get.acme.sh | sh -s "email=${EMAIL}"
fi

echo "==> Issuing ${WILDCARD} via Let's Encrypt DNS-01 (Azure DNS)"
# acme.sh's Azure plugin accepts a short-lived ARM bearer token directly, so we
# reuse the OIDC session's token instead of a long-lived service principal secret.
export AZUREDNS_SUBSCRIPTIONID="$SUB_ID"
export AZUREDNS_BEARERTOKEN
AZUREDNS_BEARERTOKEN="$(az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv)"

"$ACME" --issue --dns dns_azure \
  -d "$DOMAIN" -d "$WILDCARD" \
  --server letsencrypt --force

CDIR="${HOME}/.acme.sh/${DOMAIN}_ecc"
WORK="$(mktemp -d)"
PFX="${WORK}/wildcard.pfx"
PFX_PASS="$(openssl rand -base64 24)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Packaging PFX"
openssl pkcs12 -export -out "$PFX" \
  -inkey "${CDIR}/${DOMAIN}.key" -in "${CDIR}/fullchain.cer" \
  -passout pass:"$PFX_PASS"

CERT_NAME="wildcard-$(echo "$DOMAIN" | tr '.' '-')-$(date +%Y%m%d)"
echo "==> Uploading cert to environment as ${CERT_NAME}"
az containerapp env certificate upload -n "$ENV_NAME" -g "$RG" \
  --certificate-file "$PFX" --password "$PFX_PASS" \
  --certificate-name "$CERT_NAME" -o none || echo "    (cert ${CERT_NAME} may already exist for today; continuing to bind)"

CERT_ID="$(az containerapp env certificate list -n "$ENV_NAME" -g "$RG" \
  --query "[?name=='${CERT_NAME}'].id" -o tsv)"
if [ -z "$CERT_ID" ]; then
  echo "ERROR: could not resolve uploaded certificate id for ${CERT_NAME}" >&2
  exit 1
fi

echo "==> Binding ${WILDCARD} to ${CERT_NAME}"
az containerapp hostname bind -n "$WEB" -g "$RG" \
  --hostname "$WILDCARD" --environment "$ENV_NAME" \
  --certificate "$CERT_ID" -o none

echo "==> Done. ${WILDCARD} now served by ${CERT_NAME}."
