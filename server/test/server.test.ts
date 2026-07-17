import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect as connectTCP, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import type { LinkConfig } from "../src/config.js";
import { createLinkServer, pipeStaticFile } from "../src/server.js";

function testConfig(): LinkConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    publicOrigin: "http://127.0.0.1",
    production: false,
    trustProxy: false,
    ticketSigningSecret: "integration-test-signing-secret-123456",
    ticketTTLSeconds: 90,
    roomTTLSeconds: 240,
    maxRooms: 10,
    maxConnectionsPerNetwork: 4,
    maxUnpairedRoomsPerNetwork: 3,
    reservedRoomsForNewNetworks: 1,
    maxServerConnections: 64,
    maxSignalMessages: 16,
    maxSignalBytes: 32_768,
    maxMessageBytes: 8_192,
    ticketRequestsPerMinute: 10,
    rawTicketRequestsPerMinute: 60,
    websocketUpgradesPerMinute: 60,
    websocketRawUpgradesGlobalPerMinute: 1_200,
    websocketUpgradesGlobalPerMinute: 600,
    turnstileRequestsPerMinute: 100,
    turnstileMaximumConcurrent: 4,
    turnstileEnabled: false,
    turnstileSiteKey: null,
    turnstileSecretKey: null,
    turnstileExpectedHostname: null,
    staticRoot: "/does-not-exist",
    usageMetricsPath: null,
    usageMetricsRetentionDays: 400
  };
}

test("static stream open errors are converted into a bounded response", async () => {
  const source = new EventEmitter() as EventEmitter & { pipe: (destination: unknown) => unknown };
  source.pipe = (destination) => {
    queueMicrotask(() => source.emit("error", new Error("open failed")));
    return destination;
  };
  const headers = new Map<string, string>();
  const response = {
    headersSent: false,
    writableEnded: false,
    statusCode: 0,
    setHeader: (name: string, value: string) => headers.set(name, value),
    end() { this.writableEnded = true; },
    destroy() { this.writableEnded = true; },
  };

  pipeStaticFile(
    "/missing-after-stat",
    response as never,
    (() => source) as never
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.statusCode, 404);
  assert.equal(response.writableEnded, true);
  assert.equal(headers.get("content-type"), "application/json; charset=utf-8");
});

async function connect(url: string, options?: ConstructorParameters<typeof WebSocket>[2]): Promise<{ socket: WebSocket; next: () => Promise<Record<string, unknown>> }> {
  const socket = new WebSocket(url, options);
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

async function issueTicket(origin: string): Promise<string> {
  const response = await fetch(`${origin}/api/v1/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnstileToken: "development-bypass", capabilityHash: Buffer.alloc(32, 5).toString("base64url") })
  });
  assert.equal(response.status, 201);
  const ticket = await response.json() as { ticket: string; expiresInSeconds: number };
  assert.ok(ticket.expiresInSeconds > 88 && ticket.expiresInSeconds <= 90);
  return ticket.ticket;
}

test("usage metrics persist ticket issuance and completed signaling", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-server-usage-"));
  const path = join(directory, "usage.json");
  const config = testConfig();
  config.usageMetricsPath = path;
  const server = createLinkServer(config);
  let stopped = false;
  context.after(async () => {
    if (!stopped) await new Promise<void>((resolve) => server.shutdown(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const platformHeaders = {
    "sec-ch-ua": '"Chromium";v="140", "Microsoft Edge";v="140"',
    "sec-ch-ua-platform": '"Windows"',
    "user-agent": "Mozilla/5.0"
  };
  const ticketResponse = await fetch(`${origin}/api/v1/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json", ...platformHeaders },
    body: JSON.stringify({
      turnstileToken: "development-bypass",
      capabilityHash: Buffer.alloc(32, 6).toString("base64url")
    })
  });
  assert.equal(ticketResponse.status, 201);
  const { ticket } = await ticketResponse.json() as { ticket: string };
  const browser = await connect(
    `ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`,
    { headers: platformHeaders }
  );
  assert.equal((await browser.next()).event, "waiting");
  const browserJoined = browser.next();
  const phone = await connect(`ws://127.0.0.1:${port}/ws/v1?role=phone&ticket=${encodeURIComponent(ticket)}`);
  assert.equal((await phone.next()).event, "peer_joined");
  assert.equal((await browserJoined).event, "peer_joined");
  const closed = Promise.all([
    new Promise<void>((resolve) => browser.socket.once("close", () => resolve())),
    new Promise<void>((resolve) => phone.socket.once("close", () => resolve()))
  ]);
  browser.socket.send(JSON.stringify({ kind: "complete" }));
  await closed;
  await new Promise<void>((resolve, reject) => server.shutdown((error) => error ? reject(error) : resolve()));
  stopped = true;

  const state = JSON.parse(await readFile(path, "utf8")) as {
    days: Record<string, {
      generatedLinks: { total: number; uniqueNetworks: number; browsers: Record<string, number>; operatingSystems: Record<string, number> };
      successfulConnections: { total: number; uniqueNetworks: number; browsers: Record<string, number>; operatingSystems: Record<string, number> };
    }>;
  };
  const usage = Object.values(state.days)[0];
  assert.ok(usage);
  assert.equal(usage.generatedLinks.total, 1);
  assert.equal(usage.generatedLinks.uniqueNetworks, 1);
  assert.deepEqual(usage.generatedLinks.browsers, { Edge: 1 });
  assert.deepEqual(usage.generatedLinks.operatingSystems, { Windows: 1 });
  assert.equal(usage.successfulConnections.total, 1);
  assert.equal(usage.successfulConnections.uniqueNetworks, 1);
  assert.deepEqual(usage.successfulConnections.browsers, { Edge: 1 });
  assert.deepEqual(usage.successfulConnections.operatingSystems, { Windows: 1 });
});

