#!/usr/bin/env bash
# =====================================================================
# update.sh — pull latest code, rebuild, restart.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
cd ..   # repo root

if [[ -d .git ]]; then
    echo "→ git pull"
    git pull --ff-only
fi

cd deployment

echo "→ docker compose build"
docker compose build --pull

echo "→ docker compose up -d"
docker compose up -d

echo ""
echo "✓ Update complete.  Tail logs:  docker compose logs -f"
