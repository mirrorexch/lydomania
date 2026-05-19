#!/usr/bin/env bash
# =====================================================================
# rotate-secrets.sh
#   Generates fresh values for the secret-bearing env vars and writes
#   them into .env in-place.  Run once on first deploy, then again any
#   time you suspect a leak.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    cp .env.example .env
    echo "  ➜  created .env from .env.example"
fi

write_var() {
    local key="$1" value="$2"
    if grep -q "^${key}=" .env; then
        # macOS sed needs the empty backup arg; we run on Linux only here
        sed -i "s|^${key}=.*|${key}=${value}|" .env
    else
        echo "${key}=${value}" >> .env
    fi
    echo "  ➜  rotated ${key}"
}

# 64-char hex == 256-bit entropy
hex_secret() { openssl rand -hex 32; }

# Fernet keys are 32 raw bytes, base64-urlsafe-encoded
fernet_key() { python3 -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"; }

echo "Rotating production secrets…"
write_var JWT_SECRET                "$(hex_secret)"
write_var INTERNAL_API_SECRET       "$(hex_secret)"
write_var ADMIN_API_KEY             "$(hex_secret)"
write_var SETTINGS_ENCRYPTION_KEY   "$(fernet_key)"
write_var MONGO_INITDB_ROOT_PASSWORD "$(hex_secret)"

echo ""
echo "✓ Secrets rotated.  Restart the stack to apply:"
echo "    docker compose up -d --force-recreate backend bot mongo"
echo ""
echo "  ⚠  Rotating JWT_SECRET invalidates every existing user session."