test("cross-site and non-JSON ticket requests do not consume the IP quota", async (context) => {
  const config = testConfig();
  config.ticketRequestsPerMinute = 1;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const body = JSON.stringify({
    turnstileToken: "development-bypass",
    capabilityHash: Buffer.alloc(32, 5).toString("base64url")
  });

  const simple = await fetch(`${origin}/api/v1/tickets`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: "https://attacker.example" },
    body
  });
  assert.equal(simple.status, 415);

  const crossSite = await fetch(`${origin}/api/v1/tickets`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site"
    },
    body
  });
  assert.equal(crossSite.status, 403);

  const legitimate = await fetch(`${origin}/api/v1/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  assert.equal(legitimate.status, 201);
  const exhausted = await fetch(`${origin}/api/v1/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  assert.equal(exhausted.status, 429);
});

test("security policy limits WebSocket connections to the configured origin", async (context) => {
  const config = testConfig();
  config.publicOrigin = "https://link.watermelonbackup.com";
  config.production = true;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;

  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  const policy = response.headers.get("content-security-policy") ?? "";

  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.match(policy, /connect-src 'self' wss:\/\/link\.watermelonbackup\.com https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(policy, /connect-src[^;]*\sws:\s/);
  assert.doesNotMatch(policy, /connect-src[^;]*\swss:\s/);
});

test("WebSocket upgrades accept native clients and the configured browser origin only", async (context) => {
  const config = testConfig();
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const ticket = await issueTicket(origin);
  const url = `ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`;

  await assert.rejects(connect(url, { origin: "https://attacker.example" }), /403/);
  const browser = await connect(url, { origin: config.publicOrigin });
  assert.equal((await browser.next()).event, "waiting");
  await new Promise<void>((resolve) => {
    browser.socket.once("close", () => resolve());
    browser.socket.close();
  });
  const native = await connect(url);
  assert.equal((await native.next()).event, "waiting");
  native.socket.close();
});

test("invalid WebSocket upgrades do not consume the signed-upgrade budget", async (context) => {
  const config = testConfig();
  config.websocketUpgradesGlobalPerMinute = 1;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const ticket = await issueTicket(origin);

  await assert.rejects(connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=invalid`), /401/);
  const legitimate = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`);
  assert.equal((await legitimate.next()).event, "waiting");
  legitimate.socket.close();
});

test("raw WebSocket upgrade overload is shed before ticket validation", async (context) => {
  const config = testConfig();
  config.websocketRawUpgradesGlobalPerMinute = 1;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const ticket = await issueTicket(origin);

  await assert.rejects(connect(
    `ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=invalid`,
    { origin: "https://attacker.example" }
  ), /403/);
  await assert.rejects(connect(
    `ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`
  ), /503/);
});

test("one network cannot drain the raw global upgrade budget", async (context) => {
  const config = testConfig();
  config.websocketUpgradesPerMinute = 1;
  config.websocketRawUpgradesGlobalPerMinute = 2;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const ticket = await issueTicket(origin);
  const url = `ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`;

  await assert.rejects(connect(url, { origin: "https://attacker.example" }), /403/);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(connect(url, { origin: "https://attacker.example" }), /429/);
  }

  const legitimate = await connect(url);
  assert.equal((await legitimate.next()).event, "waiting");
  legitimate.socket.close();
});

