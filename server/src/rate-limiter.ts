type Entry = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly limit: number,
    private readonly windowMilliseconds: number,
    private readonly maxKeys = 10_000
  ) {}

  consume(key: string, now = Date.now()): boolean {
    const existing = this.entries.get(key);
    if (existing?.resetAt !== undefined && existing.resetAt <= now) {
      this.entries.delete(key);
      this.entries.set(key, { count: 1, resetAt: now + this.windowMilliseconds });
      return true;
    }
    if (!existing) {
      if (!this.makeSpace(now)) return false;
      this.entries.set(key, { count: 1, resetAt: now + this.windowMilliseconds });
      return true;
    }
    if (existing.count >= this.limit) return false;
    existing.count += 1;
    return true;
  }

  private makeSpace(now: number): boolean {
    if (this.entries.size < this.maxKeys) return true;
    let inspected = 0;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
      if (this.entries.size < this.maxKeys) return true;
      inspected += 1;
      if (inspected >= 32) break;
    }
    return false;
  }
}
