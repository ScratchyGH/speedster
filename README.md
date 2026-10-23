# Speedster

A full browser UI that runs inside a browser tab. Pages load through a forked Scramjet engine, every request is TLS-encrypted end to end inside libcurl.js (WASM), and raw TCP is carried by Speedster's own Wisp server running on Cloudflare Workers + Durable Objects.

## Stack

| Layer | What |
| --- | --- |
| `public/` | Browser UI: tabs, omnibox with suggestions, bookmarks bar, history, new tab page, settings, about:blank + tab cloak, panic key |
| `scripts/fork.mjs` | Speedster fork of Scramjet 1.1.0: rebranded engine and error pages, `$speedster$` runtime globals, XOR URL codec, sourcemaps off |
| `worker/index.js` | Speedster Wisp v1 server: per-session Durable Object, Cloudflare TCP sockets, real flow control (`CONTINUE` from actual write progress), private-network blocking, host blocklist, upstream relay for hosts Cloudflare can't reach |
| `libcurl-transport` | Transport for bare-mux; TLS happens in the page, the Wisp server only sees ciphertext. Patched to spread streams over a pool of Wisp sockets |
| `public/net.mjs` | Speedster network layer: Auto (Cloudflare edge first, Wisp fallback), Edge, or Secure (end-to-end TLS only) |
| `public/sw.js` | Scramjet service worker plus a cache of rewritten scripts, styles, fonts and images |

## Deploy

1. Push this folder to `github.com/ScratchyGH/speedster`.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Repo **Settings → Secrets → Actions**: add `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers") and `CLOUDFLARE_ACCOUNT_ID`.
4. Push to `main`. The workflow deploys the Worker first, reads its `workers.dev` URL, then builds the Pages site pointed at `wss://<worker>/wisp/`.

You get two working copies:
- `https://scratchygh.github.io/speedster/` (GitHub Pages + Cloudflare Wisp)
- `https://speedster.<you>.workers.dev/` (everything on Cloudflare, same-origin Wisp)

Set the repo variable `WISP_URL` to override which Wisp server the Pages build uses.

## Worker vars (`wrangler.toml`)

- `UPSTREAM_WISP` — another Wisp server (e.g. a VPS) used automatically when Cloudflare refuses a connection. Cloudflare Workers cannot open TCP to Cloudflare-proxied IPs, so sites behind Cloudflare need this to load.
- `BLOCKED_HOSTS` — comma list of domains to refuse.
- `ALLOW_PRIVATE` — set to `1` only for local testing.
- `SHARDS` — Wisp Durable Objects per Cloudflare colo (default 16).

## Endpoints

- `/wisp/` — Wisp v1 (multiplexed)
- `/wisp/<host>:<port>` — wsproxy, one socket per WebSocket
- `/edge` — HTTP and WebSocket relay over Cloudflare's network; reaches sites behind Cloudflare that raw TCP can't

## Local

```
npm install
npm run dev
```

Open `http://127.0.0.1:8787`.

## Shortcuts

Alt+T new tab · Alt+Shift+T reopen · Alt+W close · Ctrl+L / Alt+D address bar · Ctrl+R / F5 reload · Alt+←/→ back/forward · Ctrl+Tab cycle · Alt+1–9 jump · Alt+H history · Alt+, settings

## Licenses

Scramjet (MIT), libcurl-transport (AGPL-3.0), bare-mux (MercuryWorkshop). Speedster is AGPL-3.0.
