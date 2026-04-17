#!/usr/bin/env python3
"""Generate an scrypt hash for a password, suitable for the ADMIN_PASSWORD or
USER_* environment variables on Render.

Usage:
    python3 hash_password.py <password>

Copy the output (starts with `scrypt$`) into the env var value. The server
accepts both scrypt-hashed and plaintext values during migration, but plaintext
logs a warning on every login.
"""
import sys
from server import hash_password

if len(sys.argv) != 2 or sys.argv[1] in ('-h', '--help'):
    print('Usage: python3 hash_password.py <password>', file=sys.stderr)
    sys.exit(1)

print(hash_password(sys.argv[1]))
