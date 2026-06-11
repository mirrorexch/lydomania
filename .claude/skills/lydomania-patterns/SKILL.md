---
name: lydomania-patterns
description: Operational + coding patterns for the Lydomania Telegram gift casino (FastAPI + Motor/MongoDB backend, React frontend) — safe deploys to live mainnet, the QA-on-replica-set harness, RTP/game calibration, money transactions, and the live Fragment floor pipeline. Use when working on this repo.
version: 1.0.0
source: local-git-analysis
analyzed_commits: 27
---

# Lydomania Patterns

A real-money Telegram gift casino. **Production is live mainnet** (`TON_NETWORK=mainnet`,
real funds, real users) and is the *only* environment — there is no separate staging.
Treat every prod action accordingly.

## Commit Conventions

Conventional commits with a scope, imperative subject, and a "why" body:

```
feat(<scope>): <imperative summary>
fix(<scope>): <imperative summary>
```

Common scopes: `security`, `rtp`, `cases`, `wheel`, `money`, `floors`, `infra`,
`crash`, `rbac`, `conversion`, `frontend`. One PR per logical change; squash-merge.

## Architecture

```
backend/                      # FastAPI + APScheduler + Motor (async MongoDB), Python 3.11
├── core/        (~17)        # config, db (client + collections + with_txn), auth, *_engine.py (pure game math)
├── services/    (~31)        # business logic: recalibration, wheel_recalibration, floor_watcher, marketplace…
├── routers/     (~30)        # HTTP + WS endpoints; routers/admin/* gated by RBAC
├── tools/       (~24)        # one-off + scheduled jobs (seed_*, migrate_*, rebuild_competitive_cases)
└── tests/       (26 files)   # pytest; integration tests hit a live server on :8001
frontend/src/                 # React (CRA) + Tailwind; lib/*Ws.js WebSocket clients, pages/*Page.jsx
deployment/                   # docker-compose.yml (mongo/backend/bot/frontend/caddy), scripts/
```

Game engines (`core/*_engine.py`) are **pure functions** (deterministic, provably-fair
HMAC-SHA256) and are unit-tested directly. Money/state lives in services/routers.

## Deploy pipeline (live mainnet — handle with care)

The `deploy` user owns `/opt/lydomania` and is in the `docker` group (no root needed).
The repeatable, auto-rollback deploy is staged on the host at `/home/deploy/deploy_svc.sh`:

```
ssh deploy@<host> 'bash /home/deploy/deploy_svc.sh backend'   # backup → pull → build → cutover → health-gate → rollback-on-fail
```

Rules learned the hard way:
- **Always back up Mongo first** (`deployment/scripts/backup-mongo.sh`) — the deploy script does this.
- **`docker compose up -d` does NOT pick up a rebuilt image** — use `--force-recreate`.
- **Don't pipe long heredocs over SSH** (SIGPIPE/truncation under `set -o pipefail`) — stage a
  script as a *file* on the host and run it, or use short separate commands.
- After a **squash-merge**, a branch that still contains the original (now-squashed) commit
  conflicts with `main`. To re-fix, branch fresh from `origin/main` and re-apply only the changed files.
- Mongo collections reading **DB-stored calibration** (wheel_segments, roulette_baskets, cases)
  need a re-seed/rebuild after a code change; engines reading **code constants** (crash/mines/plinko)
  take effect on deploy alone.

## QA harness (must mirror prod)

Never test against prod Mongo. Spin up a **throwaway `mongo:7` as a single-node replica set**
on the host, seed it, run the suite **per-file** (process isolation), then tear it down:

- Transactions require a replica set → QA mongo runs `--replSet rs0` + `rs.initiate(host: "<name>:27017")`,
  and `MONGO_URL` carries `?replicaSet=rs0`. Prod additionally needs `--keyFile` (chown 999:999, chmod 400,
  set via a root `docker run` since `deploy` has no sudo).
- **Per-file isolation is mandatory**: the suite shares one Motor client + session event loop, so a
  single `pytest` process corrupts ~100 tests across files. Run `for f in tests/test_*.py; do pytest "$f"; done`
  → green. The single-process count is isolation noise, not real failures.
