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
    if (!existing || existing.resetAt <= now) {
      this.makeSpace(now);
      this.entries.set(key, { count: 1, resetAt: now + this.windowMilliseconds });
      return true;
    }
    if (existing.count >= this.limit) return false;
    existing.count += 1;
    return true;
  }

  private makeSpace(now: number): void {
    if (this.entries.size < this.maxKeys) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
      if (this.entries.size < this.maxKeys) return;
    }
    const oldest = this.entries.keys().next().value as string | undefined;
    if (oldest) this.entries.delete(oldest);
  }
}