test("cross-origin upgrades cannot exhaust the legitimate network budget", async (context) => {
  const config = testConfig();
  config.websocketUpgradesPerMinute = 2;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const ticket = await issueTicket(origin);
  const browserURL = `ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(connect(browserURL, { origin: "https://attacker.example" }), /403|429/);
  }

  const browser = await connect(browserURL, { origin: config.publicOrigin });
  assert.equal((await browser.next()).event, "waiting");
  const browserJoined = browser.next();
  const phone = await connect(`ws://127.0.0.1:${port}/ws/v1?role=phone&ticket=${encodeURIComponent(ticket)}`);
  assert.equal((await phone.next()).event, "peer_joined");
  assert.equal((await browserJoined).event, "peer_joined");
  browser.socket.close();
  phone.socket.close();
});

test("one ticket cannot exhaust the global signed-upgrade budget", async (context) => {
  const config = testConfig();
  config.websocketUpgradesGlobalPerMinute = 13;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const replayedTicket = await issueTicket(origin);
  const replayURL = `ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(replayedTicket)}`;
  const owner = await connect(replayURL);
  assert.equal((await owner.next()).event, "waiting");
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const replay = await connect(replayURL);
    const code = await new Promise<number>((resolve) => replay.socket.once("close", resolve));
    assert.equal(code, 4409);
  }
  await assert.rejects(connect(replayURL), /429/);

  const freshTicket = await issueTicket(origin);
  const fresh = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(freshTicket)}`);
  assert.equal((await fresh.next()).event, "waiting");
  owner.socket.close();
  fresh.socket.close();
});

test("ticket limits group IPv6 privacy addresses by network prefix", async (context) => {
  const config = testConfig();
  config.trustProxy = true;
  config.ticketRequestsPerMinute = 1;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const body = JSON.stringify({
    turnstileToken: "development-bypass",
    capabilityHash: Buffer.alloc(32, 5).toString("base64url")
  });
  const issue = (ip: string) => fetch(`${origin}/api/v1/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body
  });

  assert.equal((await issue("2001:db8:1:2::1")).status, 201);
  assert.equal((await issue("2001:db8:1:2:ffff::2")).status, 429);
  assert.equal((await issue("2001:db8:1:3::1")).status, 201);
});

test("malformed WebSocket upgrade targets cannot terminate the server", async (context) => {
  const server = createLinkServer(testConfig());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connectTCP(port, "127.0.0.1");
    let received = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("malformed upgrade response timeout"));
    }, 2_000);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { received += chunk; });
    socket.once("error", reject);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(received);
    });
    socket.once("connect", () => {
      socket.write("GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    });
  });

  assert.match(response, /^HTTP\/1\.1 400 Bad Request/);
  assert.deepEqual(
    await fetch(`http://127.0.0.1:${port}/healthz`).then((value) => value.json()),
    { ok: true, rooms: 0, connections: 0 }
  );
});

