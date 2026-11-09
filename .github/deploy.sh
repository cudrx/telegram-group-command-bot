#!/usr/bin/env bash
set -Eeuo pipefail

docker --context rootless info --format '{{json .SecurityOptions}}' | grep -q '"name=rootless"' || {
  echo 'A running rootless Docker daemon is required' >&2; exit 1;
}
compose() { docker --context rootless compose --env-file images.env -f compose.yml "$@"; }
trap 'compose ps --all; compose logs --no-color --tail=100' ERR

compose config --quiet
compose pull
compose run --rm --no-deps --entrypoint node bot --input-type=module -e \
  'import { getEnv } from "./dist/src/config/env/index.js"; getEnv();'
compose stop --timeout 30
compose up --detach --no-build --wait --wait-timeout 300
