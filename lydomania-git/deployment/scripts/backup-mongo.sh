#!/usr/bin/env bash
# =====================================================================
# backup-mongo.sh — daily MongoDB snapshot.
# Cron:  0 3 * * *  /opt/lydomania/deployment/scripts/backup-mongo.sh
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env so MONGO_INITDB_ROOT_* are present
set -a; . ./.env; set +a

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_N="${BACKUP_RETAIN:-30}"
TS=$(date -u +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/lydomania-$TS.archive.gz"
mkdir -p "$BACKUP_DIR"

docker compose exec -T mongo mongodump \
    --archive --gzip \
    --db "${DB_NAME:-lydomania}" \
    --username "$MONGO_INITDB_ROOT_USERNAME" \
    --password "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin > "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ')  backup OK  $OUT  ($SIZE)"

# Retention — keep last N
ls -1t "$BACKUP_DIR"/lydomania-*.archive.gz 2>/dev/null \
    | tail -n +$((RETAIN_N + 1)) \
    | xargs -r rm -- 2>/dev/null || true
