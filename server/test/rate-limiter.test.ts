import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowRateLimiter } from "../src/rate-limiter.js";

test("rate limiter resets at the next window", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000);
  assert.equal(limiter.consume("client", 0), true);
  assert.equal(limiter.consume("client", 1), true);
  assert.equal(limiter.consume("client", 2), false);
  assert.equal(limiter.consume("client", 1_000), true);
});

test("rate limiter bounds the number of tracked keys", () => {
  const limiter = new FixedWindowRateLimiter(1, 60_000, 2);
  assert.equal(limiter.consume("one", 0), true);
  assert.equal(limiter.consume("two", 0), true);
  assert.equal(limiter.consume("three", 0), true);
  assert.equal(limiter.consume("one", 1), true);
});

test("two phase-shifted network buckets leave one slot in a four-times-minus-one raw global budget", () => {
  const networkLimit = 4;
  const windowMilliseconds = 60_000;
  const trusted = new FixedWindowRateLimiter(networkLimit, windowMilliseconds);
  const untrusted = new FixedWindowRateLimiter(networkLimit, windowMilliseconds);
  const rawGlobal = new FixedWindowRateLimiter(networkLimit * 4 - 1, windowMilliseconds, 1);
  let globalConsumes = 0;
  const consume = (networkLimiter: FixedWindowRateLimiter, now: number, network = "network") => {
    if (!networkLimiter.consume(network, now)) return false;
    assert.equal(rawGlobal.consume("global", now), true);
    globalConsumes += 1;
    return true;
  };

  assert.equal(consume(trusted, -windowMilliseconds, "other-network"), true);
  assert.equal(consume(trusted, -1), true);
  assert.equal(consume(untrusted, -1), true);
  globalConsumes = 0;

  for (const limiter of [trusted, untrusted]) {
    for (let attempt = 0; attempt < networkLimit - 1; attempt += 1) {
      assert.equal(consume(limiter, 0), true);
    }
  }
  for (const limiter of [trusted, untrusted]) {
    for (let attempt = 0; attempt < networkLimit; attempt += 1) {
      assert.equal(consume(limiter, windowMilliseconds - 1), true);
    }
  }

  assert.equal(globalConsumes, networkLimit * 4 - 2);
  assert.equal(consume(trusted, windowMilliseconds - 1), false);
  assert.equal(consume(untrusted, windowMilliseconds - 1), false);
  assert.equal(consume(trusted, windowMilliseconds - 1, "other-network"), true);
  assert.equal(globalConsumes, networkLimit * 4 - 1);
});
