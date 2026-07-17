import { createHmac } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { ClientPlatform } from "./client-platform.js";

export type UsageBreakdown = {
  total: number;
  browsers: Record<string, number>;
  operatingSystems: Record<string, number>;
  uniqueNetworks: number;
  uniqueNetworksCapped: boolean;
  networkHashes: string[];
};

export type DailyUsage = {
  generatedLinks: UsageBreakdown;
  successfulConnections: UsageBreakdown;
};

export type UsageMetricsState = {
  version: 1;
  days: Record<string, DailyUsage>;
};

type MetricsWriter = (path: string, payload: string) => Promise<void>;

const maximumMetricsFileBytes = 2 * 1024 * 1024;
const maximumDailyNetworkHashes = 10_000;
const maximumRetainedDays = 400;
const maximumBreakdownCategories = 16;
const flushDelayMilliseconds = 60_000;

export class UsageMetrics {
  private state: UsageMetricsState = { version: 1, days: {} };
  private flushTimer: NodeJS.Timeout | undefined;
  private writeLoop: Promise<void> | null = null;
  private writeDirty = false;
  private readonly networkSets = new Map<string, { generatedLinks: Set<string>; successfulConnections: Set<string> }>();
  private readonly hashKey: Buffer;
  private lastPrunedDay = "";
  private writeFailureLogged = false;
  private closed = false;

  constructor(
    private readonly path: string | null,
    private readonly retentionDays: number,
    hashSecret: string,
    private readonly writer: MetricsWriter = writeMetrics
  ) {
    this.hashKey = createHmac("sha256", hashSecret).update("watermelon-link-usage-network-v1").digest();
    if (path) this.load(path);
    const now = Date.now();
    if (this.prune(now)) this.scheduleFlush();
    this.lastPrunedDay = dayString(now);
  }

  recordGeneratedLink(platform: ClientPlatform, network: string, now = Date.now()): void {
    this.record("generatedLinks", platform, network, now);
  }

  recordConnection(platform: ClientPlatform, network: string, now = Date.now()): void {
    this.record("successfulConnections", platform, network, now);
  }

  private record(kind: keyof DailyUsage, platform: ClientPlatform, network: string, now: number): void {
    if (this.closed || !this.path) return;
    const day = dayString(now);
    if (day !== this.lastPrunedDay) {
      this.prune(now);
      this.lastPrunedDay = day;
    }
    const usage = this.state.days[day] ?? {
      generatedLinks: emptyBreakdown(),
      successfulConnections: emptyBreakdown()
    };
    const breakdown = usage[kind];
    breakdown.total += 1;
    increment(breakdown.browsers, platform.browser);
    increment(breakdown.operatingSystems, platform.operatingSystem);
    const networkHash = createHmac("sha256", this.hashKey)
      .update(day)
      .update("\0")
      .update(network)
      .digest()
      .subarray(0, 16)
      .toString("base64url");
    const networkSet = this.networkSet(day, usage)[kind];
    if (!networkSet.has(networkHash) && networkSet.size < maximumDailyNetworkHashes) {
      networkSet.add(networkHash);
      breakdown.networkHashes.push(networkHash);
      breakdown.uniqueNetworks += 1;
    } else if (!networkSet.has(networkHash)) {
      breakdown.uniqueNetworksCapped = true;
    }
    this.state.days[day] = usage;
    this.scheduleFlush();
  }

  snapshot(): UsageMetricsState {
    return structuredClone(this.state);
  }

  flush(): Promise<void> {
    if (!this.path) return Promise.resolve();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.writeDirty = true;
    if (this.writeLoop) return this.writeLoop;
    const loop = this.drainWrites().finally(() => {
      if (this.writeLoop !== loop) return;
      this.writeLoop = null;
      if (this.writeDirty) return this.flush();
    });
    this.writeLoop = loop;
    return loop;
  }

  async close(): Promise<void> {
    if (this.closed) return this.writeLoop ?? Promise.resolve();
    this.closed = true;
    await this.flush();
  }

  private scheduleFlush(): void {
    if (!this.path || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, flushDelayMilliseconds);
    this.flushTimer.unref();
  }

  private prune(now: number): boolean {
    let changed = false;
    const currentDay = dayString(now);
    const cutoff = dayString(now - Math.max(0, this.retentionDays - 1) * 86_400_000);
    for (const day of Object.keys(this.state.days)) {
      if (day < cutoff) {
        delete this.state.days[day];
        this.networkSets.delete(day);
        changed = true;
      } else if (day !== currentDay) {
        const usage = this.state.days[day]!;
        if (usage.generatedLinks.networkHashes.length > 0 || usage.successfulConnections.networkHashes.length > 0) {
          usage.generatedLinks.networkHashes = [];
          usage.successfulConnections.networkHashes = [];
          this.networkSets.delete(day);
          changed = true;
        }
      }
    }
    return changed;
  }

