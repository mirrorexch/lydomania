"""Phase 10 — Admin CRUD for Tonapi NFT collection → item template mappings.

Used by `gift_deposit_watcher` (P1 future hook) to credit incoming NFT
deposits to the matching item template + rarity floor.
"""
from __future__ import annotations

from fastapi import HTTPException
from pydantic import BaseModel, Field

from services.tonapi_mappings import (
    TonapiMappingError, delete_mapping, list_mappings, seed_demo_mappings,
    upsert_mapping,
)

from . import admin


class UpsertIn(BaseModel):
    collection_address: str = Field(..., min_length=4, max_length=128)
    item_template_id: str = Field(..., min_length=1, max_length=64)
    rarity_floor_ton: float = Field(..., ge=0)
    image_override_url: str | None = None
    seeded_for_demo: bool = False


@admin.get("/tonapi-mappings")
async def get_all() -> dict:
    return {"rows": await list_mappings()}


@admin.post("/tonapi-mappings")
async def post_upsert(payload: UpsertIn) -> dict:
    try:
        return await upsert_mapping(
            collection_address=payload.collection_address.strip(),
            item_template_id=payload.item_template_id.strip(),
            rarity_floor_ton=float(payload.rarity_floor_ton),
            image_override_url=payload.image_override_url or None,
            seeded_for_demo=bool(payload.seeded_for_demo),
        )
    except TonapiMappingError as e:
        raise HTTPException(status_code=400, detail=str(e))


@admin.delete("/tonapi-mappings/{mapping_id}")
async def delete_one(mapping_id: str) -> dict:
    ok = await delete_mapping(mapping_id)
    if not ok:
        raise HTTPException(status_code=404, detail="not_found")
    return {"deleted": True, "id": mapping_id}


@admin.post("/tonapi-mappings/seed-demos")
async def post_seed_demos() -> dict:
    n = await seed_demo_mappings()
    return {"seeded": n}
