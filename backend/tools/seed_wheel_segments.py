"""Phase 7b — seed/refresh the wheel_segments collection from SEGMENT_DEFS."""

from __future__ import annotations

import asyncio

from core.db import db
from core.wheel_engine import SEGMENT_DEFS

segments_col = db["wheel_segments"]


async def main() -> None:
    # Idempotent: upsert each segment by segment_index.
    for d in SEGMENT_DEFS:
        await segments_col.update_one(
            {"segment_index": d["segment_index"]},
            {"$set": {**d}},
            upsert=True,
        )
    n = await segments_col.count_documents({})
    print(f"OK · {n} wheel segments seeded.")


if __name__ == "__main__":
    asyncio.run(main())