  private networkSet(day: string, usage: DailyUsage): { generatedLinks: Set<string>; successfulConnections: Set<string> } {
    let sets = this.networkSets.get(day);
    if (!sets) {
      sets = {
        generatedLinks: new Set(usage.generatedLinks.networkHashes),
        successfulConnections: new Set(usage.successfulConnections.networkHashes)
      };
      this.networkSets.set(day, sets);
    }
    return sets;
  }

  private load(path: string): void {
    try {
      if (statSync(path).size > maximumMetricsFileBytes) throw new Error("metrics_file_too_large");
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      this.state = validateState(parsed);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("usage_metrics_load_failed", error instanceof Error ? error.name : typeof error);
      }
    }
  }

  private async drainWrites(): Promise<void> {
    while (this.writeDirty) {
      this.writeDirty = false;
      let payload: string;
      try {
        payload = `${JSON.stringify(this.state)}\n`;
        if (Buffer.byteLength(payload) > maximumMetricsFileBytes) throw new Error("metrics_file_too_large");
      } catch (error: unknown) {
        this.logWriteFailure(error);
        continue;
      }
      try {
        await this.writer(this.path!, payload);
        this.writeFailureLogged = false;
      } catch (error: unknown) {
        this.logWriteFailure(error);
      }
    }
  }

  private logWriteFailure(error: unknown): void {
    if (this.writeFailureLogged) return;
    this.writeFailureLogged = true;
    console.error("usage_metrics_write_failed", error instanceof Error ? error.name : typeof error);
  }
}

async function writeMetrics(path: string, payload: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o750 });
  await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function dayString(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function validateState(value: unknown): UsageMetricsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_metrics_state");
  const candidate = value as { version?: unknown; days?: unknown };
  if (candidate.version !== 1 || !candidate.days || typeof candidate.days !== "object" || Array.isArray(candidate.days)) {
    throw new Error("invalid_metrics_state");
  }
  const state: UsageMetricsState = { version: 1, days: {} };
  const days = Object.entries(candidate.days);
  if (days.length > maximumRetainedDays) throw new Error("invalid_metrics_state");
  for (const [day, rawUsage] of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !rawUsage || typeof rawUsage !== "object" || Array.isArray(rawUsage)) {
      throw new Error("invalid_metrics_state");
    }
    const usage = rawUsage as Partial<DailyUsage>;
    state.days[day] = {
      generatedLinks: validateBreakdown(usage.generatedLinks),
      successfulConnections: validateBreakdown(usage.successfulConnections)
    };
  }
  return state;
}

function emptyBreakdown(): UsageBreakdown {
  return {
    total: 0,
    browsers: {},
    operatingSystems: {},
    uniqueNetworks: 0,
    uniqueNetworksCapped: false,
    networkHashes: []
  };
}

function validateBreakdown(value: unknown): UsageBreakdown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_metrics_state");
  const breakdown = value as Partial<UsageBreakdown>;
  if (!isCount(breakdown.total)) throw new Error("invalid_metrics_state");
  const browsers = validateCounts(breakdown.browsers);
  const operatingSystems = validateCounts(breakdown.operatingSystems);
  if (!isCount(breakdown.uniqueNetworks) || typeof breakdown.uniqueNetworksCapped !== "boolean") {
    throw new Error("invalid_metrics_state");
  }
  const networkHashes = validateNetworkHashes(breakdown.networkHashes);
  if (sum(browsers) !== breakdown.total || sum(operatingSystems) !== breakdown.total) {
    throw new Error("invalid_metrics_state");
  }
  if (networkHashes.length > breakdown.uniqueNetworks || breakdown.uniqueNetworks > breakdown.total ||
      networkHashes.length > maximumDailyNetworkHashes) {
    throw new Error("invalid_metrics_state");
  }
  return {
    total: breakdown.total,
    browsers,
    operatingSystems,
    uniqueNetworks: breakdown.uniqueNetworks,
    uniqueNetworksCapped: breakdown.uniqueNetworksCapped,
    networkHashes
  };
}

function validateNetworkHashes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > maximumDailyNetworkHashes ||
      value.some((hash) => typeof hash !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(hash))) {
    throw new Error("invalid_metrics_state");
  }
  if (new Set(value).size !== value.length) throw new Error("invalid_metrics_state");
  return [...value];
}

function validateCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_metrics_state");
  if (Object.keys(value).length > maximumBreakdownCategories) throw new Error("invalid_metrics_state");
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(key) || !isCount(count)) throw new Error("invalid_metrics_state");
    counts[key] = count;
  }
  return counts;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}
