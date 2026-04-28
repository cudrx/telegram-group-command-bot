#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${SERVER_GHCR_USERNAME:?SERVER_GHCR_USERNAME is required}"
: "${SERVER_GHCR_TOKEN:?SERVER_GHCR_TOKEN is required}"

mkdir -p "${DEPLOY_PATH}/data"

cd "${DEPLOY_PATH}"

echo "${SERVER_GHCR_TOKEN}" | docker login ghcr.io -u "${SERVER_GHCR_USERNAME}" --password-stdin

IMAGE_TAG="${IMAGE_TAG}" docker compose --env-file .env -f compose.yml pull bot
IMAGE_TAG="${IMAGE_TAG}" docker compose --env-file .env -f compose.yml up -d bot

docker image prune -a -f
