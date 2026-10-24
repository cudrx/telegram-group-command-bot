#!/usr/bin/env bash
set -euo pipefail

: "${BOT_IMAGE:?BOT_IMAGE is required}"
: "${VIDEO_IMAGE:?VIDEO_IMAGE is required}"
: "${GALLERY_IMAGE:?GALLERY_IMAGE is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${DEPLOY_METADATA_FILE:?DEPLOY_METADATA_FILE is required}"
namespace=telegram-bot
for image in "$BOT_IMAGE" "$VIDEO_IMAGE" "$GALLERY_IMAGE"; do
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Deployment requires image digests' >&2; exit 1; }
done

previous="$(kubectl -n "$namespace" get deployment telegram-bot --ignore-not-found -o name)"
METADATA_CONFIGMAP="$(kubectl -n "$namespace" create configmap "deploy-metadata-${IMAGE_TAG}" \
  --from-file="deploy-metadata.json=${DEPLOY_METADATA_FILE}" --append-hash --dry-run=client -o yaml \
  | kubectl -n "$namespace" apply -f - -o jsonpath='{.metadata.name}')"
export METADATA_CONFIGMAP

manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
envsubst '${BOT_IMAGE} ${VIDEO_IMAGE} ${GALLERY_IMAGE} ${IMAGE_TAG} ${METADATA_CONFIGMAP}' < .github/deployment.yml > "$manifest"
kubectl -n "$namespace" apply -f "$manifest"

if ! kubectl -n "$namespace" rollout status deployment/telegram-bot --timeout=300s; then
  kubectl -n "$namespace" get pods
  if [[ -n "$previous" ]]; then
    kubectl -n "$namespace" rollout undo deployment/telegram-bot
    kubectl -n "$namespace" rollout status deployment/telegram-bot --timeout=300s
  fi
  exit 1
fi
