#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 7 ]; then
  echo "usage: worker-revision-ready.sh <active> <health> <provisioning> <running> <replicas> <min-replicas> <active-revisions>" >&2
  exit 2
fi

ACTIVE="$1"
HEALTH="$2"
PROVISIONING="$3"
RUNNING="$4"
REPLICAS="$5"
MIN_REPLICAS="$6"
ACTIVE_REVISIONS="$7"

for value in "$REPLICAS" "$MIN_REPLICAS" "$ACTIVE_REVISIONS"; do
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    exit 1
  fi
done

if [ "$ACTIVE" != "true" ] || \
   [ "$HEALTH" != "Healthy" ] || \
   [ "$PROVISIONING" != "Provisioned" ] || \
   [ "$ACTIVE_REVISIONS" -ne 1 ]; then
  exit 1
fi

case "$RUNNING" in
  Running | RunningAtMaxScale)
    [ "$REPLICAS" -gt 0 ] && [ "$REPLICAS" -ge "$MIN_REPLICAS" ]
    ;;
  ScaledToZero)
    [ "$MIN_REPLICAS" -eq 0 ] && [ "$REPLICAS" -eq 0 ]
    ;;
  *)
    exit 1
    ;;
esac
