import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { WebSocket } from "ws";
import { RoomRegistry } from "../src/rooms.js";
import type { TicketClaims } from "../src/tickets.js";

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = this.OPEN;
  readonly sent: string[] = [];
  readonly sendCallbacks: Array<(error?: Error) => void> = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];
  pingCount = 0;
  pongCount = 0;
  bufferedAmount = 0;
  terminateCount = 0;
  emitClose = true;
  throwOnSend = false;
  throwOnPing = false;
  throwOnClose = false;
  throwOnTerminate = false;

  send(value: string, callback?: (error?: Error) => void) {
    if (this.throwOnSend) throw new Error("send failed");
    this.sent.push(value);
    if (callback) this.sendCallbacks.push(callback);
  }
  ping() {
    if (this.throwOnPing) throw new Error("ping failed");
    this.pingCount += 1;
  }
  pong(_data?: Buffer, _mask?: boolean, callback?: (error?: Error) => void) {
    this.pongCount += 1;
    callback?.();
  }
  close(code?: number, reason?: string) {
    if (this.throwOnClose) throw new Error("close failed");
    if (this.readyState !== this.OPEN) return;
    this.readyState = 3;
    this.closed.push({ code, reason });
    if (this.emitClose) this.emit("close");
  }
  terminate() {
    if (this.throwOnTerminate) throw new Error("terminate failed");
    if (this.readyState !== this.OPEN) return;
    this.readyState = 3;
    this.terminateCount += 1;
    if (this.emitClose) this.emit("close");
  }
}

const socket = () => new FakeSocket();
const asWebSocket = (value: FakeSocket) => value as unknown as WebSocket;
const claims = (sessionID: string, expiresAt = Math.floor(Date.now() / 1_000) + 600): TicketClaims => ({
  v: 1,
  sessionID,
  capabilityHash: "BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU",
  issuedAt: Math.floor(Date.now() / 1_000),
  expiresAt,
  maxPeers: 2,
});
const limits = (overrides: Partial<ConstructorParameters<typeof RoomRegistry>[0]> = {}) => ({
  maxRooms: 4,
  maxConnectionsPerNetwork: 8,
  maxUnpairedRoomsPerNetwork: 3,
  reservedRoomsForNewNetworks: 0,
  maxSignalMessages: 4,
  maxSignalBytes: 64_000,
  roomTTLSeconds: 240,
  ...overrides,
});

test("room registry enforces per-network and room-capacity limits", () => {
  const perIP = new RoomRegistry(limits({ maxConnectionsPerNetwork: 1 }));
  const first = socket();
  const rejectedIP = socket();
  assert.equal(perIP.attach(asWebSocket(first), claims("one"), "browser", "203.0.113.1"), true);
  assert.equal(perIP.attach(asWebSocket(rejectedIP), claims("two"), "browser", "203.0.113.1"), false);
  assert.equal(rejectedIP.closed[0]?.code, 4429);
  perIP.close();

  const capacity = new RoomRegistry(limits({ maxRooms: 1 }));
  const occupying = socket();
  const rejectedCapacity = socket();
  assert.equal(capacity.attach(asWebSocket(occupying), claims("one"), "browser", "203.0.113.1"), true);
  assert.equal(capacity.attach(asWebSocket(rejectedCapacity), claims("two"), "browser", "203.0.113.2"), false);
  assert.equal(rejectedCapacity.closed[0]?.code, 4503);
  capacity.close();
});

test("room registry closes binary, oversized, and flooded signaling", () => {
  const binaryRegistry = new RoomRegistry(limits());
  const binary = socket();
  binaryRegistry.attach(asWebSocket(binary), claims("binary"), "browser", "203.0.113.1");
  binary.emit("message", Buffer.from([1]), true);
  assert.equal(binary.closed[0]?.code, 4400);
  binaryRegistry.close();

  const payloadRegistry = new RoomRegistry(limits({ maxSignalBytes: 100_000 }));
  const payload = socket();
  payloadRegistry.attach(asWebSocket(payload), claims("payload"), "browser", "203.0.113.1");
  payload.emit("message", Buffer.from(JSON.stringify({ kind: "relay", payload: "x".repeat(20_001) })), false);
  assert.equal(payload.closed[0]?.code, 4400);
  payloadRegistry.close();

  const floodRegistry = new RoomRegistry(limits({ maxSignalMessages: 1 }));
  const flood = socket();
  floodRegistry.attach(asWebSocket(flood), claims("flood"), "browser", "203.0.113.1");
  flood.emit("message", Buffer.from(JSON.stringify({ kind: "relay", payload: "one" })), false);
  flood.emit("message", Buffer.from(JSON.stringify({ kind: "relay", payload: "two" })), false);
  assert.equal(flood.terminateCount, 1);
  floodRegistry.close();
});

