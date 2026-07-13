import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticationConfirmationMAC,
  authenticationMAC,
  capabilityHash,
  fromBase64URL,
  SignalCipher,
  toBase64URL
} from "../../web/src/crypto";

test("protocol v1 authentication matches the iOS vector", async () => {
  const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
  const mac = await authenticationMAC(
    secret,
    "ICEiIyQlJicoKSorLC0uLw",
    "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3"
  );
  assert.equal(mac, "UHFtYOO3ymrcr0ChHYNh_NhsfRp6t1SJfD7fsyb6udM");
  const confirmation = await authenticationConfirmationMAC(
    secret,
    "ICEiIyQlJicoKSorLC0uLw",
    "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3",
    "Backup",
    "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8",
    [],
    131072
  );
  assert.equal(confirmation, "-O9Ptycj4bT1JrxBgci510Fb0ST5B2R1e2VkQsv3o7w");
  assert.equal(await capabilityHash(secret), "Aw2Gef5C8Tf67IfUOMud2f7IL0pGNUHBmt9onxpuHeo");
});

test("protocol v1 signaling uses directional keys and strict framing", async () => {
  const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
  const browser = await SignalCipher.create(secret, "session", "browser");
  const phone = await SignalCipher.create(secret, "session", "phone");
  const encrypted = await browser.encrypt({ type: "offer" });
  assert.deepEqual(await phone.decrypt(encrypted), { type: "offer" });
  await assert.rejects(phone.decrypt(`${encrypted}.extra`), /Malformed/);
  await assert.rejects(browser.decrypt(encrypted), { name: "OperationError" });
  const [iv, encodedCiphertext] = encrypted.split(".");
  const ciphertext = fromBase64URL(encodedCiphertext!);
  ciphertext[0] ^= 0x01;
  await assert.rejects(phone.decrypt(`${iv}.${toBase64URL(ciphertext)}`), { name: "OperationError" });
});

test("protocol v1 signaling matches the fixed iOS AES-GCM vector", async () => {
  const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
  const sessionID = "ICEiIyQlJicoKSorLC0uLw";
  const browser = await SignalCipher.create(secret, sessionID, "browser");
  const phone = await SignalCipher.create(secret, sessionID, "phone");
  const encrypted = await browser.encrypt(
    { type: "offer" },
    Uint8Array.from({ length: 12 }, (_, index) => index)
  );
  assert.equal(encrypted, "AAECAwQFBgcICQoL.8y3h-aBy4OOXSdgN2xeSOPf6EDkyLutWaWQ8rDo3wSk");
  assert.deepEqual(await phone.decrypt(encrypted), { type: "offer" });
});
