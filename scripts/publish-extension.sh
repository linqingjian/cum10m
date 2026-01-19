#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_PATH="${KEY_PATH:-$ROOT_DIR/keys/extension.pem}"
BASE_URL="${BASE_URL:-https://linqingjian.github.io/cum10m/extension}"
OUT_DIR="$ROOT_DIR/docs/extension"

"$ROOT_DIR/scripts/build-crx.sh" >/dev/null

APP_ID="$(python3 "$ROOT_DIR/scripts/get-extension-id.py" "$KEY_PATH")"
CRX_PATH="$ROOT_DIR/dist/ai-assistant.crx"

mkdir -p "$OUT_DIR"
cp "$CRX_PATH" "$OUT_DIR/ai-assistant.crx"
python3 "$ROOT_DIR/scripts/generate-update-manifest.py" \
  --app-id "$APP_ID" \
  --crx-url "$BASE_URL/ai-assistant.crx" \
  --manifest "$ROOT_DIR/chrome-extension/manifest.json" \
  --output "$OUT_DIR/update_manifest.xml"

echo "Published CRX and update_manifest.xml to $OUT_DIR"
