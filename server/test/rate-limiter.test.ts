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
