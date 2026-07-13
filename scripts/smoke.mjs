import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";

const originURL = new URL(process.argv[2] ?? "http://127.0.0.1:4173");
assert.ok(originURL.protocol === "http:" || originURL.protocol === "https:");
assert.equal(originURL.pathname, "/");
assert.equal(originURL.search, "");
assert.equal(originURL.hash, "");
const origin = originURL.origin;
const websocketOrigin = origin.replace(/^http/, "ws");
const timeoutMilliseconds = 5_000;

const initialHealth = await fetchJSON(`${origin}/healthz`);
assertHealth(initialHealth);

const config = await fetchJSON(`${origin}/api/v1/config`);
assert.equal(config.protocolVersion, 1);
assert.equal(config.publicOrigin, origin);
if (originURL.protocol === "https:") {
  assert.equal(config.turnstileEnabled, true);
  assert.equal(typeof config.turnstileSiteKey, "string");
  assert.ok(config.turnstileSiteKey.length > 0);
}
const turnstileToken = process.env.TURNSTILE_TOKEN ?? (config.turnstileEnabled ? null : "development-bypass");
if (!turnstileToken) {
  console.log("Watermelon Link smoke test passed (health only; set TURNSTILE_TOKEN for the full production flow)");
  process.exit(0);
}

const secret = randomBytes(32);
const capabilityHash = createHash("sha256")
  .update("watermelon-link-capability-v1:")
  .update(secret)
  .digest("base64url");
const ticketResponse = await fetch(`${origin}/api/v1/tickets`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ turnstileToken, capabilityHash }),
  signal: AbortSignal.timeout(timeoutMilliseconds)
});
assert.equal(ticketResponse.status, 201);
const { ticket } = await ticketResponse.json();

const afterTicket = await fetchJSON(`${origin}/healthz`);
assertHealth(afterTicket);

const browser = await connect(
  `${websocketOrigin}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`,
  { origin }
);
assert.equal((await browser.next()).event, "waiting");
const browserJoined = browser.next();
const phone = await connect(`${websocketOrigin}/ws/v1?role=phone&ticket=${encodeURIComponent(ticket)}`);
assert.equal((await phone.next()).event, "peer_joined");
assert.equal((await browserJoined).event, "peer_joined");

const relayed = phone.next();
browser.socket.send(JSON.stringify({ kind: "relay", payload: "encrypted-smoke-payload" }));
assert.deepEqual(await relayed, { kind: "relay", payload: "encrypted-smoke-payload" });

const browserClosed = closed(browser.socket);
const phoneClosed = closed(phone.socket);
browser.socket.send(JSON.stringify({ kind: "complete" }));
await Promise.all([browserClosed, phoneClosed]);

const finalHealth = await fetchJSON(`${origin}/healthz`);
assertHealth(finalHealth);
console.log("Watermelon Link smoke test passed");

async function connect(url, options = {}) {
  const socket = new WebSocket(url, options);
  const messages = [];
  const waiters = [];
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
    else messages.push(message);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket open timeout"));
    }, timeoutMilliseconds);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return {
    socket,
    next: () => {
      if (messages.length > 0) return Promise.resolve(messages.shift());
      return new Promise((resolve, reject) => {
        const waiter = { resolve, timer: undefined };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("WebSocket message timeout"));
        }, timeoutMilliseconds);
        waiters.push(waiter);
      });
    }
  };
}

function closed(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket close timeout")), timeoutMilliseconds);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function fetchJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMilliseconds) });
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.json();
}

function assertHealth(value) {
  assert.equal(value?.ok, true);
  assert.equal(Number.isSafeInteger(value?.rooms) && value.rooms >= 0, true);
  assert.equal(Number.isSafeInteger(value?.connections) && value.connections >= 0, true);
}
