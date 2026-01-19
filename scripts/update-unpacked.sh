#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if git -C "$ROOT_DIR" diff --quiet; then
  git -C "$ROOT_DIR" pull --ff-only
else
  echo "Working tree has local changes. Please commit/stash before pulling." >&2
  exit 1
fi

open -a "Google Chrome" "chrome://extensions/"

echo "✅ 更新完成：请在 Chrome 扩展页点击 '重新加载'。"
