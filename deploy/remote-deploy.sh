#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${SERVER_GHCR_USERNAME:?SERVER_GHCR_USERNAME is required}"
: "${SERVER_GHCR_TOKEN:?SERVER_GHCR_TOKEN is required}"

mkdir -p "${DEPLOY_PATH}/data"

cd "${DEPLOY_PATH}"

echo "${SERVER_GHCR_TOKEN}" | docker login ghcr.io -u "${SERVER_GHCR_USERNAME}" --password-stdin

previous_container_id="$(docker compose --env-file .env -f compose.yml ps -q bot 2>/dev/null || true)"
previous_image_ref=""

if [[ -n "${previous_container_id}" ]]; then
  previous_image_ref="$(docker inspect --format='{{.Config.Image}}' "${previous_container_id}")"
fi

IMAGE_TAG="${IMAGE_TAG}" docker compose --env-file .env -f compose.yml pull bot

if ! IMAGE_TAG="${IMAGE_TAG}" docker compose --env-file .env -f compose.yml up -d --wait --wait-timeout 30 bot; then
  if [[ -n "${previous_image_ref}" && "${previous_image_ref}" == *:* ]]; then
    previous_image_tag="${previous_image_ref##*:}"
    echo "Deploy failed; restoring image ${previous_image_ref}" >&2
    IMAGE_TAG="${previous_image_tag}" docker compose --env-file .env -f compose.yml up -d --wait --wait-timeout 30 bot
  fi

  exit 1
fi

docker image prune -f
