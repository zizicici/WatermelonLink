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

export type UsagePeriod = {
  generatedLinks: UsageBreakdown;
  successfulConnections: UsageBreakdown;
};

export type UsageTotalsBreakdown = {
  total: number;
  browsers: Record<string, number>;
  operatingSystems: Record<string, number>;
};

export type UsageTotals = {
  generatedLinks: UsageTotalsBreakdown;
  successfulConnections: UsageTotalsBreakdown;
};

export type UsageMetricsState = {
  version: 2;
  lifetime: UsageTotals;
  days: Record<string, UsagePeriod>;
  hours: Record<string, UsagePeriod>;
};

type MetricsWriter = (path: string, payload: string) => Promise<void>;

const maximumMetricsFileBytes = 10 * 1024 * 1024;
const maximumPeriodNetworkHashes = 10_000;
const maximumRetainedDays = 100;
const maximumRetainedHours = maximumRetainedDays * 24;
const maximumBreakdownCategories = 16;
const flushDelayMilliseconds = 60_000;

export class UsageMetrics {
  private state: UsageMetricsState = { version: 2, lifetime: emptyTotals(), days: {}, hours: {} };
  private flushTimer: NodeJS.Timeout | undefined;
  private writeLoop: Promise<void> | null = null;
  private writeDirty = false;
  private readonly networkSets = new Map<string, { generatedLinks: Set<string>; successfulConnections: Set<string> }>();
  private readonly hashKey: Buffer;
  private lastPrunedHour = "";
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
    this.lastPrunedHour = hourString(now);
  }

  recordGeneratedLink(platform: ClientPlatform, network: string, now = Date.now()): void {
    this.record("generatedLinks", platform, network, now);
  }

  recordConnection(platform: ClientPlatform, network: string, now = Date.now()): void {
    this.record("successfulConnections", platform, network, now);
  }

  private record(kind: keyof UsagePeriod, platform: ClientPlatform, network: string, now: number): void {
    if (this.closed || !this.path) return;
    const day = dayString(now);
    const hour = hourString(now);
    if (hour !== this.lastPrunedHour) {
      this.prune(now);
      this.lastPrunedHour = hour;
    }
    const networkHash = createHmac("sha256", this.hashKey)
      .update(day)
      .update("\0")
      .update(network)
      .digest()
      .subarray(0, 16)
      .toString("base64url");
    const dailyUsage = this.state.days[day] ?? emptyUsage();
    const hourlyUsage = this.state.hours[hour] ?? emptyUsage();
    updateTotals(this.state.lifetime[kind], platform);
    this.updateUsage(dailyUsage, `day:${day}`, kind, platform, networkHash);
    this.updateUsage(hourlyUsage, `hour:${hour}`, kind, platform, networkHash);
    this.state.days[day] = dailyUsage;
    this.state.hours[hour] = hourlyUsage;
    this.scheduleFlush();
  }

  private updateUsage(
    usage: UsagePeriod,
    setKey: string,
    kind: keyof UsagePeriod,
    platform: ClientPlatform,
    networkHash: string
  ): void {
    const breakdown = usage[kind];
    breakdown.total += 1;
    increment(breakdown.browsers, platform.browser);
    increment(breakdown.operatingSystems, platform.operatingSystem);
    const networkSet = this.networkSet(setKey, usage)[kind];
    if (!networkSet.has(networkHash) && networkSet.size < maximumPeriodNetworkHashes) {
      networkSet.add(networkHash);
      breakdown.networkHashes.push(networkHash);
      breakdown.uniqueNetworks += 1;
    } else if (!networkSet.has(networkHash)) {
      breakdown.uniqueNetworksCapped = true;
    }
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
    const currentHour = hourString(now);
    const dayCutoff = dayString(now - Math.max(0, this.retentionDays - 1) * 86_400_000);
    const retainedHours = Math.min(maximumRetainedHours, this.retentionDays * 24);
    const hourCutoff = hourString(now - (retainedHours - 1) * 3_600_000);
    for (const day of Object.keys(this.state.days)) {
      const setKey = `day:${day}`;
      if (day < dayCutoff) {
        delete this.state.days[day];
        this.networkSets.delete(setKey);
        changed = true;
      } else if (day !== currentDay) {
        const usage = this.state.days[day]!;
        if (usage.generatedLinks.networkHashes.length > 0 || usage.successfulConnections.networkHashes.length > 0) {
          usage.generatedLinks.networkHashes = [];
          usage.successfulConnections.networkHashes = [];
          this.networkSets.delete(setKey);
          changed = true;
        }
      }
    }
    for (const hour of Object.keys(this.state.hours)) {
      const setKey = `hour:${hour}`;
      if (hour < hourCutoff) {
        delete this.state.hours[hour];
        this.networkSets.delete(setKey);
        changed = true;
      } else if (hour !== currentHour) {
        const usage = this.state.hours[hour]!;
        if (usage.generatedLinks.networkHashes.length > 0 || usage.successfulConnections.networkHashes.length > 0) {
          usage.generatedLinks.networkHashes = [];
          usage.successfulConnections.networkHashes = [];
          this.networkSets.delete(setKey);
          changed = true;
        }
      }
    }
    return changed;
  }

  private networkSet(setKey: string, usage: UsagePeriod): { generatedLinks: Set<string>; successfulConnections: Set<string> } {
    let sets = this.networkSets.get(setKey);
    if (!sets) {
      sets = {
        generatedLinks: new Set(usage.generatedLinks.networkHashes),
        successfulConnections: new Set(usage.successfulConnections.networkHashes)
      };
      this.networkSets.set(setKey, sets);
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

function hourString(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 13);
}

function validateState(value: unknown): UsageMetricsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_metrics_state");
  const candidate = value as { version?: unknown; lifetime?: unknown; days?: unknown; hours?: unknown };
  if (candidate.version !== 2) throw new Error("invalid_metrics_state");
  const days = validatePeriods(candidate.days, /^\d{4}-\d{2}-\d{2}$/, maximumRetainedDays);
  const hours = validatePeriods(candidate.hours, /^\d{4}-\d{2}-\d{2}T\d{2}$/, maximumRetainedHours);
  const lifetime = validateTotals(candidate.lifetime);
  return { version: 2, lifetime, days, hours };
}

