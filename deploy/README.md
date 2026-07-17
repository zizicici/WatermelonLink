# VPS deployment

The reference deployment runs Node on `127.0.0.1:4173` behind Caddy. Only Caddy binds public ports. Caddy serves the production web build from `/opt/watermelon-link/web-current`; `/healthz`, `/api/*`, and `/ws/*` are the only routes proxied to Node. The dedicated 8 GB host caps the signaling service at 6 GB so the operating system and Caddy retain headroom.

Run exactly one signaling process per deployment epoch. Its in-memory signing subkey intentionally invalidates outstanding tickets on restart; multiple independent processes would reject each other's tickets.

1. Install Node.js 22 or newer and Caddy.
2. Extract a server release to `/opt/watermelon-link/releases/<stamp>` and point `/opt/watermelon-link/current` to it.
3. Extract `dist/web` to `/opt/watermelon-link/web-releases/<stamp>` and point `/opt/watermelon-link/web-current` to it.
4. Create the `watermelon-link` system user.
5. Copy `watermelon-link.env.example` to `/etc/watermelon-link.env`, replace all secrets, and set mode `0600`.
6. Install `watermelon-link.service`, enable it, and verify `http://127.0.0.1:4173/healthz`.
7. Install the Caddyfile only after the local health check succeeds and `web-current` exists.

## Web-only releases

Run `scripts/deploy-web.sh <ssh-host>` from a clean checkout. It builds and uploads only `dist/web`, atomically switches `web-current`, then verifies the exact fingerprinted bundle through the public origin. It does not change `current`, restart `watermelon-link`, or reload Caddy. Tabs that are pairing or transferring therefore continue to use their already loaded JavaScript without interruption.

Hashed JavaScript and CSS are immutable for one year, while `index.html` is never cached. Keep the cache and security headers in `deploy/Caddyfile` aligned with the standalone Node static server.

## Signaling releases

Server changes still require switching `/opt/watermelon-link/current` and restarting `watermelon-link`. A restart invalidates outstanding tickets and interrupts rooms that are still pairing, but established WebRTC data channels no longer depend on the signaling process. Check `/healthz` and avoid restarting while `rooms` or `connections` are nonzero.

The Caddy configuration accepts `CF-Connecting-IP` only when the immediate peer belongs to Cloudflare's published ranges and aborts direct public requests. Restrict ports 80 and 443 to Cloudflare's published address ranges at the host or provider firewall as well; Caddy's rejection protects the application but is not a substitute for a network firewall. Update those ranges when Cloudflare changes its list.

Keep Node bound to loopback when `TRUST_PROXY=true`. The application accepts `X-Real-IP` only from a loopback peer and only when the header contains one valid IP address.

Ticket, connection, and unpaired-room quotas use a public IPv4 address or IPv6 `/64` as the client network. Several users behind one carrier-grade NAT therefore share those quotas; keep the unpaired-room ceiling small enough to preserve abuse resistance and raise it only with observed production evidence.

HTTP access logging is deliberately not enabled: WebSocket URLs contain short-lived signed tickets. Service logs must never include request URLs, ticket bodies, relayed payloads, or QR fragments.

Production must not start when Turnstile is bypassed or its keys are missing. Test the deployment on a loopback-only alternate port before enabling the public unit.

Run `node scripts/smoke.mjs https://link.watermelonbackup.com` after deployment. In production this verifies health, protocol version, public origin, and Turnstile configuration without assuming the live service has no active users. To exercise ticket creation and signaling too, provide a fresh valid widget token as `TURNSTILE_TOKEN`.

The supplied Dockerfile includes a `/healthz` check. When host Caddy supplies `X-Real-IP`, run the container with Linux host networking and override `HOST=127.0.0.1`; ordinary Docker port publishing makes Caddy appear as a bridge address, so the application intentionally ignores the forwarded header. Alternatively, run the trusted reverse proxy in the same container network and extend the application with an explicit proxy-CIDR allowlist before enabling `TRUST_PROXY`.
