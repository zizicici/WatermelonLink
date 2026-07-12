import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";

const origin = process.argv[2] ?? "http://127.0.0.1:4173";
const websocketOrigin = origin.replace(/^http/, "ws");

const initialHealth = await fetch(`${origin}/healthz`).then((response) => response.json());
assert.deepEqual(initialHealth, { ok: true, rooms: 0, connections: 0 });

const secret = randomBytes(32);
const capabilityHash = createHash("sha256").update(secret).digest("base64url");
const ticketResponse = await fetch(`${origin}/api/v1/tickets`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ turnstileToken: "development-bypass", capabilityHash })
});
assert.equal(ticketResponse.status, 201);
const { ticket } = await ticketResponse.json();

const afterTicket = await fetch(`${origin}/healthz`).then((response) => response.json());
assert.equal(afterTicket.rooms, 0);

const browser = await connect(`${websocketOrigin}/ws/v1?role=browser&ticket=${encodeURIComponent(ticket)}`);
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

const finalHealth = await fetch(`${origin}/healthz`).then((response) => response.json());
assert.deepEqual(finalHealth, { ok: true, rooms: 0, connections: 0 });
console.log("Watermelon Link smoke test passed");

async function connect(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else messages.push(message);
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    next: () => messages.length > 0 ? Promise.resolve(messages.shift()) : new Promise((resolve) => waiters.push(resolve))
  };
}

function closed(socket) {
  return new Promise((resolve) => socket.once("close", resolve));
}
