import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UsageMetrics } from "../src/usage-metrics.js";

test("usage metrics persist bounded hourly and daily aggregates without client identifiers", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-usage-"));
  const path = join(directory, "usage.json");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const now = Date.now();
  const metrics = new UsageMetrics(path, 2, "test-usage-hash-secret-with-32-chars");
  metrics.recordGeneratedLink({ browser: "Edge", operatingSystem: "Windows" }, "v4:203.0.113.1", now - 3 * 86_400_000);
  metrics.recordGeneratedLink({ browser: "Chrome", operatingSystem: "macOS" }, "v4:203.0.113.2", now);
  metrics.recordGeneratedLink({ browser: "Chrome", operatingSystem: "macOS" }, "v4:203.0.113.2", now);
  metrics.recordConnection({ browser: "Chrome", operatingSystem: "macOS" }, "v4:203.0.113.2", now);
  await metrics.close();

  const day = new Date(now).toISOString().slice(0, 10);
  const hour = new Date(now).toISOString().slice(0, 13);
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.lifetime.generatedLinks.total, 3);
  assert.equal(snapshot.lifetime.successfulConnections.total, 1);
  assert.deepEqual(snapshot.lifetime.generatedLinks.browsers, { Edge: 1, Chrome: 2 });
  assert.deepEqual(Object.keys(snapshot.days), [day]);
  assert.deepEqual(Object.keys(snapshot.hours), [hour]);
  assert.deepEqual(snapshot.days[day]?.generatedLinks, {
    total: 2,
    browsers: { Chrome: 2 },
    operatingSystems: { macOS: 2 },
    uniqueNetworks: 1,
    uniqueNetworksCapped: false,
    networkHashes: [snapshot.days[day]!.generatedLinks.networkHashes[0]]
  });
  assert.match(snapshot.days[day]!.generatedLinks.networkHashes[0]!, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(snapshot.days[day]?.successfulConnections, {
    total: 1,
    browsers: { Chrome: 1 },
    operatingSystems: { macOS: 1 },
    uniqueNetworks: 1,
    uniqueNetworksCapped: false,
    networkHashes: [snapshot.days[day]!.successfulConnections.networkHashes[0]]
  });
  assert.deepEqual(snapshot.hours[hour], snapshot.days[day]);
  const persisted = await readFile(path, "utf8");
  assert.equal(persisted.includes("user-agent"), false);
  assert.equal(persisted.includes("session"), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  const reloaded = new UsageMetrics(path, 2, "test-usage-hash-secret-with-32-chars");
  assert.deepEqual(reloaded.snapshot(), metrics.snapshot());
  reloaded.recordGeneratedLink({ browser: "Chrome", operatingSystem: "macOS" }, "v4:203.0.113.2", now);
  assert.equal(reloaded.snapshot().days[day]?.generatedLinks.total, 3);
  assert.equal(reloaded.snapshot().days[day]?.generatedLinks.uniqueNetworks, 1);
  await reloaded.close();
});

test("usage metrics retain independent UTC-hour uniques while deduplicating the UTC day", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-usage-hours-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const day = new Date().toISOString().slice(0, 10);
  const firstHour = Date.parse(`${day}T12:05:00Z`);
  const secondHour = firstHour + 3_600_000;
  const metrics = new UsageMetrics(join(directory, "usage.json"), 100, "test-usage-hash-secret-with-32-chars");
  const platform = { browser: "Chrome", operatingSystem: "macOS" } as const;

  metrics.recordGeneratedLink(platform, "v4:203.0.113.1", firstHour);
  metrics.recordGeneratedLink(platform, "v4:203.0.113.1", firstHour + 60_000);
  metrics.recordGeneratedLink(platform, "v4:203.0.113.1", secondHour);

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.days[day]?.generatedLinks.total, 3);
  assert.equal(snapshot.days[day]?.generatedLinks.uniqueNetworks, 1);
  assert.equal(snapshot.hours[`${day}T12`]?.generatedLinks.total, 2);
  assert.equal(snapshot.hours[`${day}T12`]?.generatedLinks.uniqueNetworks, 1);
  assert.deepEqual(snapshot.hours[`${day}T12`]?.generatedLinks.networkHashes, []);
  assert.equal(snapshot.hours[`${day}T13`]?.generatedLinks.total, 1);
  assert.equal(snapshot.hours[`${day}T13`]?.generatedLinks.uniqueNetworks, 1);
  assert.equal(snapshot.lifetime.generatedLinks.total, 3);
  await metrics.close();
});

test("usage network HMAC values rotate by UTC day", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-usage-rotation-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const now = Date.now();
  const previous = new UsageMetrics(join(directory, "previous.json"), 3, "test-usage-hash-secret-with-32-chars");
  previous.recordGeneratedLink(
    { browser: "Edge", operatingSystem: "Windows" },
    "v4:203.0.113.1",
    now - 86_400_000
  );
  const previousHash = Object.values(previous.snapshot().days)[0]?.generatedLinks.networkHashes[0];

  const current = new UsageMetrics(join(directory, "current.json"), 3, "test-usage-hash-secret-with-32-chars");
  current.recordGeneratedLink({ browser: "Edge", operatingSystem: "Windows" }, "v4:203.0.113.1", now);
  const currentHash = Object.values(current.snapshot().days)[0]?.generatedLinks.networkHashes[0];

  assert.notEqual(previousHash, currentHash);
  await previous.close();
  await current.close();
});

