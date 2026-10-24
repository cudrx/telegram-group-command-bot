#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE_PREFIX:?IMAGE_PREFIX is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
for suffix in '' '-video' '-gallery'; do
  docker run --rm --init -i --entrypoint node "${IMAGE_PREFIX}${suffix}:${IMAGE_TAG}" \
    --input-type=module < .github/smoke.mjs
done
