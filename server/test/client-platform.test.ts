import assert from "node:assert/strict";
import test from "node:test";
import { classifyClientPlatform } from "../src/client-platform.js";

test("client platform prefers low-entropy Chromium hints", () => {
  assert.deepEqual(classifyClientPlatform({
    "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="140", "Microsoft Edge";v="140"',
    "sec-ch-ua-platform": '"Windows"',
    "user-agent": "Mozilla/5.0"
  }), { browser: "Edge", operatingSystem: "Windows" });

  assert.deepEqual(classifyClientPlatform({
    "sec-ch-ua": '"Chromium";v="140", "Google Chrome";v="140"',
    "sec-ch-ua-platform": '"macOS"',
    "user-agent": "Mozilla/5.0"
  }), { browser: "Chrome", operatingSystem: "macOS" });
});

test("client platform falls back to coarse User-Agent families", () => {
  assert.deepEqual(classifyClientPlatform({
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.5 Safari/605.1.15"
  }), { browser: "Safari", operatingSystem: "macOS" });

  assert.deepEqual(classifyClientPlatform({
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0"
  }), { browser: "Firefox", operatingSystem: "Linux" });

  assert.deepEqual(classifyClientPlatform({
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Version/18.5 Mobile/15E148 Safari/604.1"
  }), { browser: "Safari", operatingSystem: "iOS" });

  assert.deepEqual(classifyClientPlatform({}), { browser: "Other", operatingSystem: "Other" });
});

test("client platform does not count other Chromium browsers as Google Chrome", () => {
  assert.deepEqual(classifyClientPlatform({
    "sec-ch-ua": '"Chromium";v="140", "Opera";v="121"',
    "sec-ch-ua-platform": '"Windows"',
    "user-agent": "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 OPR/121.0.0.0"
  }), { browser: "Chromium", operatingSystem: "Windows" });
});