test("room registry rejects non-object JSON without throwing", () => {
  for (const [index, value] of [null, [], 1, "text"].entries()) {
    const registry = new RoomRegistry(limits());
    const peer = socket();
    registry.attach(asWebSocket(peer), claims(`primitive-${index}`), "browser", `203.0.113.${index + 1}`);
    assert.doesNotThrow(() => peer.emit("message", Buffer.from(JSON.stringify(value)), false));
    assert.equal(peer.closed[0]?.code, 4400);
    registry.close();
  }
});

test("room registry terminates a room before outbound buffering exceeds its bound", () => {
  const registry = new RoomRegistry(limits({ maxSignalBytes: 256 * 1024 }));
  const browser = socket();
  const phone = socket();
  registry.attach(asWebSocket(browser), claims("backpressure"), "browser", "203.0.113.1");
  registry.attach(asWebSocket(phone), claims("backpressure"), "phone", "203.0.113.2");
  phone.bufferedAmount = 64 * 1024;

  browser.emit("message", Buffer.from(JSON.stringify({ kind: "relay", payload: "x" })), false);

  assert.equal(browser.terminateCount, 1);
  assert.equal(phone.terminateCount, 1);
  assert.deepEqual(registry.stats(), { rooms: 0, connections: 0 });
  registry.close();
});

test("room registry bounds client control frames and heartbeat backpressure", () => {
  const controlRegistry = new RoomRegistry(limits());
  const controlPeer = socket();
  controlRegistry.attach(asWebSocket(controlPeer), claims("control-flood"), "browser", "203.0.113.1");
  for (let index = 0; index < 16; index += 1) controlPeer.emit("ping", Buffer.alloc(0));
  assert.equal(controlPeer.pongCount, 16);
  assert.equal(controlPeer.terminateCount, 0);
  controlPeer.emit("ping", Buffer.alloc(0));
  assert.equal(controlPeer.terminateCount, 1);
  assert.deepEqual(controlRegistry.stats(), { rooms: 0, connections: 0 });
  controlRegistry.close();

  const pongBackpressureRegistry = new RoomRegistry(limits());
  const pongSlowPeer = socket();
  pongBackpressureRegistry.attach(asWebSocket(pongSlowPeer), claims("pong-backpressure"), "browser", "203.0.113.1");
  pongSlowPeer.bufferedAmount = 64 * 1024;
  pongSlowPeer.emit("ping", Buffer.alloc(1));
  assert.equal(pongSlowPeer.terminateCount, 1);
  assert.deepEqual(pongBackpressureRegistry.stats(), { rooms: 0, connections: 0 });
  pongBackpressureRegistry.close();

  const backpressureRegistry = new RoomRegistry(limits());
  const slowPeer = socket();
  backpressureRegistry.attach(asWebSocket(slowPeer), claims("control-backpressure"), "browser", "203.0.113.1");
  slowPeer.bufferedAmount = 64 * 1024;
  (backpressureRegistry as unknown as { sweep: (now?: number) => void }).sweep();
  assert.equal(slowPeer.terminateCount, 1);
  assert.deepEqual(backpressureRegistry.stats(), { rooms: 0, connections: 0 });
  backpressureRegistry.close();
});

