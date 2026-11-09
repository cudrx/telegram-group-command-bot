#!/usr/bin/env bash
set -Eeuo pipefail

compose() { docker compose --env-file images.env -f compose.yml "$@"; }
trap 'compose ps --all; compose logs --no-color --tail=100' ERR

compose config --quiet
compose pull
compose run --rm --no-deps --entrypoint node bot --input-type=module -e \
  'import { getEnv } from "./dist/src/config/env/index.js"; getEnv();'
compose stop --timeout 30
compose up --detach --no-build --wait --wait-timeout 300
