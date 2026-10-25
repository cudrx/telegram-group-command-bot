#!/usr/bin/env bash
set -euo pipefail
: "${BOT_IMAGE:?BOT_IMAGE is required}"
: "${VIDEO_IMAGE:?VIDEO_IMAGE is required}"
: "${GALLERY_IMAGE:?GALLERY_IMAGE is required}"
for image in "$BOT_IMAGE" "$VIDEO_IMAGE" "$GALLERY_IMAGE"; do
  docker run --rm --init -i --entrypoint node "$image" \
    --input-type=module < .github/smoke.mjs
done