test("room sweep expires rooms, consumes tickets, and releases connections", () => {
  const registry = new RoomRegistry(limits({ roomTTLSeconds: 1 }));
  const active = socket();
  const ticket = claims("expires");
  registry.attach(asWebSocket(active), ticket, "browser", "203.0.113.1");
  (registry as unknown as { sweep: (now: number) => void }).sweep(Date.now() + 2_000);
  assert.equal(active.closed[0]?.code, 4408);
  assert.deepEqual(registry.stats(), { rooms: 0, connections: 0 });

  const replay = socket();
  assert.equal(registry.attach(asWebSocket(replay), ticket, "browser", "203.0.113.1"), false);
  assert.equal(replay.closed[0]?.code, 4409);
  registry.close();
});

test("unpaired disconnect immediately releases the room and network slot", () => {
  const registry = new RoomRegistry(limits({ maxConnectionsPerNetwork: 1 }));
  const first = socket();
  registry.attach(asWebSocket(first), claims("first"), "browser", "203.0.113.1");
  first.close();
  assert.deepEqual(registry.stats(), { rooms: 0, connections: 0 });

  const next = socket();
  assert.equal(registry.attach(asWebSocket(next), claims("next"), "browser", "203.0.113.1"), true);
  registry.close();
});

test("paired disconnect notifies the remaining peer before closing", () => {
  const registry = new RoomRegistry(limits());
  const browser = socket();
  const phone = socket();
  registry.attach(asWebSocket(browser), claims("paired-left"), "browser", "203.0.113.1");
  registry.attach(asWebSocket(phone), claims("paired-left"), "phone", "203.0.113.2");

  browser.close();

  assert.deepEqual(phone.sent.map((value) => JSON.parse(value)), [
    { kind: "control", event: "peer_joined" },
    { kind: "control", event: "peer_left" },
  ]);
  assert.equal(phone.closed.at(-1)?.reason, "peer_left");
  assert.deepEqual(registry.stats(), { rooms: 0, connections: 0 });
  registry.close();
});

test("unpaired room quotas preserve room capacity for new networks without blocking a second peer", () => {
  const registry = new RoomRegistry(limits({
    maxRooms: 4,
    maxUnpairedRoomsPerNetwork: 2,
    reservedRoomsForNewNetworks: 2,
  }));
  const first = socket();
  const second = socket();
  assert.equal(registry.attach(asWebSocket(first), claims("one"), "browser", "v6:2001:0db8:0001:0001"), true);
  assert.equal(registry.attach(asWebSocket(second), claims("two"), "browser", "v6:2001:0db8:0001:0001"), true);

  const sameNetwork = socket();
  assert.equal(registry.attach(asWebSocket(sameNetwork), claims("three"), "browser", "v6:2001:0db8:0001:0001"), false);
  assert.equal(sameNetwork.closed[0]?.code, 4429);

  const newNetwork = socket();
  assert.equal(registry.attach(asWebSocket(newNetwork), claims("three"), "browser", "v6:2001:0db8:0002:0001"), true);
  const joiningPeer = socket();
  assert.equal(registry.attach(asWebSocket(joiningPeer), claims("one"), "phone", "v6:2001:0db8:0001:0001"), true);
  const pairedCreatorAgain = socket();
  assert.equal(registry.attach(asWebSocket(pairedCreatorAgain), claims("four"), "browser", "v6:2001:0db8:0001:0001"), false);
  assert.equal(pairedCreatorAgain.closed[0]?.code, 4429);
  const finalNewNetwork = socket();
  assert.equal(registry.attach(asWebSocket(finalNewNetwork), claims("four"), "browser", "v6:2001:0db8:0003:0001"), true);
  registry.close();
});

test("resource accounting is released before socket shutdown and socket throws stay contained", () => {
  const registry = new RoomRegistry(limits());
  const noCloseEvent = socket();
  noCloseEvent.emitClose = false;
  assert.equal(registry.attach(asWebSocket(noCloseEvent), claims("cancel"), "browser", "v4:203.0.113.1"), true);
  noCloseEvent.emit("message", Buffer.from(JSON.stringify({ kind: "cancel" })), false);
  assert.deepEqual(registry.stats(), { rooms: 0, connections: 0 });

  const throwing = socket();
  throwing.throwOnSend = true;
  throwing.throwOnClose = true;
  throwing.throwOnTerminate = true;
  assert.doesNotThrow(() => {
    assert.equal(registry.attach(asWebSocket(throwing), claims("throws"), "browser", "v4:203.0.113.1"), false);
  });
  assert.deepEqual(registry.stats(), { rooms: 0, connections: 0 });
  registry.close();
});

