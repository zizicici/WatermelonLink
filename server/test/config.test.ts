import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, normalizePublicOrigin } from "../src/config";

test("public origin validation normalizes HTTP(S) origins and rejects request URLs", () => {
  assert.equal(normalizePublicOrigin("https://link.watermelonbackup.com/"), "https://link.watermelonbackup.com");
  assert.equal(normalizePublicOrigin("http://127.0.0.1:4173"), "http://127.0.0.1:4173");
  assert.throws(() => normalizePublicOrigin("not-an-origin"), /PUBLIC_ORIGIN/);
  assert.throws(() => normalizePublicOrigin("wss://link.watermelonbackup.com"), /PUBLIC_ORIGIN/);
  assert.throws(() => normalizePublicOrigin("https://link.watermelonbackup.com/pair"), /PUBLIC_ORIGIN/);
  assert.throws(() => normalizePublicOrigin("https://user@example.com"), /PUBLIC_ORIGIN/);
});

test("deployment config fixes ticket TTL and preserves HTTP connection headroom", () => {
  const names = [
    "NODE_ENV", "TURNSTILE_BYPASS", "TICKET_TTL_SECONDS", "MAX_ROOMS", "MAX_SERVER_CONNECTIONS"
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = "development";
    process.env.TURNSTILE_BYPASS = "true";
    process.env.TICKET_TTL_SECONDS = "91";
    assert.throws(() => loadConfig(), /TICKET_TTL_SECONDS/);

    process.env.TICKET_TTL_SECONDS = "90";
    process.env.MAX_ROOMS = "1000";
    process.env.MAX_SERVER_CONNECTIONS = "2000";
    assert.throws(() => loadConfig(), /MAX_SERVER_CONNECTIONS/);
    process.env.MAX_SERVER_CONNECTIONS = "2128";
    assert.equal(loadConfig().maxServerConnections, 2128);
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
