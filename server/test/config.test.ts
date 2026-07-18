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
    "NODE_ENV", "TURNSTILE_BYPASS", "TICKET_TTL_SECONDS", "MAX_ROOMS", "MAX_SERVER_CONNECTIONS",
    "WEBSOCKET_UPGRADES_PER_MINUTE", "WEBSOCKET_RAW_UPGRADES_GLOBAL_PER_MINUTE",
    "USAGE_METRICS_PATH", "USAGE_METRICS_RETENTION_DAYS"
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

    delete process.env.WEBSOCKET_UPGRADES_PER_MINUTE;
    delete process.env.WEBSOCKET_RAW_UPGRADES_GLOBAL_PER_MINUTE;
    delete process.env.USAGE_METRICS_PATH;
    delete process.env.USAGE_METRICS_RETENTION_DAYS;
    const defaults = loadConfig();
    assert.equal(defaults.websocketUpgradesPerMinute, 60);
    assert.equal(defaults.websocketRawUpgradesGlobalPerMinute, 12_000);
    assert.equal(defaults.usageMetricsPath, null);
    assert.equal(defaults.usageMetricsRetentionDays, 100);

    process.env.USAGE_METRICS_PATH = " /var/lib/watermelon-link/usage.json ";
    process.env.USAGE_METRICS_RETENTION_DAYS = "100";
    assert.equal(loadConfig().usageMetricsPath, "/var/lib/watermelon-link/usage.json");
    assert.equal(loadConfig().usageMetricsRetentionDays, 100);
    process.env.USAGE_METRICS_RETENTION_DAYS = "101";
    assert.throws(() => loadConfig(), /USAGE_METRICS_RETENTION_DAYS/);
    process.env.USAGE_METRICS_RETENTION_DAYS = "100";

    process.env.WEBSOCKET_UPGRADES_PER_MINUTE = "60";
    process.env.WEBSOCKET_RAW_UPGRADES_GLOBAL_PER_MINUTE = "238";
    assert.throws(() => loadConfig(), /WEBSOCKET_RAW_UPGRADES_GLOBAL_PER_MINUTE/);
    process.env.WEBSOCKET_RAW_UPGRADES_GLOBAL_PER_MINUTE = "239";
    assert.equal(loadConfig().websocketRawUpgradesGlobalPerMinute, 239);
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("production config requires signing and Turnstile secrets without bypass", () => {
  const names = [
    "NODE_ENV", "TURNSTILE_BYPASS", "TICKET_SIGNING_SECRET", "TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY", "PUBLIC_ORIGIN",
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_ORIGIN = "https://link.watermelonbackup.com";
    process.env.TURNSTILE_BYPASS = "false";
    process.env.TICKET_SIGNING_SECRET = "s".repeat(32);
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    assert.equal(loadConfig().production, true);

    process.env.TICKET_SIGNING_SECRET = "too-short";
    assert.throws(() => loadConfig(), /TICKET_SIGNING_SECRET/);
    process.env.TICKET_SIGNING_SECRET = "s".repeat(32);

    process.env.TURNSTILE_BYPASS = "true";
    assert.throws(() => loadConfig(), /TURNSTILE_BYPASS/);
    process.env.TURNSTILE_BYPASS = "false";
    delete process.env.TURNSTILE_SITE_KEY;
    assert.throws(() => loadConfig(), /Turnstile keys/);
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
