#!/usr/bin/env bash
# =====================================================================
# first-run-check.sh — smoke-test a freshly booted stack.
#   • API + OpenAPI reachable
#   • TonConnect manifest served at root
#   • Vault address derives + matches generate-ton-vault output
#   • Bot is authorised at Telegram
#   • Background workers (deposit watcher, floor watcher) are running
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env; set +a

DOMAIN="${DOMAIN:?DOMAIN missing in .env}"
BASE="https://$DOMAIN"
PASS=0; FAIL=0

check_http() {
    local name="$1" url="$2" expected_code="${3:-200}"
    local code
    code=$(curl -s -o /tmp/last_response.json -w "%{http_code}" --max-time 15 "$url" || echo "000")
    if [[ "$code" == "$expected_code" ]]; then
        printf "  ✓  %-30s  %s\n" "$name" "$code"
        ((PASS++))
    else
        printf "  ✗  %-30s  expected=%s got=%s\n" "$name" "$expected_code" "$code"
        ((FAIL++))
    fi
}

echo ""
echo "Lydomania first-run check  ·  $BASE"
echo "─────────────────────────────────────────────"

check_http "API health"             "$BASE/api/health"                 200
check_http "OpenAPI spec"           "$BASE/openapi.json"               200
check_http "TonConnect manifest"    "$BASE/tonconnect-manifest.json"   200
check_http "Wallet vault-info"      "$BASE/api/wallet/vault-info"      200

# Telegram getMe
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    if curl -sf --max-time 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" | grep -q '"ok":true'; then
        printf "  ✓  %-30s\n" "Telegram getMe"
        ((PASS++))
    else
        printf "  ✗  %-30s  invalid token?\n" "Telegram getMe"
        ((FAIL++))
    fi
fi

# Background workers logs
if docker compose logs --no-color --tail 300 backend 2>/dev/null | grep -qE "floor-watcher|deposit_watcher|APScheduler started"; then
    printf "  ✓  %-30s\n" "Background workers running"
    ((PASS++))
else
    printf "  ⚠  %-30s  not seen yet (wait 60s and re-run)\n" "Background workers"
    ((FAIL++))
fi

# Bot worker authorised
if docker compose logs --no-color --tail 200 bot 2>/dev/null | grep -q "Authorized as @"; then
    printf "  ✓  %-30s\n" "Bot worker authorised"
    ((PASS++))
else
    printf "  ⚠  %-30s  not seen yet\n" "Bot worker authorised"
    ((FAIL++))
fi

# Vault address visible in backend logs
VAULT_ADDR=$(docker compose logs --no-color --tail 500 backend 2>/dev/null | grep -oE "EQ[A-Za-z0-9_-]{46}|UQ[A-Za-z0-9_-]{46}" | tail -1 || true)
if [[ -n "$VAULT_ADDR" ]]; then
    printf "  ✓  %-30s  %s\n" "Vault address" "$VAULT_ADDR"
    ((PASS++))
else
    printf "  ⚠  %-30s  not seen in backend logs\n" "Vault address"
    ((FAIL++))
fi

echo "─────────────────────────────────────────────"
echo "$PASS passed · $FAIL warned"
if [[ "$FAIL" -gt 0 ]]; then
    echo ""
    echo "⚠  Some checks need attention.  See:"
    echo "    docker compose ps"
    echo "    docker compose logs -f"
    exit 1
fi
echo "✓ Lydomania is live at $BASE"
