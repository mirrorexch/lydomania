"""Share card route: POST /share-card/generate?roll_id=..."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from core.auth import get_current_user
from core.config import STATIC_DIR
from core.db import cases_col, rolls_col
from core.models import ShareCardOut
from core.ton import static_url
from share_card import compose_share_card

router = APIRouter(prefix="/api")


@router.post("/share-card/generate", response_model=ShareCardOut)
async def share_card_generate(
    roll_id: str = Query(..., min_length=4, max_length=64),
    user: dict = Depends(get_current_user),
) -> ShareCardOut:
    roll = await rolls_col.find_one({"id": roll_id, "user_id": user["id"]}, {"_id": 0})
    if not roll:
        raise HTTPException(status_code=404, detail="roll not found")
    case = await cases_col.find_one({"id": roll["case_id"]}, {"_id": 0})
    case_price = float(case.get("price_ton", 0)) if case else 0
    payout = float(roll.get("payout_ton", 0))
    if case_price <= 0:
        raise HTTPException(status_code=400, detail="invalid case price")
    multiplier = payout / case_price
    if multiplier < 2.0:
        raise HTTPException(status_code=400, detail=f"win not big enough to share (mult={multiplier:.2f}, need >= 2.0)")
    out_path = STATIC_DIR / "shares" / f"{roll_id}.png"
    if not out_path.exists():
        from core.db import inventory_col, items_col
        item_meta = await items_col.find_one({"slug": roll["winning_item_slug"]}, {"_id": 0}) or {}
        inv = await inventory_col.find_one({"roll_id": roll_id}, {"_id": 0}) or {}
        compose_share_card(
            out_path=out_path,
            item_name=item_meta.get("name", roll["winning_item_slug"]),
            rarity=item_meta.get("rarity", inv.get("rarity", "common")),
            payout_ton=payout, case_price_ton=case_price,
            case_name=case["name"] if case else "Case",
            item_image_path=item_meta.get("image_path", inv.get("image_path", "items/crate_common.png")),
        )
    return ShareCardOut(
        url=static_url(f"shares/{roll_id}.png"),
        multiplier=round(multiplier, 2), payout_ton=payout,
    )
