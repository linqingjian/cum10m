#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def load_version(manifest_path: Path) -> str:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = data.get("version")
    if not version:
        raise SystemExit("manifest.json is missing version")
    return version


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--crx-url", required=True)
    parser.add_argument("--manifest", default="chrome-extension/manifest.json")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    version = load_version(Path(args.manifest))
    xml = (
        "<?xml version='1.0' encoding='UTF-8'?>\n"
        "<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n"
        f"  <app appid='{args.app_id}'>\n"
        f"    <updatecheck codebase='{args.crx_url}' version='{version}' />\n"
        "  </app>\n"
        "</gupdate>\n"
    )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(xml, encoding="utf-8")


if __name__ == "__main__":
    main()
