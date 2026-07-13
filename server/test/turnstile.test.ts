import assert from "node:assert/strict";
import test from "node:test";
import { TurnstileVerifier } from "../src/turnstile.js";

const token = "turnstile-token-that-passes-preflight";

test("Turnstile verification enforces action and hostname", async () => {
  const verifier = new TurnstileVerifier({
    secretKey: "secret",
    expectedHostname: "link.watermelonbackup.com",
    maximumConcurrent: 2,
    requestsPerMinute: 10,
  }, (async () => new Response(JSON.stringify({
    success: true,
    action: "create_link",
    hostname: "link.watermelonbackup.com",
  }), { status: 200 })) as typeof fetch);
  assert.equal(await verifier.verify(token, "192.0.2.1"), "verified");

  const wrongAction = new TurnstileVerifier({
    secretKey: "secret",
    expectedHostname: "link.watermelonbackup.com",
    maximumConcurrent: 2,
    requestsPerMinute: 10,
  }, (async () => new Response(JSON.stringify({ success: true, action: "other" }), { status: 200 })) as typeof fetch);
  assert.equal(await wrongAction.verify(token, "192.0.2.1"), "rejected");
});

test("Turnstile verification has a non-queueing concurrent boundary", async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const verifier = new TurnstileVerifier({
    secretKey: "secret",
    expectedHostname: null,
    maximumConcurrent: 2,
    requestsPerMinute: 10,
  }, (async () => {
    calls += 1;
    await pending;
    return new Response(JSON.stringify({ success: false }), { status: 200 });
  }) as typeof fetch);

  const first = verifier.verify(token, "192.0.2.1");
  const second = verifier.verify(token, "192.0.2.2");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await verifier.verify(token, "192.0.2.3"), "busy");
  assert.equal(calls, 2);
  release?.();
  assert.deepEqual(await Promise.all([first, second]), ["rejected", "rejected"]);
});

test("Turnstile upstream and global-budget failures fail closed", async () => {
  let calls = 0;
  const verifier = new TurnstileVerifier({
    secretKey: "secret",
    expectedHostname: null,
    maximumConcurrent: 2,
    requestsPerMinute: 1,
  }, (async () => {
    calls += 1;
    return new Response("unavailable", { status: 503 });
  }) as typeof fetch);

  assert.equal(await verifier.verify(token, "192.0.2.1"), "unavailable");
  assert.equal(await verifier.verify(token, "192.0.2.2"), "busy");
  assert.equal(calls, 1);
  assert.equal(await verifier.verify("tiny", "192.0.2.3"), "rejected");
  assert.equal(calls, 1);
});

test("Turnstile service and secret errors are reported as unavailable", async () => {
  for (const code of ["internal-error", "missing-input-secret", "invalid-input-secret", "bad-request"]) {
    const verifier = new TurnstileVerifier({
      secretKey: "secret",
      expectedHostname: null,
      maximumConcurrent: 1,
      requestsPerMinute: 2,
    }, (async () => new Response(JSON.stringify({ success: false, "error-codes": [code] }), { status: 200 })) as typeof fetch);
    assert.equal(await verifier.verify(token, "192.0.2.1"), "unavailable", code);
  }

  for (const code of ["invalid-input-response", "timeout-or-duplicate"]) {
    const verifier = new TurnstileVerifier({
      secretKey: "secret",
      expectedHostname: null,
      maximumConcurrent: 1,
      requestsPerMinute: 2,
    }, (async () => new Response(JSON.stringify({ success: false, "error-codes": [code] }), { status: 200 })) as typeof fetch);
    assert.equal(await verifier.verify(token, "192.0.2.1"), "rejected", code);
  }
});
