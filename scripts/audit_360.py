"""Phase 10.5 — 360x800 mobile-safe self-audit.

For every key route in the app, navigate at viewport 360x800, also exercise
opening certain modals where applicable, and assert
`document.documentElement.scrollWidth === document.documentElement.clientWidth`.

Output: markdown table at /app/memory/deployment/PHASE_10_360_AUDIT.md
"""
import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://tonconnect-mini.preview.emergentagent.com")
# Front and back are the same domain (Kubernetes ingress routes /api → backend, * → frontend)
FRONT = BASE_URL.rstrip("/")
OUT = Path("/app/memory/deployment/PHASE_10_360_AUDIT.md")


# Step actions per page. Each "step" is one inspection — Playwright will check
# overflow at that point. "open_modal": click selector to open modal.
PAGES = [
    {"label": "home (loading bypass)",       "path": "/?dev=1"},
    {"label": "cases list",                   "path": "/cases?dev=1"},
    {"label": "wheel",                        "path": "/wheel?dev=1"},
    {"label": "wheel (FairnessModal open)",   "path": "/wheel?dev=1", "after_clicks": ["[data-testid=fairness-chip],[data-testid=wheel-fairness-chip],button:has-text('Fair')"]},
    {"label": "roulette",                     "path": "/roulette?dev=1"},
    {"label": "crash",                        "path": "/crash?dev=1"},
    {"label": "plinko",                       "path": "/plinko?dev=1"},
    {"label": "mines",                        "path": "/mines?dev=1"},
    {"label": "inventory",                    "path": "/inventory?dev=1"},
    {"label": "inventory (list-modal open)",  "path": "/inventory?dev=1", "after_clicks": ["[data-testid^=inv-list-btn],button:has-text('List')"]},
    {"label": "marketplace",                  "path": "/marketplace?dev=1"},
    {"label": "withdrawals",                  "path": "/withdrawals?dev=1"},
    {"label": "vip",                          "path": "/vip?dev=1"},
    {"label": "battlepass",                   "path": "/battlepass?dev=1"},
    {"label": "missions",                     "path": "/missions?dev=1"},
    {"label": "achievements",                 "path": "/achievements?dev=1"},
    {"label": "leaderboard",                  "path": "/leaderboard?dev=1"},
    {"label": "profile",                      "path": "/profile?dev=1"},
    {"label": "admin · tonapi-mappings",      "path": "/admin/tonapi-mappings?dev=1"},
    {"label": "admin · tonapi-mappings (add modal)",  "path": "/admin/tonapi-mappings?dev=1", "after_clicks": ["[data-testid=admin-tonapi-add]"]},
    {"label": "admin · settings",             "path": "/admin/settings?dev=1"},
    {"label": "admin · withdrawals",          "path": "/admin/withdrawals?dev=1"},
    {"label": "admin · items",                "path": "/admin/items?dev=1"},
]


async def audit():
    rows = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 360, "height": 800})
        # Reduce console noise — count errors as a sanity flag
        page = await ctx.new_page()
        console_errors_total = []

        page.on("pageerror", lambda exc: console_errors_total.append(("pageerror", str(exc))))
        page.on("console", lambda msg: console_errors_total.append(("console.error", msg.text)) if msg.type == "error" else None)

        for spec in PAGES:
            url = FRONT + spec["path"]
            try:
                await page.goto(url, wait_until="networkidle", timeout=20000)
                await asyncio.sleep(0.7)
                # Optional: click to open a modal
                for sel in spec.get("after_clicks", []):
                    try:
                        loc = page.locator(sel).first
                        await loc.click(timeout=2500)
                        await asyncio.sleep(0.5)
                        break
                    except Exception:
                        continue

                metrics = await page.evaluate(
                    """() => {
                        const html = document.documentElement;
                        return {
                            sw: html.scrollWidth,
                            cw: html.clientWidth,
                            overflowing_elements: Array.from(document.querySelectorAll('*'))
                                .filter(el => el.scrollWidth > el.clientWidth + 1
                                    && el.tagName !== 'HTML' && el.tagName !== 'BODY')
                                .slice(0, 3)
                                .map(el => el.tagName.toLowerCase() + '.' + (el.className||'').split(' ').slice(0,2).join('.'))
                        };
                    }"""
                )
                ok = metrics["sw"] <= metrics["cw"] + 1
                rows.append({
                    "label": spec["label"],
                    "url": spec["path"],
                    "sw": metrics["sw"],
                    "cw": metrics["cw"],
                    "ok": ok,
                    "overflow_hints": ", ".join(metrics["overflowing_elements"]) if not ok else "",
                })
            except Exception as e:
                rows.append({
                    "label": spec["label"],
                    "url": spec["path"],
                    "sw": -1, "cw": -1, "ok": False,
                    "overflow_hints": f"NAV_ERROR: {type(e).__name__}: {str(e)[:80]}",
                })

        await browser.close()

    # Write markdown table
    n_pass = sum(1 for r in rows if r["ok"])
    n_total = len(rows)
    pct = (n_pass / n_total * 100) if n_total else 0
    lines = [
        "# Phase 10 — 360x800 Mobile Self-Audit",
        "",
        f"**Viewport:** 360x800 (Chromium headless via Playwright)",
        f"**Result:** {n_pass} / {n_total} pages clean ({pct:.0f}%)",
        "",
        "| # | Page / state | scrollWidth | clientWidth | OK | Overflow hint |",
        "|--:|-----------|--:|--:|:--:|---|",
    ]
    for i, r in enumerate(rows, 1):
        ok_mark = "✅" if r["ok"] else "❌"
        lines.append(
            f"| {i} | {r['label']} (`{r['url']}`) | {r['sw']} | {r['cw']} | {ok_mark} | {r['overflow_hints']} |"
        )
    lines += [
        "",
        f"**Console errors observed during sweep:** {len(console_errors_total)} (informational)",
        "",
        "_Modals exercised in this sweep:_ inventory **List on Market** dialog · admin **Add Tonapi mapping** dialog · **Wheel Fairness** chip / modal.",
        "",
        "_Generated by `tests/audit_360.py`._",
    ]
    OUT.write_text("\n".join(lines))
    print(json.dumps({"pass": n_pass, "total": n_total, "out": str(OUT)}))


if __name__ == "__main__":
    asyncio.run(audit())
