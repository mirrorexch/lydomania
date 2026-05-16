# Lydomania — Security Checklist

A short, no-bullshit hardening list to run **after** the stack is up via
`DEPLOY.md`. Skim, do, move on.

---

## 1 · The vault mnemonic (the most important thing)

- The 24 words give **anyone** who knows them full control of every TON +
  NFT the vault holds. Treat them like the keys to a safe.
- ✅ Write them on **paper**, two copies, in **two physically separate** safe
  locations (e.g. one with you, one in a sealed envelope at a parent's house).
- ✅ Store the digital copy only inside `deployment/.env` on the **VPS itself**,
  which is firewalled and SSH-key-only. **Nowhere else.**
- ❌ Do NOT paste them into ChatGPT, Slack, Discord, cloud Notes, screenshots,
  iCloud, Google Drive, email. Ever. The dev mnemonic that lived in chat is
  considered burned — that's why Part 6 of DEPLOY.md mints a fresh one.
- ❌ Do NOT take a photo of the paper with a phone that has cloud backup on.
- ⏭ When operating volume grows past ~10k TON, migrate to a **hot/cold split**:
  keep the docker vault tiny (just enough for daily withdrawals), and 95%
  in cold storage on a separate device. (Phase 5: multi-sig.)

---

## 2 · VPS hardening (10 minutes, do once)

Run on the VPS as root:

```bash
# Firewall — only 22/80/443 reachable from the internet
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # Caddy HTTP (Let's Encrypt redirect)
ufw allow 443/tcp    # Caddy HTTPS
ufw --force enable
ufw status

# fail2ban — auto-ban brute-force attackers
apt-get update && apt-get install -y fail2ban
systemctl enable --now fail2ban

# Disable password SSH (key-only)
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh

# Unattended security upgrades
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades   # accept defaults
```

Optional but recommended:
- Create a non-root sudo user, SSH in as them, set `PermitRootLogin no` entirely.
- Add Cloudflare's IPs to ufw if you later enable the orange-cloud proxy (note:
  doing that breaks Caddy's auto-cert; use Cloudflare's Origin CA instead).

---

## 3 · Backups (do this on day 1, not day 30)

`scripts/backup-mongo.sh` writes daily `mongodump` archives to
`/opt/lydomania/deployment/backups/`. **On the VPS only is not a backup** — if
the VPS dies you lose everything.

**Weekly off-VPS copy** (pick one):

### Option A — S3 / R2 (recommended)
```bash
apt-get install -y awscli
# configure with AWS or Cloudflare R2 creds
aws configure
# weekly cron — append to /etc/crontab
0 4 * * 0  cd /opt/lydomania/deployment && aws s3 sync backups/ s3://your-bucket/lydomania-backups/ --delete --exclude "*" --include "lydomania-*.archive.gz"
```

### Option B — rsync to your laptop
```bash
# on your laptop, weekly
rsync -avh root@<vps-ip>:/opt/lydomania/deployment/backups/ ~/Backups/lydomania/
```

Test restores quarterly: `./scripts/restore-mongo.sh <backup-file>` on a
throwaway VM, verify cases / inventory / withdrawals reload cleanly.

---

## 4 · Secrets rotation

| Secret | When to rotate | Effect |
|---|---|---|
| `JWT_SECRET` | If you suspect any DB leak or admin laptop compromise | **Invalidates every active user session** — they'll re-auth via Telegram |
| `INTERNAL_API_SECRET` | If you suspect the VPS host was breached | Bot ↔ backend channel re-keyed |
| `SETTINGS_ENCRYPTION_KEY` | Almost never — rotating it makes the stored Portals authData unreadable. Re-enter Portals auth in `/admin/settings` after rotation. | Encrypted settings need re-encryption |
| `MONGO_INITDB_ROOT_PASSWORD` | If you ever exposed the Mongo container publicly | Backend + bot need restart |
| `ADMIN_API_KEY` | Per quarter | Affects only the back-channel admin curl path |
| Bot token | Immediately if leaked | `/revoke` + `/token` via @BotFather |

```bash
cd /opt/lydomania/deployment
./scripts/rotate-secrets.sh
docker compose up -d --force-recreate backend bot mongo
```

---

## 5 · Network surface

```
INTERNET ─┐
          ├── 80/443 ──> Caddy (TLS termination)
          │              ├── /api/* ──> backend:8000  (FastAPI)
          │              └── /*     ──> frontend:80   (nginx static)
          └── 22       ──> ssh (keys only, fail2ban)

Internal docker network only:
   mongo:27017      ← backend, bot
   backend:8000     ← bot, caddy
   frontend:80      ← caddy
```

✅ Mongo has **no published port** — verify: `docker compose ps` shows mongo's
PORTS column empty.

✅ Backend has **no published port** — same check.

✅ Only Caddy publishes 80/443.

✅ All cross-container traffic is on the internal `lydomania-net` bridge —
not reachable from the public internet.

---

## 6 · Application-level safety

- ✅ `ENABLE_DEV_LOGIN=false` in production. Backend logs a LOUD warning
  at startup if it's true.
- ✅ `auto_fulfill_dry_run=true` until you've tested real on-chain transfers
  on testnet.
- ✅ `portals_client_mode=mock` until you have a real Portals integration plan.
- ✅ Admin endpoints require an admin telegram ID (`ADMIN_TELEGRAM_IDS`). Add
  yourself, then add 1-2 ops people. Don't share JWTs.
- ✅ TON withdrawal addresses validated via `tonsdk.Address` checksum (rejects
  typos). Wrong-chain addresses (e.g. someone pastes an ETH 0x… string) are
  rejected with HTTP 400.
- ✅ Provably-fair: server seed hashes are published BEFORE each round; the
  full seed is revealed AFTER. Don't disable this — it's the casino's
  trust signal.

---

## 7 · Monitoring (Phase 5 — defer if you must)

Minimum viable:
- Read the daily digest DM at 09:00 UTC. If it stops, something's wrong.
- `docker compose ps` every few days — restart_count should be 0.
- `df -h /` to make sure the disk isn't filling with backups.

Recommended (1 hour of setup):
- UptimeRobot or Better Stack — free tier monitors `https://<domain>/api/health`
  every 5 min and SMS/emails you when it goes red.
- Cloudflare email alerts for DNS / SSL anomalies (free with their plan).

Heavy (Phase 5):
- Prometheus + Grafana + Loki via Docker Compose extension, scrape backend
  metrics, alert on RTP drift, vault drain rate, auto-fulfill failure rate.

---

## 8 · Incident response — when something goes wrong

| Symptom | First move |
|---|---|
| Site down | `docker compose ps`, then `docker compose logs --tail=200` |
| Withdrawals not processing | Check `/admin/settings` — is `auto_fulfill_enabled=true`? Is vault funded? |
| RTP drift > 5% across multiple cases | Open admin/cases, click "Sync All" to recalibrate against live floors |
| Suspicious balance changes | Pause the stack (`docker compose stop backend bot`), take a mongodump, investigate before restarting |
| Vault drained (worst case) | Stop the stack immediately. The on-chain history is permanent — file a report with TON Foundation + the exchanges the funds flowed to. This is why cold-storage matters. |

Keep this file open in a tab. Don't be a hero. Take a backup before you fix anything.
