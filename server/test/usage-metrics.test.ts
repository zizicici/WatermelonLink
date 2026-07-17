import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UsageMetrics } from "../src/usage-metrics.js";

test("usage metrics persist bounded daily aggregates without client identifiers", async (context) => {
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
  const snapshot = metrics.snapshot();
  assert.deepEqual(Object.keys(snapshot.days), [day]);
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

test("usage metrics cap daily deduplication state without dropping event totals", async (context) => {
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
  await metrics.close();
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
