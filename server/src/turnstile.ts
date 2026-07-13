import { isPlausibleTurnstileToken } from "./network-security.js";
import { FixedWindowRateLimiter } from "./rate-limiter.js";

export type TurnstileVerification = "verified" | "rejected" | "unavailable" | "busy";

type TurnstileOptions = {
  secretKey: string | null;
  expectedHostname: string | null;
  maximumConcurrent: number;
  requestsPerMinute: number;
};

export class TurnstileVerifier {
  private active = 0;
  private readonly rateLimiter: FixedWindowRateLimiter;

  constructor(
    private readonly options: TurnstileOptions,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {
    this.rateLimiter = new FixedWindowRateLimiter(options.requestsPerMinute, 60_000, 1);
  }

  async verify(token: string, ip: string, signal?: AbortSignal): Promise<TurnstileVerification> {
    if (!this.options.secretKey || !isPlausibleTurnstileToken(token)) return "rejected";
    if (this.active >= this.options.maximumConcurrent) return "busy";
    if (!this.rateLimiter.consume("global")) return "busy";
    try {
      this.active += 1;
      const timeout = AbortSignal.timeout(5_000);
      const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const form = new URLSearchParams({ secret: this.options.secretKey, response: token, remoteip: ip });
      const response = await this.fetchImplementation("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        signal: combinedSignal
      });
      if (!response.ok) return "unavailable";
      const result = await response.json() as {
        success?: boolean;
        action?: string;
        hostname?: string;
        "error-codes"?: string[];
      };
      if (result["error-codes"]?.some((code) =>
        code === "internal-error" || code === "missing-input-secret" ||
        code === "invalid-input-secret" || code === "bad-request"
      )) return "unavailable";
      return result.success === true && result.action === "create_link" &&
        (!this.options.expectedHostname || result.hostname === this.options.expectedHostname)
        ? "verified"
        : "rejected";
    } catch {
      return "unavailable";
    } finally {
      this.active -= 1;
    }
  }
}
