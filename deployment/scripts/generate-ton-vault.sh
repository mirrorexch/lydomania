#!/usr/bin/env bash
# =====================================================================
# generate-ton-vault.sh
#   Mints a brand-new 24-word TON mnemonic and derives the v4r2 mainnet
#   wallet address.  Writes TON_VAULT_MNEMONIC into .env and prints the
#   address so you can verify on tonscan.org.
#
#   WARNING: this is a NEW vault.  Sweep any funds from your previous
#   vault BEFORE retiring the old mnemonic.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    cp .env.example .env
fi

cat <<'WARN'
┌──────────────────────────────────────────────────────────────────────┐
│  ⚠  This will OVERWRITE TON_VAULT_MNEMONIC in your .env file.        │
│                                                                      │
│  After this runs:                                                    │
│    1. Write down the 24 words on PAPER.  Two copies, two locations.  │
│    2. Never paste them online, in chat, screenshots, or cloud notes. │
│    3. Sweep any TON / NFTs from your OLD vault BEFORE discarding.    │
│    4. Test with a small deposit (0.1 TON) before funding fully.      │
└──────────────────────────────────────────────────────────────────────┘
WARN

read -rp "Type 'yes' to proceed: " ack
if [[ "$ack" != "yes" ]]; then
    echo "Aborted."
    exit 1
fi

# Use a tiny ephemeral container so we don't need Python locally.
OUT=$(docker run --rm python:3.11-slim sh -c '
pip install --quiet --no-cache-dir tonsdk >/dev/null 2>&1
python - <<PY
from tonsdk.crypto._mnemonic import mnemonic_new
from tonsdk.contract.wallet import Wallets, WalletVersionEnum
words = mnemonic_new()
_mn, _pub, _priv, w = Wallets.from_mnemonics(
    mnemonics=words, version=WalletVersionEnum.v4r2, workchain=0,
)
addr = w.address.to_string(True, True, False)
print("ADDR:" + addr)
print("MNEM:" + " ".join(words))
PY
')

ADDR=$(printf '%s\n' "$OUT" | sed -n 's/^ADDR://p')
MNEM=$(printf '%s\n' "$OUT" | sed -n 's/^MNEM://p')

if [[ -z "$ADDR" || -z "$MNEM" ]]; then
    echo "✗ Failed to generate vault.  Output was:"
    echo "$OUT"
    exit 1
fi

# Persist into .env (quoted so spaces survive)
if grep -q "^TON_VAULT_MNEMONIC=" .env; then
    # Match the entire line and replace — use a different delimiter so
    # the value (which contains spaces) doesn't break sed.
    python3 - "$MNEM" <<'PY'
import sys, pathlib
mnem = sys.argv[1]
p = pathlib.Path(".env")
lines = []
for line in p.read_text().splitlines():
    if line.startswith("TON_VAULT_MNEMONIC="):
        lines.append(f'TON_VAULT_MNEMONIC="{mnem}"')
    else:
        lines.append(line)
p.write_text("\n".join(lines) + "\n")
PY
else
    echo "TON_VAULT_MNEMONIC=\"$MNEM\"" >> .env
fi

cat <<EOF

╔══════════════════════════════════════════════════════════════════════╗
║                       NEW LYDOMANIA VAULT                            ║
╠══════════════════════════════════════════════════════════════════════╣
║  ADDRESS (share freely — this is where users deposit):               ║
║                                                                      ║
║    $ADDR
║                                                                      ║
║  MNEMONIC (the 24 words — NEVER share):                              ║
║                                                                      ║
║    $MNEM
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  ✓ Mnemonic written to .env (TON_VAULT_MNEMONIC).                    ║
║  ✓ Verify the address on https://tonscan.org/address/$ADDR (will    ║
║    show as Uninit until first incoming tx).                          ║
║                                                                      ║
║  NEXT: write the 24 words on paper, store two copies in two safe     ║
║        places, then continue with DEPLOY.md Part 7.                  ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