test("usage metrics cap period deduplication state without dropping event totals", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-usage-cap-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const metrics = new UsageMetrics(join(directory, "usage.json"), 3, "test-usage-hash-secret-with-32-chars");
  const platform = { browser: "Chrome", operatingSystem: "Windows" } as const;
  for (let index = 0; index < 10_005; index += 1) {
    metrics.recordGeneratedLink(platform, `v6:2001:0db8:${index.toString(16).padStart(4, "0")}:0000`);
  }
  const generated = Object.values(metrics.snapshot().days)[0]?.generatedLinks;
  assert.equal(generated?.total, 10_005);
  assert.equal(generated?.uniqueNetworks, 10_000);
  assert.equal(generated?.networkHashes.length, 10_000);
  assert.equal(generated?.uniqueNetworksCapped, true);
  assert.equal(metrics.snapshot().lifetime.generatedLinks.total, 10_005);
  await metrics.close();
});

test("maximum retained hourly history remains within the metrics file budget", async () => {
  const payloads: string[] = [];
  const metrics = new UsageMetrics(
    "/virtual/usage.json",
    100,
    "test-usage-hash-secret-with-32-chars",
    async (_path, payload) => { payloads.push(payload); }
  );
  const browsers = ["Chrome", "Edge", "Firefox", "Safari", "Chromium", "Other", "Chrome"] as const;
  const systems = ["Windows", "macOS", "iOS", "Android", "Linux", "ChromeOS", "Other"] as const;
  const currentHour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  for (let offset = 2_399; offset >= 1; offset -= 1) {
    for (let category = 0; category < systems.length; category += 1) {
      const platform = { browser: browsers[category]!, operatingSystem: systems[category]! };
      const timestamp = currentHour - offset * 3_600_000;
      metrics.recordGeneratedLink(platform, `generated-${offset}-${category}`, timestamp);
      metrics.recordConnection(platform, `connected-${offset}-${category}`, timestamp);
    }
  }
  for (let index = 0; index < 10_000; index += 1) {
    const platform = { browser: browsers[index % browsers.length]!, operatingSystem: systems[index % systems.length]! };
    metrics.recordGeneratedLink(platform, `generated-current-${index}`, currentHour);
    metrics.recordConnection(platform, `connected-current-${index}`, currentHour);
  }

  await metrics.close();
  assert.equal(payloads.length, 1);
  assert.ok(Buffer.byteLength(payloads[0]!) < 10 * 1024 * 1024);
});

test("usage metrics write failures remain fail-open", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-usage-failure-"));
  const blockedPath = join(directory, "blocked");
  await mkdir(blockedPath);
  context.after(() => rm(directory, { recursive: true, force: true }));
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => { errors.push(values); };
  try {
    const metrics = new UsageMetrics(blockedPath, 3, "test-usage-hash-secret-with-32-chars");
    metrics.recordConnection({ browser: "Chrome", operatingSystem: "Windows" }, "v4:203.0.113.9");
    await metrics.flush();
    metrics.recordConnection({ browser: "Chrome", operatingSystem: "Windows" }, "v4:203.0.113.9");
    await metrics.close();
    assert.equal(Object.values(metrics.snapshot().days)[0]?.successfulConnections.total, 2);
    assert.equal(errors.filter(([message]) => message === "usage_metrics_write_failed").length, 1);
  } finally {
    console.error = originalError;
  }
});

test("usage metrics coalesce flushes behind a stalled write", async () => {
  let releaseFirstWrite: (() => void) | undefined;
  const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
  const payloads: string[] = [];
  const metrics = new UsageMetrics(
    "/virtual/usage.json",
    3,
    "test-usage-hash-secret-with-32-chars",
    async (_path, payload) => {
      payloads.push(payload);
      if (payloads.length === 1) await firstWrite;
    }
  );
  const platform = { browser: "Edge", operatingSystem: "macOS" } as const;
  metrics.recordGeneratedLink(platform, "v4:203.0.113.1");
  const initialFlush = metrics.flush();
  metrics.recordGeneratedLink(platform, "v4:203.0.113.2");
  const secondFlush = metrics.flush();
  metrics.recordGeneratedLink(platform, "v4:203.0.113.3");
  const thirdFlush = metrics.flush();

  assert.equal(payloads.length, 1);
  releaseFirstWrite?.();
  await Promise.all([initialFlush, secondFlush, thirdFlush]);
  assert.equal(payloads.length, 2);
  const last = JSON.parse(payloads[1]!) as { days: Record<string, { generatedLinks: { total: number } }> };
  assert.equal(Object.values(last.days)[0]?.generatedLinks.total, 3);
  await metrics.close();
});

test("close drains a flush requested in the write-loop finalization gap", async () => {
  let releaseFirstWrite: (() => void) | undefined;
  const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
  const payloads: string[] = [];
  let isFirstWrite = true;
  const metrics = new UsageMetrics(
    "/virtual/usage.json",
    3,
    "test-usage-hash-secret-with-32-chars",
    async (_path, payload) => {
      payloads.push(payload);
      if (isFirstWrite) {
        isFirstWrite = false;
        await firstWrite;
      }
    }
  );
  const platform = { browser: "Edge", operatingSystem: "macOS" } as const;
  metrics.recordGeneratedLink(platform, "v4:203.0.113.1");
  const initialFlush = metrics.flush();
  metrics.recordGeneratedLink(platform, "v4:203.0.113.2");

  let closePromise: Promise<void> | undefined;
  releaseFirstWrite?.();
  queueMicrotask(() => queueMicrotask(() => {
    closePromise = metrics.close();
  }));

  await initialFlush;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(closePromise);
  await closePromise;
  assert.equal(payloads.length, 2);
  const persisted = JSON.parse(payloads[1]!) as { days: Record<string, { generatedLinks: { total: number } }> };
  assert.equal(Object.values(persisted.days)[0]?.generatedLinks.total, 2);
});
