#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="${EXT_DIR:-$ROOT_DIR/chrome-extension}"
KEY_DIR="${KEY_DIR:-$ROOT_DIR/keys}"
KEY_PATH="${KEY_PATH:-$KEY_DIR/extension.pem}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/dist}"

CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$CHROME_BIN" ]]; then
  CHROME_BIN="$(command -v google-chrome || command -v google-chrome-stable || command -v chrome || true)"
fi

if [[ -z "$CHROME_BIN" ]]; then
  echo "Chrome binary not found. Set CHROME_BIN to your Chrome executable." >&2
  exit 1
fi

mkdir -p "$KEY_DIR" "$OUT_DIR"

if [[ -f "$KEY_PATH" ]]; then
  "$CHROME_BIN" --pack-extension="$EXT_DIR" --pack-extension-key="$KEY_PATH"
else
  "$CHROME_BIN" --pack-extension="$EXT_DIR"
  GENERATED_PEM="${EXT_DIR}.pem"
  if [[ ! -f "$GENERATED_PEM" ]]; then
    echo "Failed to generate extension key: $GENERATED_PEM not found." >&2
    exit 1
  fi
  mv "$GENERATED_PEM" "$KEY_PATH"
fi

GENERATED_CRX="${EXT_DIR}.crx"
if [[ ! -f "$GENERATED_CRX" ]]; then
  echo "Failed to build CRX: $GENERATED_CRX not found." >&2
  exit 1
fi

OUT_CRX="$OUT_DIR/ai-assistant.crx"
mv "$GENERATED_CRX" "$OUT_CRX"

echo "$OUT_CRX"