- Tests expect specific env: `ADMIN_TELEGRAM_IDS=100000001,1862754938`,
  `INTERNAL_API_SECRET=lydo_internal_dev_secret_…`, `ENABLE_DEV_LOGIN=true`, throwaway TON mnemonic
  (`tonsdk.crypto.mnemonic_new`) + Fernet key, `TON_NETWORK=testnet`.

## RTP / game calibration

Target RTP is **90–92%** (configurable). Engines and their knobs:

| Game | Knob | Source |
|------|------|--------|
| Crash | `HOUSE_DIVISOR` (1/N instant-crash) → RTP ≈ 1−1/N | code constant |
| Mines | `RTP` scalar | code constant |
| Plinko | multiplier tables, normalized to target at load | code constant |
| Wheel | segment weights, **auto-recalibrated** (`services.wheel_recalibration`) | DB |
| Cases | basket weights, **two-tier** rebuild (`tools.rebuild_competitive_cases`) | DB |
| Roulette | basket floors | DB |

Solver patterns that recur:
- **Hit an exact EV**: weight ∝ `exp(α·value)`, binary-search α. Use **log-sum-exp stabilization**
  (subtract max exponent) or `math.exp` overflows on big values (7000-TON gifts).
- **Normalize to a fixed total** (1e6) to stay inside MongoDB's int64; never scale rarest→1 (overflows).
- **Two-tier cases**: reserve fixed *winnable* probabilities for rare/epic/legendary, weight the
  common/uncommon bulk to hit 90% RTP. Feasibility-adjust at the 3-TON gift floor (cheap cases) and the
  catalog ceiling (whale cases). A big jackpot (>50×) at 90% RTP is *necessarily* near-unwinnable — this
  is math, not a bug.
- **Self-healing recalibration**: baseline frozen/unpriced segments on canonical design weights, fail-safe
  (don't persist if the band is unreachable), and the **scheduler re-runs hourly** so live floor drift can't
  re-introduce a leak.

## Live floor prices (Fragment pipeline)

`services.floor_watcher` scrapes `fragment.com/gifts/<slug>` → `gift_floor_prices`. The critical link is
`services.recalibration.sync_and_recalibrate_all` (hourly + on startup): `gift_floor_prices` →
`items.floor_price_ton` → rebuild cases (two-tier) → recalibrate wheel. Fragment is the only source reachable
from the host (Portals doesn't resolve + needs expiring auth; Tonnel 403). Cheapest real gift floors at **3 TON**.

## Money safety

Multi-document money flows use `core.db.with_txn(callback)` (Mongo transactions, replica-set required):
marketplace `buy_listing`, sell-review approve, promo redeem. Inside a transaction a failed step
(e.g. insufficient balance) **auto-rolls-back** — drop the manual un-flip logic. Keep compare-and-set
guards (`{status:"active"}`, `{balance_ton:{$gte:price}}`) as the concurrency gate.

## WebSocket auth

JWT travels in the **first message frame** (`{"token":"…"}`), never the URL (`core.auth.authenticate_ws`
accepts the socket then reads the frame; legacy `?token=` still honoured). Frontend `lib/*Ws.js` send the
token in `onopen`. The token is stored under `tokenStore` key **`lydo_token`** — reading the wrong key
(`auth_token`) silently kills the socket (this was the "crash never animates" bug).

## Security baseline

On mainnet the app **refuses to boot** without `SETTINGS_ENCRYPTION_KEY` / `INTERNAL_API_SECRET` /
`ADMIN_API_KEY`, and if `ENABLE_DEV_LOGIN=true`. OpenAPI docs are disabled on mainnet. Admin surface uses
RBAC (`get_admin_or_readonly_support`: full admins write, `SUPPORT_TELEGRAM_IDS` read-only). Deposit/gift
memo nonces are 128-bit. Never commit secrets (`.env`, `*.key`, `*.mnemonic`, `mongo-keyfile` are gitignored).
