"""Shared Pydantic models across routers."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


# ============ Auth + user ============
class TelegramAuthIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    initData: str


class UserOut(BaseModel):
    id: str
    telegram_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    photo_url: Optional[str] = None
    balance_ton: float = 0.0
    is_admin: bool = False


class AuthOut(BaseModel):
    token: str
    user: UserOut


# ============ Wallet ============
class DepositAddressOut(BaseModel):
    address: str
    memo: str
    network: str
    expires_at: str


class BalanceOut(BaseModel):
    balance_ton: float


class PortalsListing(BaseModel):
    name: str
    price_ton: float
    image: Optional[str] = None
    source: str = "mock"


# ============ Cases / Game ============
class CaseBasketEntryOut(BaseModel):
    slug: str
    name: str
    rarity: str
    image_url: str
    weight: float
    payout_ton: float
    probability: float


class CaseSummaryOut(BaseModel):
    id: str
    name: str
    slug: str
    price_ton: float
    image_url: str
    actual_ev_pct: float
    house_edge_pct: float
    enabled: bool
    item_count: int
    category: str = "low"  # Phase 6b — "free" | "low" | "middle" | "high"


class CaseDetailOut(CaseSummaryOut):
    items: list[CaseBasketEntryOut]
    basket: list[CaseBasketEntryOut]


class FairCurrentOut(BaseModel):
    server_seed_hash: str
    client_seed_suggestion: str
    nonce: int
    rolls_until_rotation: int


class FairRotateOut(BaseModel):
    revealed_server_seed: str
    revealed_server_seed_hash: str
    revealed_nonce: int
    new_server_seed_hash: str


class CaseOpenIn(BaseModel):
    client_seed: Optional[str] = Field(None, max_length=128)


class WonItemOut(BaseModel):
    slug: str
    name: str
    rarity: str
    image_url: str
    payout_ton: float


class CaseOpenOut(BaseModel):
    roll_id: str
    winning_item: WonItemOut
    payout_ton: float
    server_seed_hash: str
    server_seed_revealed: str
    client_seed: str
    nonce: int
    roll_float: float
    new_balance: float
    inventory_id: str


class CaseOpenBatchIn(BaseModel):
    client_seed: Optional[str] = Field(None, max_length=128)
    count: int = Field(..., ge=1, le=10)


class BatchRollOut(BaseModel):
    roll_id: str
    inventory_id: str
    winning_item: WonItemOut
    payout_ton: float
    nonce: int
    roll_float: float


class CaseOpenBatchOut(BaseModel):
    rolls: list[BatchRollOut]
    server_seed_hash: str
    server_seed_revealed: str
    client_seed: str
    total_paid_ton: float
    total_won_ton: float
    net_pnl_ton: float
    new_balance: float


# ============ Inventory ============
class InventoryItemOut(BaseModel):
    id: str
    item_slug: str
    item_name: str
    rarity: str
    image_url: str
    payout_ton: float
    status: str
    case_id: str
    case_name: Optional[str] = None
    roll_id: str
    created_at: str


class InventoryTotalsOut(BaseModel):
    total_count: int
    total_value_unsold_ton: float
    total_value_all_time_ton: float
    count_by_rarity: dict[str, int]
    count_by_status: dict[str, int]


class InventoryPageOut(BaseModel):
    items: list[InventoryItemOut]
    totals: InventoryTotalsOut


# ============ Withdrawals ============
class WithdrawRequestIn(BaseModel):
    destination_address: str = Field(..., min_length=10, max_length=80)


class WithdrawalOut(BaseModel):
    id: str
    inventory_id: str
    item_slug: str
    item_name: str
    item_rarity: str
    item_image_url: str
    case_id: Optional[str] = None
    payout_ton: float
    destination_address: str
    status: str
    admin_notes: Optional[str] = None
    rejection_reason: Optional[str] = None
    fulfillment_tx_hash: Optional[str] = None
    fulfillment_value_ton: Optional[float] = None
    gift_source: Optional[str] = None
    purchased_variant_info: Optional[str] = None
    requested_at: str
    processing_at: Optional[str] = None
    fulfilled_at: Optional[str] = None
    rejected_at: Optional[str] = None
    cancelled_at: Optional[str] = None


# ============ Referrals ============
class ReferralReferred(BaseModel):
    username: Optional[str] = None
    masked_username: str
    total_wagered_ton: float
    your_earnings_ton: float


class ReferralStatsOut(BaseModel):
    ref_code: str
    ref_link: str
    referral_pct: float
    current_tier: str = "bronze"
    current_pct: float = 5.0
    next_tier: Optional[str] = None
    next_tier_threshold: Optional[int] = None
    referees_until_next_tier: Optional[int] = None
    total_referrals_count: int
    total_earnings_ton: float
    claimable_ton: float
    recent_referrals: list[ReferralReferred]


class ReferralClaimOut(BaseModel):
    claimed_ton: float
    new_main_balance: float
    new_referral_balance: float


# ============ Share card ============
class ShareCardOut(BaseModel):
    url: str
    multiplier: float
    payout_ton: float


# ============ Internal API ============
class InternalBalanceOut(BaseModel):
    exists: bool
    user_id: Optional[str] = None
    username: Optional[str] = None
    balance_ton: float = 0.0
    referral_balance_ton: float = 0.0


class InternalDepositIntentOut(BaseModel):
    address: str
    memo: str
    network: str


class InternalCaseTile(BaseModel):
    id: str
    name: str
    price_ton: float


class InternalRefTagIn(BaseModel):
    telegram_id: int
    ref_code: str


class NotifAckIn(BaseModel):
    id: str
    success: bool
    error: Optional[str] = None


# ============ Admin (withdrawals) ============
class AdminWithdrawalUser(BaseModel):
    telegram_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None


class AdminWithdrawalOut(WithdrawalOut):
    user: AdminWithdrawalUser


class AdminFulfillIn(BaseModel):
    tx_hash: str = Field(..., min_length=4, max_length=200)
    fulfillment_value_ton: Optional[float] = Field(None, ge=0)
    gift_source: Optional[str] = Field(None, pattern=r"^(portal|mrkt|fragment|manual)$")
    purchased_variant_info: Optional[str] = Field(None, max_length=500)
    admin_notes: Optional[str] = Field(None, max_length=2000)


class AdminRejectIn(BaseModel):
    rejection_reason: str = Field(..., min_length=10, max_length=2000)


class AdminWithdrawalStatsOut(BaseModel):
    pending_count: int
    processing_count: int
    fulfilled_count: int
    rejected_count: int
    cancelled_count: int
    total_value_pending_ton: float
    avg_fulfillment_seconds: Optional[float] = None


# ============ Admin (cases CRUD — Phase 3a) ============
class CaseBasketIn(BaseModel):
    slug: str
    weight: float = Field(..., gt=0)
    payout_ton: float = Field(..., ge=0)


class AdminCaseIn(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=80)
    slug: Optional[str] = None
    price_ton: float = Field(..., gt=0)
    image_path: Optional[str] = None
    image_url: Optional[str] = None  # legacy alias for image_path
    target_ev_pct: float = Field(..., ge=10, le=99)
    enabled: bool = True
    basket: list[CaseBasketIn] = Field(default_factory=list)


class AdminCasePatchIn(BaseModel):
    name: Optional[str] = None
    price_ton: Optional[float] = Field(None, gt=0)
    image_path: Optional[str] = None
    target_ev_pct: Optional[float] = Field(None, ge=10, le=99)
    enabled: Optional[bool] = None
    basket: Optional[list[CaseBasketIn]] = None


class AdminCaseStatsOut(BaseModel):
    case_id: str
    total_opens: int
    total_paid_ton: float
    total_won_ton: float
    realized_rtp_pct: float
    target_ev_pct: float
    drift_pct: float


class CalibrateIn(BaseModel):
    target_ev_pct: float = Field(..., ge=10, le=99)


class CalibrateOut(BaseModel):
    current_ev_pct: float
    recommended_jackpot_weight: Optional[float] = None
    jackpot_slug: Optional[str] = None
    feasible: bool
    message: str


# ============ Admin (items CRUD — Phase 3a) ============
class AdminItemIn(BaseModel):
    slug: str = Field(..., min_length=2, max_length=64, pattern=r"^[a-z0-9_]+$")
    name: str = Field(..., min_length=1, max_length=80)
    rarity: str = Field(..., pattern=r"^(common|rare|epic|legendary|mythic|jackpot)$")
    floor_price_ton: float = Field(0.0, ge=0)
    image_path: Optional[str] = None


class AdminItemPatchIn(BaseModel):
    name: Optional[str] = None
    rarity: Optional[str] = Field(None, pattern=r"^(common|rare|epic|legendary|mythic|jackpot)$")
    floor_price_ton: Optional[float] = Field(None, ge=0)
    image_path: Optional[str] = None


class AdminItemOut(BaseModel):
    id: str
    slug: str
    name: str
    rarity: str
    floor_price_ton: float
    image_path: Optional[str] = None
    image_url: str
    cases_using: int = 0


# ============ Admin (settings — Phase 3a) ============
class SettingsOut(BaseModel):
    # Pricing & floor watcher
    use_live_portals_pricing: bool = False
    portals_auth_data_set: bool = False  # we don't return the secret
    floor_watcher_enabled: bool = True
    floor_watcher_interval_seconds: int = 300

    # Auto-fulfill
    auto_fulfill_enabled: bool = False
    auto_fulfill_dry_run: bool = True
    auto_fulfill_threshold_ton: float = 0.0
    auto_fulfill_daily_cap_ton: float = 100.0

    # Referral ladder
    referral_bronze_pct: float = 5.0
    referral_silver_pct: float = 7.0
    referral_silver_threshold: int = 10
    referral_gold_pct: float = 10.0
    referral_gold_threshold: int = 50

    # Anti-abuse
    self_referral_blocked: bool = True
    max_referrals_per_day_per_user: int = 20

    # Phase 3c — solvency cap (max basket payout = price_ton × this)
    max_payout_multiplier: float = 200.0

    # Phase 4a — daily digest delivery hour (UTC, 0–23)
    digest_hour_utc: int = 9
    digest_last_sent_at: Optional[str] = None
    digest_last_sent_stats: Optional[dict] = None

    # Phase 4b — Portals client mode (mock | real)
    portals_client_mode: str = "mock"
    mock_portals_fail_rate: float = 0.0
    mock_portals_sim_delay_s: float = 0.05


class SettingsPatchIn(BaseModel):
    use_live_portals_pricing: Optional[bool] = None
    floor_watcher_enabled: Optional[bool] = None
    floor_watcher_interval_seconds: Optional[int] = Field(None, ge=30, le=3600)
    auto_fulfill_enabled: Optional[bool] = None
    auto_fulfill_dry_run: Optional[bool] = None
    auto_fulfill_threshold_ton: Optional[float] = Field(None, ge=0)
    auto_fulfill_daily_cap_ton: Optional[float] = Field(None, ge=0)
    referral_bronze_pct: Optional[float] = Field(None, ge=0, le=50)
    referral_silver_pct: Optional[float] = Field(None, ge=0, le=50)
    referral_silver_threshold: Optional[int] = Field(None, ge=1, le=10000)
    referral_gold_pct: Optional[float] = Field(None, ge=0, le=50)
    referral_gold_threshold: Optional[int] = Field(None, ge=1, le=10000)
    self_referral_blocked: Optional[bool] = None
    max_referrals_per_day_per_user: Optional[int] = Field(None, ge=1, le=10000)
    max_payout_multiplier: Optional[float] = Field(None, ge=10, le=10000)
    digest_hour_utc: Optional[int] = Field(None, ge=0, le=23)
    portals_client_mode: Optional[str] = Field(None, pattern=r"^(mock|real)$")
    mock_portals_fail_rate: Optional[float] = Field(None, ge=0.0, le=1.0)
    mock_portals_sim_delay_s: Optional[float] = Field(None, ge=0.0, le=10.0)


class PortalsAuthIn(BaseModel):
    auth_data: str = Field(..., min_length=10, max_length=10000)


class PortalsTestOut(BaseModel):
    ok: bool
    error: Optional[str] = None
    suggestion: Optional[str] = None
    sample_listings: Optional[list[dict[str, Any]]] = None


# ---------- Phase 4b: Promo codes ----------

class PromoCodeIn(BaseModel):
    code: str = Field(..., min_length=3, max_length=32)
    type: str = Field(..., pattern=r"^(ton_bonus|free_spin_token)$")
    value: float = Field(..., gt=0)
    max_redemptions: int = Field(0, ge=0)            # 0 = unlimited
    user_max: int = Field(1, ge=1, le=100)
    expires_at: Optional[str] = None
    enabled: bool = True
    notes: Optional[str] = Field(None, max_length=500)


class PromoCodePatchIn(BaseModel):
    value: Optional[float] = Field(None, gt=0)
    max_redemptions: Optional[int] = Field(None, ge=0)
    user_max: Optional[int] = Field(None, ge=1, le=100)
    expires_at: Optional[str] = None
    enabled: Optional[bool] = None
    notes: Optional[str] = Field(None, max_length=500)


class PromoCodeOut(BaseModel):
    id: str
    code: str
    type: str
    value: float | int
    max_redemptions: int
    current_redemptions: int
    user_max: int
    expires_at: Optional[str] = None
    enabled: bool
    notes: Optional[str] = None
    created_by_admin: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PromoRedeemIn(BaseModel):
    code: str = Field(..., min_length=3, max_length=32)


class PromoRedeemOut(BaseModel):
    code: str
    applied: dict[str, Any]


# ---------- Phase 6e: Telegram NFT gift deposits ----------

class GiftDepositIntentOut(BaseModel):
    id: str
    address: str
    memo: str
    network: str
    status: str  # pending | fulfilled | expired | rejected | unattributed
    item_slug: Optional[str] = None
    item_name: Optional[str] = None
    image_url: Optional[str] = None
    tx_hash: Optional[str] = None
    nft_address: Optional[str] = None
    created_at: str
    expires_at: str
    fulfilled_at: Optional[str] = None


class GiftDepositListOut(BaseModel):
    intents: list[GiftDepositIntentOut]
