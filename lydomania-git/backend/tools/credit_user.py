"""
Phase 6a hotfix — one-off CLI to credit a user's TON balance.

Usage:
    python -m tools.credit_user <telegram_id> <amount_ton> [--reason "..."] \
        [--admin <operator_name>]

Exit codes:
    0 — credited successfully
    1 — user not found (must /start the bot first)
    2 — bad input
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient

from core.time_utils import iso, now  # type: ignore[import-not-found]


async def credit_user(
    telegram_id: int,
    amount_ton: float,
    reason: str,
    admin: str,
) -> dict[str, Any]:
    if amount_ton <= 0:
        raise ValueError("amount must be positive")

    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "lydomania")
    client = AsyncIOMotorClient(mongo_url)
    try:
        db = client[db_name]
        users = db["users"]
        manual = db["manual_credits"]

        existing = await users.find_one({"telegram_id": int(telegram_id)}, {"_id": 0})
        if not existing:
            return {"status": "USER_NOT_FOUND", "telegram_id": telegram_id}

        before = float(existing.get("balance_ton") or 0.0)
        updated = await users.find_one_and_update(
            {"telegram_id": int(telegram_id)},
            {"$inc": {"balance_ton": float(amount_ton)},
             "$set": {"updated_at": iso(now())}},
            return_document=True,
            projection={"_id": 0, "id": 1, "telegram_id": 1, "username": 1,
                        "first_name": 1, "balance_ton": 1},
        )
        after = float(updated["balance_ton"])
        import secrets
        await manual.insert_one({
            "id": secrets.token_hex(12),
            "telegram_id": int(telegram_id),
            "user_id": updated["id"],
            "amount_ton": float(amount_ton),
            "balance_before": before,
            "balance_after": after,
            "reason": reason,
            "admin": admin,
            "source": "cli" if admin == "cli" else "api",
            "created_at": iso(now()),
        })
        return {
            "status": "OK",
            "user_id": updated["id"],
            "telegram_id": int(telegram_id),
            "username": updated.get("username"),
            "first_name": updated.get("first_name"),
            "amount_ton": float(amount_ton),
            "balance_before": before,
            "balance_after": after,
            "reason": reason,
            "admin": admin,
        }
    finally:
        client.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Credit a user's TON balance")
    ap.add_argument("telegram_id", type=int)
    ap.add_argument("amount", type=float)
    ap.add_argument("--reason", default="manual_credit", help="audit-trail reason")
    ap.add_argument("--admin", default="cli", help="operator name (for audit log)")
    args = ap.parse_args()

    if args.amount <= 0:
        print(f"ERROR: amount must be positive, got {args.amount}", file=sys.stderr)
        return 2

    res = asyncio.run(credit_user(args.telegram_id, args.amount, args.reason, args.admin))
    if res["status"] == "USER_NOT_FOUND":
        print(f"ERROR: USER_NOT_FOUND · telegram_id={args.telegram_id}", file=sys.stderr)
        print("  User must /start the bot first to be auto-created.", file=sys.stderr)
        return 1

    print(f"✓ credited telegram_id={res['telegram_id']} (@{res.get('username') or 'no-username'})")
    print(f"   amount  : +{res['amount_ton']:.2f} TON")
    print(f"   before  :  {res['balance_before']:.4f} TON")
    print(f"   after   :  {res['balance_after']:.4f} TON")
    print(f"   reason  : {res['reason']}")
    print(f"   admin   : {res['admin']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
