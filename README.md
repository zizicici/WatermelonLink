# Watermelon Link

Browser receiver and short-lived signaling service for Watermelon Backup.

Watermelon Link lets a desktop browser choose a local folder and establish a direct, authenticated WebRTC connection with the Watermelon iOS app. The server only validates a human-initiated pairing request and relays encrypted WebRTC signaling. It never accepts photo data and does not provide TURN.

## Repository layout

- `web/` — the browser experience served at `link.watermelonbackup.com`
- `server/` — bounded ticket and WebSocket signaling service
- `protocol/` — language-neutral protocol and security contract
- `deploy/` — Docker, Caddy, and environment examples

The web UI treats `WatermelonWebsite` as its parent design system. `web/src/brand.css` is an exact copy of the main site's stylesheet, and `web/src/link.css` contains only Link-specific connection states. Brand icons, favicons, header/footer structure, responsive navigation, and the 13 locale choices follow the main site.

## Local development

```sh
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:4173`. Local development bypasses Turnstile only when `NODE_ENV` is not `production` and `TURNSTILE_BYPASS=true`.

## Verification

```sh
npm test
npm run build
```

The server integration test creates a ticket, confirms that it allocates no room, joins browser and phone peers, and relays an opaque encrypted payload.

For a loopback deployment smoke test:

```sh
npm run smoke -- http://127.0.0.1:4173
```

## Production requirements

- Node.js 22 or newer
- a 32-byte-or-longer random `TICKET_SIGNING_SECRET`
- Cloudflare Turnstile site and secret keys
- HTTPS/WSS at `https://link.watermelonbackup.com`
- an origin firewall when `TRUST_PROXY=true`

The iOS app and browser must use protocol version 1. No session state is written to disk.
See `deploy/README.md` for the VPS activation sequence and logging constraints.

## Current boundary

This repository currently completes folder selection, human verification, short-lived pairing, encrypted signaling, WebRTC negotiation, and DataChannel authentication. Photo enumeration, manifests, resumable writes, and iOS code are intentionally deferred until this connection path has been exercised end to end.