test("a stale send callback cannot consume a reconnected unpaired room", () => {
  const registry = new RoomRegistry(limits());
  const ticket = claims("reconnect");
  const old = socket();
  assert.equal(registry.attach(asWebSocket(old), ticket, "browser", "v4:203.0.113.1"), true);
  const staleCallback = old.sendCallbacks[0]!;
  old.close();

  const replacement = socket();
  assert.equal(registry.attach(asWebSocket(replacement), ticket, "browser", "v4:203.0.113.1"), true);
  staleCallback(new Error("late send failure"));
  const phone = socket();
  assert.equal(registry.attach(asWebSocket(phone), ticket, "phone", "v4:203.0.113.1"), true);
  registry.close();
});

test("an unpaired socket error releases resources without consuming its ticket", () => {
  const registry = new RoomRegistry(limits());
  const ticket = claims("socket-error");
  const failed = socket();
  assert.equal(registry.attach(asWebSocket(failed), ticket, "browser", "v4:203.0.113.1"), true);
  failed.emit("error", new Error("network error"));
  assert.deepEqual(registry.stats(), { rooms: 0, connections: 0 });
  const retry = socket();
  assert.equal(registry.attach(asWebSocket(retry), ticket, "browser", "v4:203.0.113.1"), true);
  registry.close();
});

test("cancel and signaling completion release all room connections", () => {
  for (const kind of ["cancel", "complete"]) {
    const registry = new RoomRegistry(limits());
    const browser = socket();
    const phone = socket();
    const ticket = claims(kind);
    registry.attach(asWebSocket(browser), ticket, "browser", "203.0.113.1");
    registry.attach(asWebSocket(phone), ticket, "phone", "203.0.113.2");

    browser.emit("message", Buffer.from(JSON.stringify({ kind })), false);

    assert.deepEqual(registry.stats(), { rooms: 0, connections: 0 });
    assert.equal(browser.closed[0]?.code, 1000);
    assert.equal(phone.closed[0]?.code, 1000);
    const replay = socket();
    assert.equal(registry.attach(asWebSocket(replay), ticket, "browser", "203.0.113.1"), false);
    assert.equal(replay.closed[0]?.code, 4409);
    registry.close();
  }
});

test("only signaling completion records the browser platform", () => {
  const completed: Array<{ platform: { browser: string; operatingSystem: string }; network: string }> = [];
  const registry = new RoomRegistry(limits(), {
    connectionCompleted: (platform, network) => completed.push({ platform, network })
  });
  const browser = socket();
  const phone = socket();
  const ticket = claims("usage-complete");
  registry.attach(
    asWebSocket(browser),
    ticket,
    "browser",
    "203.0.113.1",
    { browser: "Edge", operatingSystem: "Windows" }
  );
  registry.attach(asWebSocket(phone), ticket, "phone", "203.0.113.2");
  browser.emit("message", Buffer.from(JSON.stringify({ kind: "complete" })), false);
  assert.deepEqual(completed, [{
    platform: { browser: "Edge", operatingSystem: "Windows" },
    network: "203.0.113.1"
  }]);
  registry.close();

  const cancelled = new RoomRegistry(limits(), {
    connectionCompleted: (platform, network) => completed.push({ platform, network })
  });
  const cancelledBrowser = socket();
  const cancelledPhone = socket();
  const cancelledTicket = claims("usage-cancel");
  cancelled.attach(
    asWebSocket(cancelledBrowser),
    cancelledTicket,
    "browser",
    "203.0.113.1",
    { browser: "Chrome", operatingSystem: "macOS" }
  );
  cancelled.attach(asWebSocket(cancelledPhone), cancelledTicket, "phone", "203.0.113.2");
  cancelledBrowser.emit("message", Buffer.from(JSON.stringify({ kind: "cancel" })), false);
  assert.equal(completed.length, 1);
  cancelled.close();
});
