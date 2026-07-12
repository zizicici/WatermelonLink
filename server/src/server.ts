import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import type { LinkConfig } from "./config.js";
import { FixedWindowRateLimiter } from "./rate-limiter.js";
import { RoomRegistry, type PeerRole } from "./rooms.js";
import { TicketService } from "./tickets.js";

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

export function createLinkServer(config: LinkConfig, developmentMiddleware?: Middleware) {
  const tickets = new TicketService(config.ticketSigningSecret, config.ticketTTLSeconds);
  const limiter = new FixedWindowRateLimiter(config.ticketRequestsPerMinute, 60_000);
  const rooms = new RoomRegistry(config);
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });

  const server = createServer((request, response) => {
    setSecurityHeaders(response, config.production);
    void route(request, response).catch((error: unknown) => {
      console.error("request_failed", error instanceof Error ? error.message : error);
      if (!response.headersSent) json(response, 500, { error: "internal_error" });
      else response.end();
    });
  });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", config.publicOrigin);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json(response, 200, { ok: true, ...rooms.stats() });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/config") {
      return json(response, 200, {
        protocolVersion: 1,
        publicOrigin: config.publicOrigin,
        turnstileEnabled: config.turnstileEnabled,
        turnstileSiteKey: config.turnstileEnabled ? config.turnstileSiteKey : null
      });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/tickets") {
      const ip = clientIP(request, config.trustProxy);
      if (!limiter.consume(ip)) return json(response, 429, { error: "rate_limited" });
      const body = await readJSON(request, 8_192);
      if (!body || typeof body.capabilityHash !== "string" || typeof body.turnstileToken !== "string") {
        return json(response, 400, { error: "invalid_request" });
      }
      if (config.turnstileEnabled && !(await verifyTurnstile(config, body.turnstileToken, ip))) {
        return json(response, 403, { error: "human_verification_failed" });
      }
      try {
        const issued = tickets.issue(body.capabilityHash);
        return json(response, 201, {
          ticket: issued.ticket,
          sessionID: issued.claims.sessionID,
          expiresAt: new Date(issued.claims.expiresAt * 1_000).toISOString(),
          expiresInSeconds: Math.max(0, issued.claims.expiresAt - Date.now() / 1_000)
        });
      } catch {
        return json(response, 400, { error: "invalid_capability_hash" });
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "method_not_allowed" });
    if (developmentMiddleware) {
      developmentMiddleware(request, response, () => json(response, 404, { error: "not_found" }));
      return;
    }
    serveStatic(config.staticRoot, url.pathname, request.method === "HEAD", response);
  }

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", config.publicOrigin);
    const role = url.searchParams.get("role");
    const claims = tickets.verify(url.searchParams.get("ticket") ?? "");
    if (url.pathname !== "/ws/v1" || (role !== "browser" && role !== "phone") || !claims) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      rooms.attach(websocket, claims, role as PeerRole, clientIP(request, config.trustProxy));
    });
  });

  server.on("close", () => {
    rooms.close();
    websocketServer.close();
  });
  return server;
}

function clientIP(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-real-ip"];
    if (typeof forwarded === "string" && forwarded.length <= 64) return forwarded;
  }
  return request.socket.remoteAddress ?? "unknown";
}

async function verifyTurnstile(config: LinkConfig, token: string, ip: string): Promise<boolean> {
  if (!config.turnstileSecretKey || token.length > 2_048) return false;
  const form = new URLSearchParams({ secret: config.turnstileSecretKey, response: token, remoteip: ip });
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(5_000)
    });
    const result = await response.json() as { success?: boolean; action?: string; hostname?: string };
    return result.success === true && result.action === "create_link" &&
      (!config.turnstileExpectedHostname || result.hostname === config.turnstileExpectedHostname);
  } catch {
    return false;
  }
}

async function readJSON(request: IncomingMessage, maximumBytes: number): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > maximumBytes) return null;
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; } catch { return null; }
}

function serveStatic(root: string, pathname: string, headOnly: boolean, response: ServerResponse): void {
  const localizedPage = /^\/(?:zh-Hans|zh-Hant|ja|ko|de|fr|es|es-419|pt-BR|pt-PT|ru|uk)(?:\/pair)?\/?$/.test(pathname);
  const requested = pathname === "/" || pathname === "/pair" || localizedPage ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const file = join(root, safePath);
  try {
    const info = statSync(file);
    if (!info.isFile()) throw new Error("not_file");
    response.statusCode = 200;
    response.setHeader("content-type", file.endsWith("apple-app-site-association") ? "application/json; charset=utf-8" : contentTypes[extname(file)] ?? "application/octet-stream");
    const hashedAsset = /[/\\]assets[/\\]index-[A-Za-z0-9_-]+\.(?:css|js)$/.test(file);
    response.setHeader("cache-control", file.endsWith("index.html") ? "no-cache" : hashedAsset ? "public, max-age=31536000, immutable" : "public, max-age=3600");
    if (headOnly) {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
  } catch {
    json(response, 404, { error: "not_found" });
  }
}

function setSecurityHeaders(response: ServerResponse, production: boolean): void {
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss: https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  if (production) response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}
