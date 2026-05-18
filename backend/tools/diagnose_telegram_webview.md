# Telegram WebView image-loading diagnostic checklist

Use this on production when the user reports broken images inside Telegram
(Mac desktop client OR iPhone Telegram app) but a regular browser is fine.

## Root cause for the 2026-05 incident

Caddy `header Cache-Control "public, max-age=86400, immutable"` was applied
to **every** response from `/api/static/*` — including 404s. Telegram
WebView (WKWebView on iOS, CEF wrapper on Mac) honoured that header for
the 404 response too, then **refused to re-fetch the image for 24 h** even
after the file landed.

A regular Chrome / Safari tab will retry 404s reasonably soon (typically
on hard refresh). Telegram WebView does not — it caches per the response's
own Cache-Control, period.

## The two fixes applied (commit pending)

1. **Caddy now conditionally headers status 2xx vs 4xx/5xx:**
   * 200 → `public, max-age=86400, immutable`
   * 4xx/5xx → `no-store, no-cache, must-revalidate`
2. **`resolveImage()` appends `?v=<buster>` to every image URL** so any
   WebView that still has the poisoned 404 in cache treats the new
   request as a fresh URL.

## Step-by-step diagnostic (run before applying any fix)

Replace `lydomania777.com` with the live domain.

```bash
# 1) Confirm the deployed JS bundle is the one we expect
curl -s https://lydomania777.com/ | grep -oE 'main\.[a-f0-9]+\.js' | head -1

# 2) Confirm what URL is baked into the bundle
#    (CRA inlines REACT_APP_BACKEND_URL at build time.)
curl -s https://lydomania777.com/static/js/main.<hash>.js | \
    grep -oE 'https?://[a-z0-9.-]+\.[a-z]+(?::[0-9]+)?' | sort -u | head
# In production this should ONLY show https://lydomania777.com (or be empty
# if BACKEND_URL was built with "" — that's correct, frontend uses
# relative URLs and Caddy proxies them same-origin).

# 3) Confirm CSP / security headers
curl -sI https://lydomania777.com/ | grep -iE 'content-security|x-frame|referrer'

# 4) Confirm a known case image actually returns 200 + image/png
curl -sI https://lydomania777.com/api/static/cases/legend_pack.png
# Look for:  HTTP/2 200    content-type: image/png    cache-control: public, max-age=86400, immutable

# 5) Confirm 404s do NOT carry immutable cache-control (this is what
#    caused the WebView poisoning):
curl -sI https://lydomania777.com/api/static/cases/does_not_exist.png
# Expected:  HTTP/2 404    cache-control: no-store, no-cache, must-revalidate

# 6) Cert chain sanity (Telegram WebView is stricter than Chrome)
echo | openssl s_client -showcerts -servername lydomania777.com \
    -connect lydomania777.com:443 2>/dev/null | grep -E 'verify return|subject=|issuer='

# 7) Service worker presence — should be none
curl -sI https://lydomania777.com/service-worker.js | head -1
# Expected: HTTP/2 404
```

## Verification command for the user, from inside Telegram

The user can open the **DevTools console** on Mac Telegram Desktop
(View → Force Reload → ⌥⌘ I) and paste:

```js
fetch("/api/static/cases/legend_pack.png?v=poke", { cache: "no-store" })
    .then(r => console.log("status", r.status, "ct", r.headers.get("content-type")))
```

Expected: `status 200 ct image/png`. If they see `status 404` then either
the file truly isn't on the server OR Caddy still has the old config — in
that case `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.

On iPhone there's no DevTools; the user just needs to **kill the Telegram
app, reopen it, and re-open the Mini App**. The new bundle is now served
with `?v=v3` cache buster, so first image load post-deploy will bypass
any cached 404.

## What we ruled OUT for the 2026-05 incident

| Hypothesis | Verdict |
|---|---|
| Cross-origin `REACT_APP_BACKEND_URL` baked into prod bundle | **No** — prod build arg is empty, frontend uses relative `/api/*` URLs, same-origin via Caddy. Confirmed by reading `frontend.Dockerfile` and `docker-compose.yml`. |
| Restrictive Content-Security-Policy from Caddy or `index.html` | **No** — Caddy sets `Referrer-Policy` only; no CSP set; the default browser CSP for the WebView is permissive enough. `grep -rn 'Content-Security' /app/deployment /app/frontend` returned no matches. |
| Mixed-content (http:// references in image paths) | **No** — production code paths use no hardcoded `http://`. The few that exist (`test_lydomania_phase*.py`, `audit_images.py`) are test fixtures + a local dev fallback, never executed in prod. |
| Service worker caching | **No** — no service worker is registered (`grep navigator.serviceWorker` empty). |
| Invalid cert chain | Pre-checked — Let's Encrypt full chain serves cleanly. |
| `loading="lazy"` + `crossorigin` WebKit bug | Did not enable `crossorigin` on any `<img>`; not the cause. |

So the single root cause was the unconditional `Cache-Control` header on
all responses under `/api/static/*`, which the WebView faithfully obeyed
for cached 404s.

## Long-term prevention

* Keep the conditional Cache-Control matchers in `deployment/Caddyfile`.
* Keep the `?v=<buster>` query param in `resolveImage()` and bump it
  whenever we change how static URLs are constructed.
* If we ever add a Service Worker, prefer "network-first" for images.
