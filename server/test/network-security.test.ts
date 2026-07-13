import assert from "node:assert/strict";
import test from "node:test";
import {
  clientNetworkPrefix,
  isPlausibleTurnstileToken,
  normalizeClientAddress,
  resolveClientAddress,
} from "../src/network-security.js";

test("client addresses use canonical IPv4 and IPv6 /64 security keys", () => {
  assert.equal(normalizeClientAddress("::ffff:192.0.2.9"), "192.0.2.9");
  assert.equal(normalizeClientAddress("::ffff:c000:0209"), "192.0.2.9");
  assert.equal(clientNetworkPrefix("192.0.2.9"), "v4:192.0.2.9");
  assert.equal(clientNetworkPrefix("::ffff:192.0.2.9"), "v4:192.0.2.9");
  assert.equal(clientNetworkPrefix("::ffff:c000:0209"), "v4:192.0.2.9");
  assert.equal(
    clientNetworkPrefix("2001:db8:1:2::1"),
    clientNetworkPrefix("2001:0db8:0001:0002:ffff::9")
  );
  assert.notEqual(
    clientNetworkPrefix("2001:db8:1:2::1"),
    clientNetworkPrefix("2001:db8:1:3::1")
  );
  assert.equal(clientNetworkPrefix("not-an-ip"), "invalid");
});

test("forwarded addresses are trusted only from a loopback proxy", () => {
  assert.equal(resolveClientAddress("127.0.0.1", "2001:db8::1", true), "2001:db8::1");
  assert.equal(resolveClientAddress("::1", "192.0.2.5", true), "192.0.2.5");
  assert.equal(resolveClientAddress("::ffff:7f00:1", "192.0.2.5", true), "192.0.2.5");
  assert.equal(resolveClientAddress("198.51.100.8", "192.0.2.5", true), "198.51.100.8");
  assert.equal(resolveClientAddress("127.0.0.1", "192.0.2.5, 198.51.100.8", true), "127.0.0.1");
  assert.equal(resolveClientAddress("127.0.0.1", ["192.0.2.5"], true), "127.0.0.1");
  assert.equal(resolveClientAddress("127.0.0.1", "192.0.2.5", false), "127.0.0.1");
});

test("Turnstile token preflight rejects tiny, oversized, whitespace, and control payloads", () => {
  assert.equal(isPlausibleTurnstileToken("a".repeat(20)), true);
  assert.equal(isPlausibleTurnstileToken("a".repeat(19)), false);
  assert.equal(isPlausibleTurnstileToken("a".repeat(2_049)), false);
  assert.equal(isPlausibleTurnstileToken(`a${"b".repeat(19)}\n`), false);
  assert.equal(isPlausibleTurnstileToken(`a${"b".repeat(19)} `), false);
  assert.equal(isPlausibleTurnstileToken("😀".repeat(512)), true);
  assert.equal(isPlausibleTurnstileToken("😀".repeat(513)), false);
});
