# Lydomania — Deployment guide

This walks you through deploying Lydomania on your own VPS, **from scratch**,
assuming you've never used Linux before.

Total time: ~45 minutes (most of it waiting for builds and Let's Encrypt).

> **Before you start:** you'll create a brand-new TON vault during this guide.
> The vault that ran in development is considered compromised (its mnemonic
> may have been seen in chat). **Old vault funds: sweep them yourself BEFORE
> retiring the old mnemonic.**

---

## Part 1 · Get a VPS (5 min)

Pick **one** provider. They're both fine for Lydomania.

### Option A — Hetzner Cloud (€4/mo, EU)
1. Go to <https://www.hetzner.com/cloud>, click **Sign up**.
2. After verifying email + adding a card, click **Servers → New Server**.
3. Pick:
   - **Location:** Helsinki or Falkenstein (good latency for EU users).
   - **Image:** Ubuntu 24.04
   - **Type:** CX22 (2 vCPU, 4 GB RAM, 40 GB) — €4.50/mo
   - **SSH key:** see Part 3 below; for now click "Add SSH key" and paste yours.
   - **Name:** `lydomania-prod`
4. Click **Create & Buy**. You'll get the public IP within a minute.

### Option B — DigitalOcean ($6/mo)
1. Go to <https://www.digitalocean.com>, sign up.
2. **Create → Droplets**.
3. Pick:
   - **Region:** the one closest to your players.
   - **Image:** Ubuntu 24.04 (LTS) x64
   - **Plan:** Basic → Premium AMD → $6/mo (1 vCPU, 1 GB) — bump to $12 (2 vCPU, 2 GB) if you can.
   - **SSH key:** add yours (see Part 3).
4. **Create Droplet**.

**Write down the public IP** — you'll need it in Part 2.

---

## Part 2 · Get a domain (5 min)

The Mini App **must** be HTTPS-served. You need a real domain.

### Cloudflare (free, recommended)
1. Buy a domain at a registrar that supports DNS export (Namecheap, Porkbun, Cloudflare Registrar — they're all fine).
2. Add the domain to Cloudflare (Free plan):
   - <https://dash.cloudflare.com/> → **Add a Site** → paste your domain → Free plan.
   - Cloudflare gives you two nameservers (e.g. `kate.ns.cloudflare.com`). Go back to your registrar and replace the nameservers with these two.
3. Create the **A record** that points at your VPS:
   - In Cloudflare → **DNS → Records → Add record**.
   - Type **A**, Name **lydomania** (or whatever you want as subdomain — yields `lydomania.yourdomain.com`), IPv4 **<your VPS IP>**, **Proxy status: DNS only (grey cloud)**.
   - ⚠ Important: **grey cloud, not orange.** Caddy needs to terminate TLS itself; if Cloudflare proxies, Caddy can't get a Let's Encrypt cert.
4. (Optional) Add a CNAME `www` → `lydomania.yourdomain.com` if you want both to work.

DNS usually propagates in <2 min on Cloudflare. Test from your laptop:
```bash
dig +short lydomania.yourdomain.com   # should print your VPS IP
```

---

## Part 3 · SSH into the VPS (5 min)

### macOS / Linux
```bash
# generate a key (one-time per machine)
ssh-keygen -t ed25519 -C "you@yourmail.com"
# accept the default path (~/.ssh/id_ed25519), set a passphrase or leave empty

# print the public key — paste this into Hetzner/DigitalOcean's "Add SSH key"
cat ~/.ssh/id_ed25519.pub

# now SSH in
ssh root@<your-VPS-IP>
```

### Windows (PowerShell, Windows 10+)
```powershell
ssh-keygen -t ed25519 -C "you@yourmail.com"
# accept defaults

Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
# paste the printed line into the VPS provider's SSH-key field

ssh root@<your-VPS-IP>
```

If you forgot to add the key during VPS creation, both Hetzner and DigitalOcean
will email you the root password. Use it once with `ssh root@<IP>` and then run:
```bash
mkdir -p ~/.ssh && nano ~/.ssh/authorized_keys
# paste the line from your local `cat` command, save (Ctrl+O, Enter, Ctrl+X)
chmod 600 ~/.ssh/authorized_keys
```

---

## Part 4 · Install Docker (5 min)

Run this **on the VPS**, as root:
```bash
curl -fsSL https://get.docker.com | sh
# Add the current user to the docker group so you don't need sudo every time
usermod -aG docker $USER
# Verify
docker --version
docker compose version
```

If you're logged in as a non-root user, **log out and back in** so the group
change takes effect:
```bash
exit
ssh root@<your-VPS-IP>     # or your user
```

---

## Part 5 · Get the Lydomania code on the VPS

Two options. Pick one.

### Option A — From the deployment tarball (easiest)
The previous step in your build pipeline produced a tarball. Upload it:
```bash
# on your laptop
scp lydomania-deploy-v1.tar.gz root@<your-VPS-IP>:/opt/

# on the VPS
mkdir -p /opt/lydomania
cd /opt/lydomania
tar -xzf /opt/lydomania-deploy-v1.tar.gz --strip-components=1
ls -la
# you should see: backend/  frontend/  deployment/  DEPLOY.md  SECURITY.md  .gitignore
```

### Option B — From your private GitHub repo
1. **On your laptop**, push the `lydomania-git/` skeleton you got from the build to a fresh private repo:
   ```bash
   cd lydomania-git
   git remote add origin git@github.com:<your-username>/lydomania.git
   git push -u origin main
   ```
2. **On the VPS**:
   ```bash
   mkdir -p /opt && cd /opt
   git clone git@github.com:<your-username>/lydomania.git
   cd lydomania
   ```
   *(Use HTTPS + a personal-access-token if you don't want SSH keys on the VPS.)*

From here onward, **all commands run on the VPS, in `/opt/lydomania`**.

---

## Part 6 · Rotate secrets + configure .env

```bash
cd /opt/lydomania/deployment

# 1. Make a fresh .env from the template
cp .env.example .env

# 2. Generate strong random secrets (JWT, internal API, Fernet, Mongo password)
./scripts/rotate-secrets.sh

# 3. Mint a BRAND-NEW TON vault. SAVE THE 24 WORDS ON PAPER.
./scripts/generate-ton-vault.sh
# Type 'yes' to confirm. The script will print the new mainnet address.
# Verify on https://tonscan.org/address/<the-address>  (it'll show as 'Uninit'
# until first deposit — that's normal).

# 4. Open .env and fill in the human bits
nano .env
```

Required edits in `.env`:

| Variable | Value | Notes |
|---|---|---|
| `DOMAIN` | `lydomania.yourdomain.com` | exact subdomain from Part 2 |
| `MINI_APP_URL` | `https://lydomania.yourdomain.com` | https:// + same domain |
| `ACME_EMAIL` | your real email | for Let's Encrypt expiry warnings |
| `TELEGRAM_BOT_TOKEN` | `12345:AAEbGlr_…` | from @BotFather |
| `TELEGRAM_BOT_USERNAME` | `lydomania777_bot` | no @ |
| `ADMIN_TELEGRAM_IDS` | `1862754938` | comma-separated TG IDs — DM **@userinfobot** to find yours |
| `TONCENTER_API_KEY` | optional but recommended | free at <https://toncenter.com> — avoids rate-limits |

Save (Ctrl+O, Enter, Ctrl+X).

### Double-check before booting
```bash
grep -E '^(DOMAIN|MINI_APP_URL|TELEGRAM_BOT_TOKEN|ADMIN_TELEGRAM_IDS|ENABLE_DEV_LOGIN)=' .env
```
The last line must read `ENABLE_DEV_LOGIN=false`. Confirm it is.

> **About the bot token:** if your previous bot token was visible in chat,
> rotate it now — DM **@BotFather** → `/revoke` → choose `@lydomania777_bot` →
> `/token` to get a fresh one. Paste the new token into `.env`.

---

## Part 7 · Boot the stack

First boot — watch the logs as it comes up:
```bash
cd /opt/lydomania/deployment
docker compose up        # foreground, with logs
```

You'll see (in roughly this order):
- `mongo` starts and emits "Waiting for connections on port 27017".
- `backend` installs, then "Uvicorn running on http://0.0.0.0:8000".
- `bot` prints "Authorized as @lydomania777_bot".
- `frontend` builds (this is the slowest step — ~3 min). nginx then starts.
- `caddy` contacts Let's Encrypt and issues your TLS cert (~30 sec).

When you see `certificate obtained successfully` in the caddy logs, hit Ctrl+C
and bring it up in the background:
```bash
docker compose up -d
```

Now run the smoke check:
```bash
./scripts/first-run-check.sh
```
You should see all green ticks. If anything's amber/red, jump to **Part 11**.

---

## Part 8 · Update the BotFather menu URL

Even though `bot/run.py` sets it on every startup, do it once manually so
the button is also set on `/start` deep-links:

1. DM **@BotFather** on Telegram.
2. `/mybots` → choose **@lydomania777_bot** → **Bot Settings → Menu Button**.
3. Pick **Configure menu button**, type:
   ```
   🎰 Play
   ```
4. Paste your URL: `https://lydomania.yourdomain.com`.
5. Confirm.

Open the bot in Telegram and tap the menu button — your Mini App should
load.  Tap "Connect Wallet", connect Tonkeeper, you're in.

---

## Part 9 · Fund the new vault

Send a **0.1 TON test deposit** from any wallet to the new vault address.
Add the memo `test-fund-001` (any text works).

Wait 30 seconds, then on the VPS:
```bash
docker compose logs backend --tail=200 | grep -i deposit
```
You should see a line like:
```
deposit_watcher.handle_tx · credited 0.1 TON to user=...
```
If it doesn't appear within 90 seconds:
- Check the tx confirmed on <https://tonscan.org/address/<your-vault>>.
- Check `TONCENTER_API_KEY` is set (without it, you may be rate-limited).
- Check the memo matches the format the deposit intent expects (the Mini App
  generates one automatically — you don't need to type it yourself for real
  deposits).

When the test deposit credits successfully, send the rest of your operating
liquidity to the same address (recommend 50-200 TON to cover initial
withdrawals).

---

## Part 10 · Daily operations

### Where are the logs?
```bash
cd /opt/lydomania/deployment
docker compose logs -f          # tail everything
docker compose logs -f backend  # just backend
docker compose logs -f bot      # just bot
docker compose logs -f caddy    # just reverse proxy
```

### How do I restart one service?
```bash
docker compose restart backend
docker compose restart bot
```

### How do I update the code?
```bash
cd /opt/lydomania
git pull                          # if you used git in Part 5
./deployment/scripts/update.sh
```
(For tarball-deploys: scp the new tarball to `/opt/`, extract it on top of
the existing `/opt/lydomania/`, then run `./scripts/update.sh`.)

### How do I back up Mongo?
```bash
cd /opt/lydomania/deployment
./scripts/backup-mongo.sh                # writes ./backups/lydomania-<ts>.archive.gz
```
Add this to a daily cron:
```bash
crontab -e
# add this line, save:
0 3 * * *  cd /opt/lydomania/deployment && ./scripts/backup-mongo.sh >> /var/log/lydomania-backup.log 2>&1
```
The script keeps the last 30 backups.  Copy them off-VPS weekly to S3 / your
laptop / wherever (see SECURITY.md).

### How do I restore a backup?
```bash
cd /opt/lydomania/deployment
./scripts/restore-mongo.sh ./backups/lydomania-20260601-030000.archive.gz
```

### How do I add a new admin?
1. They DM @userinfobot → write down their numeric TG ID.
2. On the VPS: `nano /opt/lydomania/deployment/.env`
3. Append their ID to `ADMIN_TELEGRAM_IDS=1862754938,12345678`
4. Restart: `docker compose restart backend bot`

### When can I switch to real on-chain auto-fulfill?
After you've tested on **TON testnet** end-to-end. Then in the admin panel
at `https://your-domain/admin/settings`:
1. Flip `auto_fulfill_dry_run` → `false`
2. Flip `portals_client_mode` → `real`
3. Fund the vault with enough TON to cover at least 24h of expected withdrawals.

---

## Part 11 · Troubleshooting

### HTTPS doesn't work / "site can't be reached"
- `dig +short lydomania.yourdomain.com` must return your VPS IP.
- Cloudflare cloud must be **grey** (DNS only), not orange (proxied).
- Open VPS firewall: `ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 22/tcp && ufw enable`.
- Caddy logs: `docker compose logs caddy | grep -i acme` — look for ACME challenge failures.

### Telegram bot doesn't reply
- `docker compose logs bot --tail=50` — look for `Authorized as @...`. If you see "invalid token", your `TELEGRAM_BOT_TOKEN` is wrong/revoked.
- Cross-check: `curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe`. If that fails too, regenerate via `/revoke` + `/token` with @BotFather.

### Deposits don't credit
- Check the transaction on tonscan.org — did it actually confirm?
- `docker compose logs backend --tail=300 | grep -E "deposit|toncenter"` — if you see HTTP 429, set `TONCENTER_API_KEY` in `.env` and restart.
- The deposit memo on real deposits is auto-generated by the Mini App when the user clicks "Deposit". Manual sends without the right memo land in vault but aren't credited.

### `docker: permission denied while trying to connect to docker daemon`
You're not in the docker group. `sudo usermod -aG docker $USER` then log out + back in.

### `docker compose up` errors on missing var
Open `.env` and confirm every required variable has a value (no empty `KEY=` lines). Re-run `./scripts/rotate-secrets.sh` if secrets are blank.

### The frontend builds slow / out of memory
1 GB VPS isn't enough for the React build step. Either:
- Upgrade to 2 GB (the recommended spec)
- Or build the frontend on your laptop and copy `frontend/build/` to the VPS, then change `frontend.Dockerfile` to just copy the prebuilt folder.

---

## What's running, recap

| URL | Served by |
|---|---|
| `https://<domain>/` | nginx (`frontend` container) — React SPA |
| `https://<domain>/api/*` | uvicorn (`backend` container) |
| `https://<domain>/tonconnect-manifest.json` | served from React `public/` |
| `https://<domain>/api/static/*` | direct from `backend-static` volume (cached aggressively) |
| Bot DMs | aiogram long-polling (`bot` container) |
| Mongo | not exposed publicly. only reachable from the docker network. |

See `SECURITY.md` for the security hardening checklist you should run **after**
the stack is up.

Welcome to production. 🎰