test("a rejected upgrade contains malformed head frames without crashing the server", async (context) => {
  const config = testConfig();
  config.maxConnectionsPerNetwork = 1;
  const server = createLinkServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const occupyingTicket = await issueTicket(origin);
  const rejectedTicket = await issueTicket(origin);
  const occupying = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(occupyingTicket)}`);
  context.after(() => occupying.socket.terminate());
  assert.equal((await occupying.next()).event, "waiting");

  await new Promise<void>((resolve, reject) => {
    const socket = connectTCP(port, "127.0.0.1");
    socket.resume();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("rejected malformed upgrade timeout"));
    }, 2_000);
    socket.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
    });
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect", () => {
      const headers = [
        `GET /ws/v1?role=browser&ticket=${encodeURIComponent(rejectedTicket)} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Key: ${Buffer.alloc(16, 7).toString("base64")}`,
        "",
        "",
      ].join("\r\n");
      socket.write(Buffer.concat([Buffer.from(headers), Buffer.from([0x81, 0x01, 0x78])]));
    });
  });

  assert.equal((await fetch(`${origin}/healthz`).then((response) => response.json()) as { ok: boolean }).ok, true);
  occupying.socket.close();
});

test("resetting rejected upgrade sockets cannot terminate the server", async (context) => {
  const server = createLinkServer(testConfig());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const request = [
    "GET /ws/v1?role=browser&ticket=invalid HTTP/1.1",
    `Host: 127.0.0.1:${port}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    `Sec-WebSocket-Key: ${Buffer.alloc(16, 9).toString("base64")}`,
    "Origin: https://attacker.example",
    "",
    "",
  ].join("\r\n");

  for (let batch = 0; batch < 20; batch += 1) {
    await Promise.all(Array.from({ length: 20 }, () => new Promise<void>((resolve, reject) => {
      const socket = connectTCP(port, "127.0.0.1");
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("reset upgrade timeout"));
      }, 2_000);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.once("error", (error) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ECONNRESET" || code === "EPIPE") finish();
        else reject(error);
      });
      socket.once("close", finish);
      socket.once("connect", () => {
        socket.write(request, () => socket.resetAndDestroy());
      });
    })));
  }

  assert.deepEqual(
    await fetch(`${origin}/healthz`).then((response) => response.json()),
    { ok: true, rooms: 0, connections: 0 }
  );
  const ticket = await issueTicket(origin);
  const browser = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`);
  assert.equal((await browser.next()).event, "waiting");
  browser.socket.close();
});

test("rejected upgrade sockets are force-closed when the client keeps its write side open", async (context) => {
  const server = createLinkServer(testConfig());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const socket = connectTCP({ port, host: "127.0.0.1", allowHalfOpen: true });
  context.after(() => socket.destroy());
  let response = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => { response += chunk; });
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write([
        "GET /ws/v1?role=browser&ticket=invalid HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Key: ${Buffer.alloc(16, 4).toString("base64")}`,
        "Origin: https://attacker.example",
        "",
        "",
      ].join("\r\n"));
    });
    socket.once("end", resolve);
  });
  assert.match(response, /^HTTP\/1\.1 403 Forbidden/);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const connections = await new Promise<number>((resolve, reject) => {
    server.getConnections((error, count) => error ? reject(error) : resolve(count));
  });
  assert.equal(connections, 0);
});

test("ticket creation allocates no room and two peers can relay opaque signaling", async (context) => {
  const server = createLinkServer(testConfig());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  const ticket = await issueTicket(origin);
  assert.deepEqual(await fetch(`${origin}/healthz`).then((response) => response.json()), { ok: true, rooms: 0, connections: 0 });

  const browserPeer = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`);
  const browser = browserPeer.socket;
  assert.equal((await browserPeer.next()).event, "waiting");
  const browserJoined = browserPeer.next();
  const phonePeer = await connect(`ws://127.0.0.1:${port}/ws/v1?role=phone&ticket=${encodeURIComponent(ticket)}`);
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

  const replay = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`);
  const replayCode = await new Promise<number>((resolve) => replay.socket.once("close", resolve));
  assert.equal(replayCode, 4409);
});

test("WebSocket control frames are answered once and bounded per connection", async (context) => {
  const server = createLinkServer(testConfig());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const ticket = await issueTicket(origin);
  const peer = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`);
  assert.equal((await peer.next()).event, "waiting");

  let pongCount = 0;
  peer.socket.on("pong", () => { pongCount += 1; });
  peer.socket.ping();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pong timeout")), 2_000);
    peer.socket.once("pong", () => {
      clearTimeout(timer);
      setTimeout(resolve, 20);
    });
  });
  assert.equal(pongCount, 1);

  const closed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("control flood close timeout")), 2_000);
    peer.socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  for (let index = 0; index < 64; index += 1) peer.socket.ping();
  await closed;
  assert.deepEqual(
    await fetch(`${origin}/healthz`).then((response) => response.json()),
    { ok: true, rooms: 0, connections: 0 }
  );
});

