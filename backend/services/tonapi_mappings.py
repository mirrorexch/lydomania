"""Phase 10 — Tonapi NFT collection → item template mappings (admin).

Used by `gift_deposit_watcher` to auto-credit incoming NFT deposits whose
collection address matches one of these mappings.

NOTE: Watcher integration is a P1 task — this file only provides the CRUD
surface for now. The watcher will be wired in a follow-up cycle.
"""
from __future__ import annotations

import logging
import secrets
from typing import Any

from pymongo import ASCENDING

from core.db import db
from core.time_utils import iso, now

LOG = logging.getLogger("lydomania.tonapi_mappings")
mappings_col = db["tonapi_collection_mappings"]


class TonapiMappingError(Exception):
    """Surface as 400."""


async def ensure_indexes() -> None:
    await mappings_col.create_index("collection_address", unique=True)
    await mappings_col.create_index("id", unique=True)


async def list_mappings() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    async for d in mappings_col.find({}, {"_id": 0}).sort("created_at", ASCENDING):
        rows.append(d)
    return rows


async def get_by_collection(collection_address: str) -> dict[str, Any] | None:
    return await mappings_col.find_one(
        {"collection_address": collection_address}, {"_id": 0},
    )


async def upsert_mapping(
    *,
    collection_address: str,
    item_template_id: str,
    rarity_floor_ton: float,
    image_override_url: str | None = None,
    seeded_for_demo: bool = False,
) -> dict[str, Any]:
    if not collection_address or not item_template_id:
        raise TonapiMappingError("missing_fields")
    if rarity_floor_ton < 0:
        raise TonapiMappingError("invalid_floor")

    existing = await get_by_collection(collection_address)
    if existing:
        # Update in-place
        await mappings_col.update_one(
            {"collection_address": collection_address},
            {"$set": {
                "item_template_id": item_template_id,
                "rarity_floor_ton": float(rarity_floor_ton),
                "image_override_url": image_override_url,
                "seeded_for_demo": bool(seeded_for_demo),
                "updated_at": iso(now()),
            }},
        )
        return await get_by_collection(collection_address)

    doc = {
        "id": secrets.token_hex(10),
        "collection_address": collection_address,
        "item_template_id": item_template_id,
        "rarity_floor_ton": float(rarity_floor_ton),
        "image_override_url": image_override_url,
        "seeded_for_demo": bool(seeded_for_demo),
        "created_at": iso(now()),
        "updated_at": iso(now()),
    }
    await mappings_col.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


async def delete_mapping(mapping_id: str) -> bool:
    r = await mappings_col.delete_one({"id": mapping_id})
    return r.deleted_count > 0


async def seed_demo_mappings() -> int:
    """Seed 2-3 example mappings if collection is empty. Idempotent."""
    if await mappings_col.count_documents({}) > 0:
        return 0
    demos = [
        {"collection_address": "EQDC_clover_pin_demo_address", "item_template_id": "clover_pin",      "rarity_floor_ton": 4.0, "image_override_url": None, "seeded_for_demo": True},
        {"collection_address": "EQDC_top_hat_demo_address",    "item_template_id": "top_hat",         "rarity_floor_ton": 5.0, "image_override_url": None, "seeded_for_demo": True},
        {"collection_address": "EQDC_lol_pop_demo_address",    "item_template_id": "lol_pop",         "rarity_floor_ton": 3.0, "image_override_url": None, "seeded_for_demo": True},
    ]
    for d in demos:
        await upsert_mapping(**d)
    return len(demos)