function validatePeriods(value: unknown, keyPattern: RegExp, maximumEntries: number): Record<string, UsagePeriod> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_metrics_state");
  const entries = Object.entries(value);
  if (entries.length > maximumEntries) throw new Error("invalid_metrics_state");
  const periods: Record<string, UsagePeriod> = {};
  for (const [key, rawUsage] of entries) {
    if (!keyPattern.test(key) || !rawUsage || typeof rawUsage !== "object" || Array.isArray(rawUsage)) {
      throw new Error("invalid_metrics_state");
    }
    const usage = rawUsage as Partial<UsagePeriod>;
    periods[key] = {
      generatedLinks: validateBreakdown(usage.generatedLinks),
      successfulConnections: validateBreakdown(usage.successfulConnections)
    };
  }
  return periods;
}

function emptyUsage(): UsagePeriod {
  return { generatedLinks: emptyBreakdown(), successfulConnections: emptyBreakdown() };
}

function emptyTotals(): UsageTotals {
  return { generatedLinks: emptyTotalsBreakdown(), successfulConnections: emptyTotalsBreakdown() };
}

function emptyTotalsBreakdown(): UsageTotalsBreakdown {
  return { total: 0, browsers: {}, operatingSystems: {} };
}

function updateTotals(totals: UsageTotalsBreakdown, platform: ClientPlatform): void {
  totals.total += 1;
  increment(totals.browsers, platform.browser);
  increment(totals.operatingSystems, platform.operatingSystem);
}

function validateTotals(value: unknown): UsageTotals {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_metrics_state");
  const totals = value as Partial<UsageTotals>;
  return {
    generatedLinks: validateTotalsBreakdown(totals.generatedLinks),
    successfulConnections: validateTotalsBreakdown(totals.successfulConnections)
  };
}

function validateTotalsBreakdown(value: unknown): UsageTotalsBreakdown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_metrics_state");
  const breakdown = value as Partial<UsageTotalsBreakdown>;
  if (!isCount(breakdown.total)) throw new Error("invalid_metrics_state");
  const browsers = validateCounts(breakdown.browsers);
  const operatingSystems = validateCounts(breakdown.operatingSystems);
  if (sum(browsers) !== breakdown.total || sum(operatingSystems) !== breakdown.total) {
    throw new Error("invalid_metrics_state");
  }
  return { total: breakdown.total, browsers, operatingSystems };
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
      networkHashes.length > maximumPeriodNetworkHashes) {
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
  if (!Array.isArray(value) || value.length > maximumPeriodNetworkHashes ||
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
