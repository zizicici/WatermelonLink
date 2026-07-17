import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { classifyClientPlatform } from "./client-platform.js";
import type { LinkConfig } from "./config.js";
import { normalizePublicOrigin } from "./config.js";
import { clientNetworkPrefix, isPlausibleTurnstileToken, resolveClientAddress } from "./network-security.js";
import { FixedWindowRateLimiter } from "./rate-limiter.js";
import { RoomRegistry, type PeerRole } from "./rooms.js";
import { isCanonicalCapabilityHash, TicketService } from "./tickets.js";
import { TurnstileVerifier } from "./turnstile.js";
import { UsageMetrics } from "./usage-metrics.js";

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
  const publicOrigin = normalizePublicOrigin(config.publicOrigin);
  const websocketOrigin = new URL(publicOrigin);
  websocketOrigin.protocol = websocketOrigin.protocol === "https:" ? "wss:" : "ws:";
  const tickets = new TicketService(config.ticketSigningSecret, config.ticketTTLSeconds);
  const ticketLimiter = new FixedWindowRateLimiter(config.ticketRequestsPerMinute, 60_000);
  const rawTicketLimiter = new FixedWindowRateLimiter(config.rawTicketRequestsPerMinute, 60_000);
  const upgradeLimiter = new FixedWindowRateLimiter(config.websocketUpgradesPerMinute, 60_000);
  const untrustedUpgradeLimiter = new FixedWindowRateLimiter(config.websocketUpgradesPerMinute, 60_000);
  const ticketUpgradeLimiter = new FixedWindowRateLimiter(12, 60_000);
  const rawGlobalUpgradeLimiter = new FixedWindowRateLimiter(config.websocketRawUpgradesGlobalPerMinute, 60_000, 1);
  const globalUpgradeLimiter = new FixedWindowRateLimiter(config.websocketUpgradesGlobalPerMinute, 60_000, 1);
  const turnstile = new TurnstileVerifier({
    secretKey: config.turnstileSecretKey,
    expectedHostname: config.turnstileExpectedHostname,
    maximumConcurrent: config.turnstileMaximumConcurrent,
    requestsPerMinute: config.turnstileRequestsPerMinute
  });
  const usageMetrics = new UsageMetrics(
    config.usageMetricsPath,
    config.usageMetricsRetentionDays,
    config.ticketSigningSecret
  );
  const rooms = new RoomRegistry(config, {
    connectionCompleted: (platform, network) => usageMetrics.recordConnection(platform, network)
  });
  const websocketServerOptions = {
    noServer: true,
    allowSynchronousEvents: false,
    autoPong: false,
    maxFragments: 64,
    maxPayload: config.maxMessageBytes
  };
  const websocketServer = new WebSocketServer(websocketServerOptions);

  const server = createServer((request, response) => {
    setSecurityHeaders(response, config.production, websocketOrigin.origin);
    void route(request, response).catch((error: unknown) => {
      console.error("request_failed", error instanceof Error ? error.message : error);
      if (!response.headersSent) json(response, 500, { error: "internal_error" });
      else response.end();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.maxHeadersCount = 64;
  server.maxConnections = config.maxServerConnections;

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", publicOrigin);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json(response, 200, { ok: true, ...rooms.stats() });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/config") {
      return json(response, 200, {
        protocolVersion: 1,
        publicOrigin,
        turnstileEnabled: config.turnstileEnabled,
        turnstileSiteKey: config.turnstileEnabled ? config.turnstileSiteKey : null
      });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/tickets") {
      if (!isJSONRequest(request)) {
        request.resume();
        return json(response, 415, { error: "unsupported_media_type" });
      }
      if (!isTrustedTicketRequest(request, publicOrigin)) {
        request.resume();
        return json(response, 403, { error: "cross_site_request" });
      }
      const ip = clientIP(request, config.trustProxy);
      const network = clientNetworkPrefix(ip);
      if (!rawTicketLimiter.consume(network)) return retryJSON(response, 429, 60, { error: "rate_limited" });
      const body = await readJSON(request, 8_192);
      if (!body || typeof body.capabilityHash !== "string" || typeof body.turnstileToken !== "string" ||
          !isCanonicalCapabilityHash(body.capabilityHash) ||
          body.turnstileToken.length > 2_048 ||
          (config.turnstileEnabled && !isPlausibleTurnstileToken(body.turnstileToken))) {
        return json(response, 400, { error: "invalid_request" });
      }
      if (!ticketLimiter.consume(network)) return retryJSON(response, 429, 60, { error: "rate_limited" });
      if (config.turnstileEnabled) {
        const abort = new AbortController();
        const abortVerification = () => abort.abort();
        request.once("aborted", abortVerification);
        response.once("close", abortVerification);
        const verification = await turnstile.verify(body.turnstileToken, ip, abort.signal);
        request.off("aborted", abortVerification);
        response.off("close", abortVerification);
        if (verification === "busy") {
          return retryJSON(response, 503, 5, { error: "human_verification_unavailable" });
        }
        if (verification === "unavailable") {
          return retryJSON(response, 503, 5, { error: "human_verification_unavailable" });
        }
        if (verification !== "verified") return json(response, 403, { error: "human_verification_failed" });
      }
      try {
        const issued = tickets.issue(body.capabilityHash);
        try { usageMetrics.recordGeneratedLink(classifyClientPlatform(request.headers), network); } catch {}
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
    socket.on("error", () => socket.destroy());
    const rejectUpgrade = (response: string) => {
      const forceClose = setTimeout(() => socket.destroy(), 250);
      forceClose.unref();
      socket.once("close", () => clearTimeout(forceClose));
      try {
        socket.end(response, () => socket.destroy());
      } catch {
        socket.destroy();
      }
    };
    const ip = clientIP(request, config.trustProxy);
    const network = clientNetworkPrefix(ip);
    const trustedRequest = isTrustedWebSocketRequest(request, publicOrigin);
    const networkLimiter = trustedRequest ? upgradeLimiter : untrustedUpgradeLimiter;
    if (!networkLimiter.consume(network)) {
      rejectUpgrade("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nRetry-After: 60\r\n\r\n");
      return;
    }
    if (!rawGlobalUpgradeLimiter.consume("global")) {
      rejectUpgrade("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 60\r\n\r\n");
      return;
    }
    if (!trustedRequest) {
      rejectUpgrade("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "/", publicOrigin);
    } catch {
      rejectUpgrade("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const role = url.searchParams.get("role");
    const claims = tickets.verify(url.searchParams.get("ticket") ?? "");
    if (url.pathname !== "/ws/v1" || (role !== "browser" && role !== "phone") || !claims) {
      rejectUpgrade("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    if (!ticketUpgradeLimiter.consume(claims.sessionID)) {
      rejectUpgrade("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nRetry-After: 60\r\n\r\n");
      return;
    }
    if (!globalUpgradeLimiter.consume("global")) {
      rejectUpgrade("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 60\r\n\r\n");
      return;
    }
    try {
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        const rejectError = () => {
          try { websocket.terminate(); } catch {}
        };
        websocket.once("error", rejectError);
        const platform = role === "browser" ? classifyClientPlatform(request.headers) : null;
        if (rooms.attach(websocket, claims, role as PeerRole, network, platform)) {
          websocket.off("error", rejectError);
        }
      });
    } catch {
      socket.destroy();
    }
  });

  let resourcesClosed = false;
  const closeResources = () => {
    if (resourcesClosed) return;
    resourcesClosed = true;
    rooms.close();
    websocketServer.close();
  };
  server.on("close", () => {
    closeResources();
    void usageMetrics.close();
  });
  const shutdown = (callback?: (error?: Error) => void) => {
    server.close((error) => {
      void usageMetrics.close().then(
        () => callback?.(error),
        () => callback?.(error)
      );
    });
    closeResources();
  };
  return Object.assign(server, { shutdown });
}

function isJSONRequest(request: IncomingMessage): boolean {
  const contentType = request.headers["content-type"];
  return typeof contentType === "string" && contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isTrustedTicketRequest(request: IncomingMessage, publicOrigin: string): boolean {
  const fetchSite = request.headers["sec-fetch-site"];
  if (Array.isArray(fetchSite)) return false;
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.origin;
  if (Array.isArray(origin)) return false;
  if (!origin) return true;
  try {
    return normalizePublicOrigin(origin) === publicOrigin;
  } catch {
    return false;
  }
}

function isTrustedWebSocketRequest(request: IncomingMessage, publicOrigin: string): boolean {
  const origin = request.headers.origin;
  if (Array.isArray(origin)) return false;
  if (!origin) return true;
  try {
    return normalizePublicOrigin(origin) === publicOrigin;
  } catch {
    return false;
  }
}

function clientIP(request: IncomingMessage, trustProxy: boolean): string {
  return resolveClientAddress(request.socket.remoteAddress, request.headers["x-real-ip"], trustProxy);
}

async function readJSON(request: IncomingMessage, maximumBytes: number): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > maximumBytes) {
      request.resume();
      return null;
    }
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; } catch { return null; }
}

function serveStatic(root: string, pathname: string, headOnly: boolean, response: ServerResponse): void {
  const localizedPage = /^\/(?:zh-Hans|zh-Hant|ja|ko|de|fr|es|es-419|pt-BR|pt-PT|ru|uk)(?:\/pair)?\/?$/.test(pathname);
  const requested = pathname === "/" || pathname === "/pair" || pathname === "/pair/" || localizedPage ? "index.html" : pathname.slice(1);
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
    pipeStaticFile(file, response);
  } catch {
    json(response, 404, { error: "not_found" });
  }
}

export function pipeStaticFile(
  file: string,
  response: ServerResponse,
  openFile: typeof createReadStream = createReadStream
): void {
  const source = openFile(file);
  source.once("error", () => {
    if (!response.headersSent && !response.writableEnded) json(response, 404, { error: "not_found" });
    else response.destroy();
  });
  source.pipe(response);
}

function setSecurityHeaders(response: ServerResponse, production: boolean, websocketOrigin: string): void {
  response.setHeader("content-security-policy", `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${websocketOrigin} https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  if (production) response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}

function retryJSON(response: ServerResponse, status: number, seconds: number, value: unknown): void {
  response.setHeader("retry-after", String(seconds));
  json(response, status, value);
}
