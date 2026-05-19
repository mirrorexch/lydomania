"""TON vault address derivation + static URL helper."""
from __future__ import annotations

from tonsdk.contract.wallet import Wallets, WalletVersionEnum

from core.config import TON_VAULT_MNEMONIC

VAULT_ADDR_NB: str = ""  # UQ... non-bounceable
VAULT_ADDR_B: str = ""   # EQ... bounceable
VAULT_ADDR_RAW: str = ""


def derive_vault_address() -> None:
    global VAULT_ADDR_NB, VAULT_ADDR_B, VAULT_ADDR_RAW
    words = TON_VAULT_MNEMONIC.strip().split()
    if len(words) not in (12, 18, 24):
        raise RuntimeError("TON_VAULT_MNEMONIC must be 12/18/24 words")
    _, _pub, _priv, wallet = Wallets.from_mnemonics(
        mnemonics=words, version=WalletVersionEnum.v4r2, workchain=0
    )
    addr = wallet.address
    VAULT_ADDR_NB = addr.to_string(True, True, False)
    VAULT_ADDR_B = addr.to_string(True, True, True)
    VAULT_ADDR_RAW = addr.to_string(False)


derive_vault_address()


def static_url(path: str) -> str:
    if not path:
        return ""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"/api/static/{path.lstrip('/')}"
