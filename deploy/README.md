# VPS deployment

The reference deployment runs Node on `127.0.0.1:4173` behind Caddy. Only Caddy binds public ports. The service is intentionally capped at 512 MB by systemd even when the host has more memory.

1. Install Node.js 22 or newer and Caddy.
2. Extract a built release to `/opt/watermelon-link/releases/<stamp>` and point `/opt/watermelon-link/current` to it.
3. Create the `watermelon-link` system user.
4. Copy `watermelon-link.env.example` to `/etc/watermelon-link.env`, replace all secrets, and set mode `0600`.
5. Install `watermelon-link.service`, enable it, and verify `http://127.0.0.1:4173/healthz`.
6. Install the Caddyfile only after the local health check succeeds.

The Caddy configuration accepts `CF-Connecting-IP` only when the immediate peer belongs to Cloudflare's published ranges and aborts direct public requests. Restrict ports 80 and 443 to Cloudflare's published address ranges at the host or provider firewall as well; Caddy's rejection protects the application but is not a substitute for a network firewall. Update those ranges when Cloudflare changes its list.

HTTP access logging is deliberately not enabled: WebSocket URLs contain short-lived signed tickets. Service logs must never include request URLs, ticket bodies, relayed payloads, or QR fragments.

Production must not start when Turnstile is bypassed or its keys are missing. Test the deployment on a loopback-only alternate port before enabling the public unit.
