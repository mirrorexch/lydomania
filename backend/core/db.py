"""MongoDB client + collection handles."""
from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient

from core.config import DB_NAME, MONGO_URL

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]


async def with_txn(callback):
    """Run `callback(session)` inside a MongoDB multi-document transaction.

    Used for money flows (marketplace buy, sell-review payout, promo redeem) so a
    partial failure rolls the whole thing back atomically. `with_transaction`
    auto-retries on transient transaction errors. Requires the replica set (prod
    runs single-node rs0); if a caller hits a standalone, the driver raises and the
    caller surfaces the error rather than half-applying.
    """
    async with await mongo_client.start_session() as session:
        return await session.with_transaction(callback)

# Existing
users_col = db["users"]
intents_col = db["deposit_intents"]
deposits_col = db["deposits"]
meta_col = db["meta"]
items_col = db["items"]
cases_col = db["cases"]
fair_col = db["fair_state"]
rolls_col = db["rolls"]
inventory_col = db["inventory_items"]
withdrawals_col = db["withdrawal_requests"]

# Phase 1b
pending_refs_col = db["pending_referrals"]
ref_credits_col = db["referral_credits"]
ref_claims_col = db["referral_claims"]

# Phase 2
notifications_col = db["notifications_outbox"]

# Phase 3a — new collections
settings_col = db["app_settings"]              # singleton doc, id="global"
referral_abuse_col = db["referral_abuse_log"]
# Phase 3b — populated later
gift_floor_prices_col = db["gift_floor_prices"]
auto_fulfill_log_col = db["auto_fulfill_log"]

# Phase 4b
promo_codes_col = db["promo_codes"]
promo_redemptions_col = db["promo_redemptions"]
leaderboard_snapshots_col = db["leaderboard_snapshots"]

# Phase 6e — Telegram NFT gift deposits
gift_deposit_intents_col = db["gift_deposit_intents"]
gift_deposits_col = db["gift_deposits"]

# Phase 6e — Roulette gift mode
roulette_baskets_col = db["roulette_baskets"]
roulette_config_col = db["roulette_config"]
sell_reviews_col = db["sell_reviews"]
