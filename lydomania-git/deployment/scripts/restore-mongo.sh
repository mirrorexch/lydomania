#!/usr/bin/env bash
# =====================================================================
# restore-mongo.sh — restore a previous mongodump archive.
#   Usage:  ./scripts/restore-mongo.sh backups/lydomania-YYYYMMDD-HHMMSS.archive.gz
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
    echo "Usage: $0 <backup-file.archive.gz>"
    echo ""
    echo "Available backups:"
    ls -lh ./backups/lydomania-*.archive.gz 2>/dev/null || echo "  (none — run ./scripts/backup-mongo.sh first)"
    exit 1
fi

set -a; . ./.env; set +a

echo "⚠  This will DROP existing collections in db=${DB_NAME:-lydomania} and restore from:"
echo "       $FILE"
read -rp "Type 'yes' to confirm: " ack
[[ "$ack" == "yes" ]] || { echo "Aborted."; exit 1; }

docker compose exec -T mongo mongorestore \
    --archive --gzip --drop \
    --nsInclude "${DB_NAME:-lydomania}.*" \
    --username "$MONGO_INITDB_ROOT_USERNAME" \
    --password "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin < "$FILE"

echo "✓ Restore complete."
