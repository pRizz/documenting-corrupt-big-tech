#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_DIR="$ROOT_DIR/.githooks"

mkdir -p "$HOOK_DIR"

if [ ! -x "$HOOK_DIR/pre-commit" ]; then
  echo "pre-commit hook missing or not executable at $HOOK_DIR/pre-commit." >&2
  exit 1
fi

cd "$ROOT_DIR"
git config core.hooksPath .githooks

echo "Configured git hooksPath: .githooks"
echo "pre-commit enforcement enabled"
