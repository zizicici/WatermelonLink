import assert from "node:assert/strict";
import test from "node:test";
import {
  appendingBrowserNodeReceipt,
  BrowserNodeInUseError,
  BrowserNodeLease,
  parseBrowserNodeReceipts
} from "../../web/src/browser-node-receipts";

const scope = (byte: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");

test("browser node receipts preserve clean scopes across non-consecutive folders", () => {
  let stored: string | null = null;
  stored = appendingBrowserNodeReceipt(stored, scope(1));
  stored = appendingBrowserNodeReceipt(stored, scope(2));
  assert.deepEqual(parseBrowserNodeReceipts(stored), [scope(1), scope(2)]);
});

test("browser node receipts migrate the single-scope format and stay bounded", () => {
  let stored: string | null = scope(1);
  for (let index = 0; index < 20; index += 1) {
    stored = appendingBrowserNodeReceipt(stored, scope(index + 2));
  }
  const parsed = parseBrowserNodeReceipts(stored);
  assert.equal(parsed.length, 16);
  assert.equal(parsed.at(-1), scope(21));
});

test("browser node receipts reject non-canonical base64url values", () => {
  const canonical = scope(0);
  const nonCanonical = canonical.slice(0, -1) + "B";
  assert.deepEqual(parseBrowserNodeReceipts(JSON.stringify([canonical, nonCanonical])), [canonical]);
});

test("browser node lease fails immediately when another tab holds the lock", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let capturedOptions: LockOptions | undefined;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { locks: { request: async (_name: string, options: LockOptions, callback: (lock: null) => Promise<void>) => {
      capturedOptions = options;
      return callback(null);
    } } }
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  });

  try {
    await assert.rejects(
      BrowserNodeLease.acquire(new AbortController().signal, scope(1)),
      BrowserNodeInUseError
    );
    assert.equal(capturedOptions?.ifAvailable, true);
    assert.equal(capturedOptions?.mode, "exclusive");
    assert.equal("signal" in (capturedOptions ?? {}), false);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete (globalThis as { navigator?: Navigator }).navigator;
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test("browser node lease releases an acquired lock when cancellation wins the race", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const controller = new AbortController();
  let callbackCompleted = false;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { locks: { request: async (_name: string, options: LockOptions, callback: (lock: object) => Promise<void>) => {
      assert.equal(options.ifAvailable, true);
      assert.equal("signal" in options, false);
      controller.abort();
      await callback({});
      callbackCompleted = true;
    } } }
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  });

  try {
    await assert.rejects(BrowserNodeLease.acquire(controller.signal, scope(1)), { name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(callbackCompleted, true);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete (globalThis as { navigator?: Navigator }).navigator;
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
