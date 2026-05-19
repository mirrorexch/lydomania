# Lydomania deployment package

This folder contains everything needed to run Lydomania on your own VPS
with Docker Compose.

**Start with the full walkthrough in [`../DEPLOY.md`](../DEPLOY.md)** —
it is written for someone who has never used Linux before.

## Quick reference (for returning operators)

```bash
cd deployment
cp .env.example .env
./scripts/rotate-secrets.sh           # JWT_SECRET, MONGO password, etc.
./scripts/generate-ton-vault.sh       # NEW vault mnemonic + address (one-time)
nano .env                             # fill DOMAIN, TELEGRAM_*, ADMIN_*, ACME_EMAIL
docker compose up -d
./scripts/first-run-check.sh
```

## What's running

| Service     | Image / Build         | Port (internal) | Public? |
|-------------|-----------------------|-----------------|---------|
| `mongo`     | `mongo:7`             | 27017           | no      |
| `backend`   | `backend.Dockerfile`  | 8000            | no (via caddy) |
| `bot`       | `bot.Dockerfile`      | —               | no (long-polling outbound) |
| `frontend`  | `frontend.Dockerfile` | 80              | no (via caddy) |
| `caddy`     | `caddy:2.8-alpine`    | 80 + 443        | **yes** |

## Daily ops cheatsheet

```bash
docker compose ps                        # status
docker compose logs -f backend           # tail backend logs
docker compose logs -f bot               # tail bot logs
docker compose restart backend           # restart one service
./scripts/update.sh                       # pull, rebuild, restart
./scripts/backup-mongo.sh                 # one-shot mongo dump
```

See [`../SECURITY.md`](../SECURITY.md) for the production hardening checklist.
