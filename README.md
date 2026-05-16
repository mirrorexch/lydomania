# Lydomania

Telegram Mini App TON Casino — FastAPI + React + MongoDB, deployed via Docker Compose + Caddy.

**To deploy:** follow [`DEPLOY.md`](./DEPLOY.md) end-to-end.
**To harden:** see [`SECURITY.md`](./SECURITY.md).

## Tree

```
backend/       FastAPI app, watchers, scheduler, aiogram bot worker
frontend/      React (CRA + craco) Telegram Mini App
deployment/    docker-compose stack, Caddyfile, Dockerfiles, ops scripts
DEPLOY.md      11-part install guide for first-time operators
SECURITY.md    Hardening checklist
```

## Quick start (on a fresh VPS)

```bash
git clone <this-repo> lydomania && cd lydomania/deployment
cp .env.example .env
./scripts/rotate-secrets.sh
./scripts/generate-ton-vault.sh
nano .env                # fill DOMAIN, TELEGRAM_*, ADMIN_*, ACME_EMAIL
docker compose up -d
./scripts/first-run-check.sh
```

See [`DEPLOY.md`](./DEPLOY.md) for the full walkthrough.