test("graceful shutdown closes upgraded peers before the HTTP server", async () => {
  const server = createLinkServer(testConfig());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const ticket = await issueTicket(origin);
  const peer = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`);
  assert.equal((await peer.next()).event, "waiting");
  const peerClosed = new Promise<void>((resolve) => peer.socket.once("close", () => resolve()));

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("graceful shutdown timeout")), 1_000);
    server.shutdown((error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    });
  });
  await peerClosed;
});

test("complete is accepted only from the browser after both peers join", async (context) => {
  const server = createLinkServer(testConfig());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  const singleTicket = await issueTicket(origin);
  const singleBrowser = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(singleTicket)}`);
  assert.equal((await singleBrowser.next()).event, "waiting");
  const singleClose = new Promise<number>((resolve) => singleBrowser.socket.once("close", resolve));
  singleBrowser.socket.send(JSON.stringify({ kind: "complete" }));
  assert.equal(await singleClose, 4400);

  const pairedTicket = await issueTicket(origin);
  const browser = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(pairedTicket)}`);
  assert.equal((await browser.next()).event, "waiting");
  const browserJoined = browser.next();
  const phone = await connect(`ws://127.0.0.1:${port}/ws/v1?role=phone&ticket=${encodeURIComponent(pairedTicket)}`);
  assert.equal((await phone.next()).event, "peer_joined");
  assert.equal((await browserJoined).event, "peer_joined");
  const browserClose = new Promise<number>((resolve) => browser.socket.once("close", resolve));
  const phoneClose = new Promise<number>((resolve) => phone.socket.once("close", resolve));
  phone.socket.send(JSON.stringify({ kind: "complete" }));
  assert.deepEqual(await Promise.all([browserClose, phoneClose]), [4400, 4400]);
});

test("a paired ticket stays consumed after an unexpected disconnect", async (context) => {
  const server = createLinkServer(testConfig());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const ticket = await issueTicket(origin);

  const browser = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`);
  assert.equal((await browser.next()).event, "waiting");
  const browserJoined = browser.next();
  const phone = await connect(`ws://127.0.0.1:${port}/ws/v1?role=phone&ticket=${encodeURIComponent(ticket)}`);
  assert.equal((await phone.next()).event, "peer_joined");
  assert.equal((await browserJoined).event, "peer_joined");
  const phoneClosed = new Promise<void>((resolve) => phone.socket.once("close", () => resolve()));
  browser.socket.terminate();
  await phoneClosed;

  const replay = await connect(`ws://127.0.0.1:${port}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`);
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
  const publicConfig = await fetch(`${origin}/api/v1/config`);
  const pairWithSlash = await fetch(`${origin}/pair/`);
  const localizedPairWithSlash = await fetch(`${origin}/zh-Hans/pair/`);
  const unsupportedLocalizedPair = await fetch(`${origin}/it/pair`);
  assert.equal(html.headers.get("cache-control"), "no-cache");
  assert.equal(bundle.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(icon.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(association.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(pairWithSlash.status, 200);
  assert.equal(localizedPairWithSlash.status, 200);
  assert.equal(unsupportedLocalizedPair.status, 404);
  assert.equal((await publicConfig.json() as { protocolVersion: number }).protocolVersion, 1);
});
