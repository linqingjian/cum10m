#!/usr/bin/env python3
import hashlib
import subprocess
import sys

if len(sys.argv) < 2:
    print("Usage: get-extension-id.py /path/to/extension.pem", file=sys.stderr)
    sys.exit(1)

pem_path = sys.argv[1]

try:
    der = subprocess.check_output(
        ["openssl", "rsa", "-in", pem_path, "-pubout", "-outform", "DER"],
        stderr=subprocess.DEVNULL,
    )
except Exception as exc:
    print(f"Failed to read public key: {exc}", file=sys.stderr)
    sys.exit(1)

hex_digest = hashlib.sha256(der).hexdigest()[:32]
alpha = "abcdefghijklmnop"
ext_id = "".join(alpha[int(ch, 16)] for ch in hex_digest)
print(ext_id)
