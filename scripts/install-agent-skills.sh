#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-"$HOME/.codex"}"
DEST_DIR="${CODEX_AGENT_SKILLS_DIR:-"$ROOT_DIR/.agents/skills"}"
INSTALLER="$CODEX_HOME/skills/.system/skill-installer/scripts/install-skill-from-github.py"

if [[ ! -f "$INSTALLER" ]]; then
  echo "Cannot find Codex skill installer at: $INSTALLER" >&2
  echo "Open Codex once with the skill-installer system skill available, then rerun this script." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

install_missing() {
  local repo="$1"
  shift

  local paths=()
  local path
  local skill_name

  for path in "$@"; do
    skill_name="$(basename "$path")"
    if [[ -d "$DEST_DIR/$skill_name" ]]; then
      echo "Skipping $skill_name; already installed."
    else
      paths+=(--path "$path")
    fi
  done

  if [[ "${#paths[@]}" -eq 0 ]]; then
    return
  fi

  python3 "$INSTALLER" --repo "$repo" --dest "$DEST_DIR" "${paths[@]}"
}

install_missing "wshobson/agents" \
  "plugins/javascript-typescript/skills/nodejs-backend-patterns" \
  "plugins/javascript-typescript/skills/typescript-advanced-types"

install_missing "sickn33/antigravity-awesome-skills" \
  "skills/nodejs-best-practices"

install_missing "antfu/skills" \
  "skills/vitest"

install_missing "pproenca/dot-skills" \
  "skills/.curated/zod"

echo "Agent skills installed into: $DEST_DIR"
echo "Restart Codex to pick up new skills."
