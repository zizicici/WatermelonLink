import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import type { LinkConfig } from "../src/config.js";
import { createLinkServer } from "../src/server.js";

function testConfig(): LinkConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    publicOrigin: "http://127.0.0.1",
    production: false,
    trustProxy: false,
    ticketSigningSecret: "integration-test-signing-secret-123456",
    ticketTTLSeconds: 180,
    roomTTLSeconds: 240,
    maxRooms: 10,
    maxConnectionsPerIP: 4,
    maxSignalMessages: 16,
    maxSignalBytes: 32_768,
    maxMessageBytes: 8_192,
    ticketRequestsPerMinute: 10,
    turnstileEnabled: false,
    turnstileSiteKey: null,
    turnstileSecretKey: null,
    turnstileExpectedHostname: null,
    staticRoot: "/does-not-exist"
  };
}

async function connect(url: string): Promise<{ socket: WebSocket; next: () => Promise<Record<string, unknown>> }> {
  const socket = new WebSocket(url);
  const queued: Record<string, unknown>[] = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];
  socket.on("message", (data) => {
    const message = JSON.parse(String(data)) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queued.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return {
    socket,
    next: () => {
      const message = queued.shift();
      if (message) return Promise.resolve(message);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("message timeout")), 2_000);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    }
  };
}

test("ticket creation allocates no room and two peers can relay opaque signaling", async (context) => {
  const server = createLinkServer(testConfig());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  const ticketResponse = await fetch(`${origin}/api/v1/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnstileToken: "development-bypass", capabilityHash: Buffer.alloc(32, 5).toString("base64url") })
  });
  assert.equal(ticketResponse.status, 201);
  const ticket = await ticketResponse.json() as { ticket: string; expiresInSeconds: number };
  assert.ok(ticket.expiresInSeconds > 178 && ticket.expiresInSeconds <= 180);
  assert.deepEqual(await fetch(`${origin}/healthz`).then((response) => response.json()), { ok: true, rooms: 0, connections: 0 });

  const browserPeer = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket.ticket)}`);
  const browser = browserPeer.socket;
  assert.equal((await browserPeer.next()).event, "waiting");
  const browserJoined = browserPeer.next();
  const phonePeer = await connect(`ws://127.0.0.1:${port}/ws/v1?role=phone&ticket=${encodeURIComponent(ticket.ticket)}`);
  const phone = phonePeer.socket;
  assert.equal((await phonePeer.next()).event, "peer_joined");
  assert.equal((await browserJoined).event, "peer_joined");

  const relayed = phonePeer.next();
  browser.send(JSON.stringify({ kind: "relay", payload: "opaque.encrypted.payload" }));
  assert.deepEqual(await relayed, { kind: "relay", payload: "opaque.encrypted.payload" });
  const browserClosed = new Promise<void>((resolve) => browser.once("close", () => resolve()));
  const phoneClosed = new Promise<void>((resolve) => phone.once("close", () => resolve()));
  browser.send(JSON.stringify({ kind: "complete" }));
  await Promise.all([browserClosed, phoneClosed]);

  const replay = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket.ticket)}`);
  const replayCode = await new Promise<number>((resolve) => replay.socket.once("close", resolve));
  assert.equal(replayCode, 4409);
});

test("only fingerprinted bundles receive immutable caching", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "watermelon-link-"));
  await Promise.all([mkdir(join(root, "assets")), mkdir(join(root, ".well-known"))]);
  await Promise.all([
    writeFile(join(root, "index.html"), "<!doctype html>"),
    writeFile(join(root, "assets", "index-review.js"), "export {};"),
    writeFile(join(root, "assets", "app-icon.png"), "image"),
    writeFile(join(root, ".well-known", "apple-app-site-association"), "{}")
  ]);
  const config = testConfig();
  config.staticRoot = root;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  const html = await fetch(origin);
  const bundle = await fetch(`${origin}/assets/index-review.js`);
  const icon = await fetch(`${origin}/assets/app-icon.png`);
  const association = await fetch(`${origin}/.well-known/apple-app-site-association`);
  assert.equal(html.headers.get("cache-control"), "no-cache");
  assert.equal(bundle.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(icon.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(association.headers.get("content-type"), "application/json; charset=utf-8");
});
