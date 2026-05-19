"""
Post-09b9b34 — Tests for `_sync_static_bundle()`.

The Phase 6e bug-fix changes the sync semantics from "copy missing only" to
"copy when (size, mtime) differs". These 4 cases pin the new behaviour:

  1. stale file in live volume → overwritten by bundle.
  2. identical file → skipped (no-op on stable images).
  3. missing file in live volume → copied from bundle.
  4. user-uploaded file present ONLY in live → preserved (never deleted).

Run with:
    cd /app/backend && pytest tests/test_static_sync.py -v
"""
from __future__ import annotations

import asyncio
import importlib
import logging
import os
import time
from pathlib import Path

import pytest


def _write(p: Path, content: bytes, mtime: float | None = None) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
    if mtime is not None:
        os.utime(p, (mtime, mtime))


def _run_sync(static_dir: Path) -> None:
    """Re-import `server` and patch its STATIC_DIR to point at our tmp tree,
    then invoke the coroutine. Re-import so each test gets a fresh module
    state with no cached `STATIC_DIR.parent` pin.
    """
    import server  # noqa: WPS433 — intentional dynamic import inside test
    importlib.reload(server)
    server.STATIC_DIR = static_dir
    asyncio.run(server._sync_static_bundle())


@pytest.fixture
def env(tmp_path: Path) -> dict:
    """Build a (live, bundle) pair under `tmp_path/static` and `tmp_path/_static_bundle`.

    The bundle MUST be at `STATIC_DIR.parent / "_static_bundle"` per the
    `_sync_static_bundle()` contract.
    """
    live = tmp_path / "static"
    bundle = tmp_path / "_static_bundle"
    live.mkdir()
    bundle.mkdir()
    return {"live": live, "bundle": bundle, "root": tmp_path}


def test_stale_file_overwritten(env, caplog) -> None:
    """A live file smaller than its bundle counterpart must be overwritten,
    and an [static_sync] OVERWRITE log line emitted."""
    bundle_payload = b"x" * 1_200_000  # ~1.2 MB
    live_payload = b"y" * 22_000        # ~22 KB stale placeholder
    bundle_mtime = time.time()
    live_mtime = bundle_mtime - 7 * 86400  # one week stale
    _write(env["bundle"] / "items" / "plush_pepe.png", bundle_payload, bundle_mtime)
    _write(env["live"] / "items" / "plush_pepe.png", live_payload, live_mtime)

    with caplog.at_level(logging.INFO, logger="lydomania"):
        _run_sync(env["live"])

    live_file = env["live"] / "items" / "plush_pepe.png"
    assert live_file.read_bytes() == bundle_payload
    assert live_file.stat().st_size == len(bundle_payload)
    assert int(live_file.stat().st_mtime) == int(bundle_mtime)
    # Log line includes the OVERWRITE marker with both sizes
    overwrites = [r for r in caplog.records if "OVERWRITE" in r.getMessage()]
    assert overwrites, f"expected OVERWRITE log, got: {[r.getMessage() for r in caplog.records]}"
    msg = overwrites[0].getMessage()
    assert "items/plush_pepe.png" in msg
    assert "bundle=1200000" in msg
    assert "live=22000" in msg


def test_identical_file_skipped(env, caplog) -> None:
    """When size + int(mtime) match exactly, the file is skipped — no copy,
    no OVERWRITE log line."""
    payload = b"identical-payload"
    shared_mtime = time.time() - 3600
    _write(env["bundle"] / "items" / "diamond_ring.png", payload, shared_mtime)
    _write(env["live"] / "items" / "diamond_ring.png", payload, shared_mtime)

    # Pin the live file's content with a sentinel byte so we can detect any
    # spurious copy.  shutil.copy2 would otherwise be invisible because the
    # contents already match.
    sentinel_mtime_int = int(shared_mtime)

    with caplog.at_level(logging.INFO, logger="lydomania"):
        _run_sync(env["live"])

    live_file = env["live"] / "items" / "diamond_ring.png"
    # mtime int should be unchanged (no copy)
    assert int(live_file.stat().st_mtime) == sentinel_mtime_int
    overwrites = [r for r in caplog.records if "OVERWRITE" in r.getMessage()]
    assert overwrites == [], f"identical files must NOT trigger OVERWRITE: {overwrites}"
    summary = [r for r in caplog.records if "already-current" in r.getMessage()]
    assert summary, "summary log line missing"
    assert "0 copied" in summary[0].getMessage()
    assert "1 already-current" in summary[0].getMessage()


def test_missing_file_copied(env, caplog) -> None:
    """A file in the bundle but not in the live volume must be copied."""
    payload = b"fresh-bundle-content"
    bundle_mtime = time.time() - 60
    _write(env["bundle"] / "items" / "swag_bag.png", payload, bundle_mtime)
    # live is intentionally empty

    with caplog.at_level(logging.INFO, logger="lydomania"):
        _run_sync(env["live"])

    live_file = env["live"] / "items" / "swag_bag.png"
    assert live_file.exists()
    assert live_file.read_bytes() == payload
    assert int(live_file.stat().st_mtime) == int(bundle_mtime)
    # No OVERWRITE on a fresh copy
    overwrites = [r for r in caplog.records if "OVERWRITE" in r.getMessage()]
    assert overwrites == []
    summary = [r for r in caplog.records if "already-current" in r.getMessage()]
    assert summary and "1 copied" in summary[0].getMessage()


def test_user_upload_preserved(env, caplog) -> None:
    """A file that exists ONLY in the live volume (e.g. admin upload) must
    never be deleted or touched by the sync."""
    user_payload = b"user-uploaded-via-admin-ui"
    user_mtime = time.time() - 600
    _write(env["live"] / "items" / "admin_upload.png", user_payload, user_mtime)
    # bundle has a different, unrelated file
    _write(env["bundle"] / "items" / "spy_agaric.png", b"bundle-only", time.time())

    with caplog.at_level(logging.INFO, logger="lydomania"):
        _run_sync(env["live"])

    user_file = env["live"] / "items" / "admin_upload.png"
    assert user_file.exists(), "user-uploaded file must NEVER be deleted by sync"
    assert user_file.read_bytes() == user_payload
    assert int(user_file.stat().st_mtime) == int(user_mtime)

    # bundle-only file should have been copied across
    assert (env["live"] / "items" / "spy_agaric.png").exists()


if __name__ == "__main__":
    raise SystemExit(pytest.main(["-v", __file__]))
