import assert from "node:assert/strict";
import test from "node:test";
import { queryLocalNetworkPermission } from "../../web/src/browser-preflight.ts";

test("local network permission uses the current descriptor", async () => {
  const names: string[] = [];
  const state = await queryLocalNetworkPermission(async (descriptor) => {
    names.push(String(descriptor.name));
    return { state: "denied" } as PermissionStatus;
  });

  assert.equal(state, "denied");
  assert.deepEqual(names, ["local-network"]);
});

test("local network permission falls back to the legacy descriptor", async () => {
  const names: string[] = [];
  const state = await queryLocalNetworkPermission(async (descriptor) => {
    names.push(String(descriptor.name));
    if (names.length === 1) throw new TypeError("unsupported permission");
    return { state: "granted" } as PermissionStatus;
  });

  assert.equal(state, "granted");
  assert.deepEqual(names, ["local-network", "local-network-access"]);
});

test("missing permission API remains detectable by the WebRTC probe", async () => {
  assert.equal(await queryLocalNetworkPermission(), null);
});
