import assert from "node:assert/strict";
import test from "node:test";
import { TicketService } from "../src/tickets.js";

const capabilityHash = Buffer.alloc(32, 7).toString("base64url");

test("ticket round-trips and preserves the capability commitment", () => {
  const service = new TicketService("a".repeat(32), 180);
  const issued = service.issue(capabilityHash, 1_000_000);
  assert.equal(issued.ticket.length, 98);
  const verified = service.verify(issued.ticket, 1_001_000);
  assert.equal(verified?.sessionID, issued.claims.sessionID);
  assert.equal(verified?.capabilityHash, capabilityHash);
  assert.equal(verified?.maxPeers, 2);
});

test("ticket rejects tampering and expiry", () => {
  const service = new TicketService("a".repeat(32), 180);
  const issued = service.issue(capabilityHash, 1_000_000);
  assert.equal(service.verify(`${issued.ticket}x`, 1_001_000), null);

  const changedBytes = Buffer.from(issued.ticket, "base64url");
  changedBytes[10] ^= 1;
  const sameLengthTampering = changedBytes.toString("base64url");
  assert.equal(sameLengthTampering.length, issued.ticket.length);
  assert.equal(service.verify(sameLengthTampering, 1_001_000), null);

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastIndex = alphabet.indexOf(issued.ticket.at(-1)!);
  assert.equal(lastIndex % 16, 0);
  const nonCanonical = `${issued.ticket.slice(0, -1)}${alphabet[lastIndex + 1]}`;
  assert.deepEqual(Buffer.from(nonCanonical, "base64url"), Buffer.from(issued.ticket, "base64url"));
  assert.equal(service.verify(nonCanonical, 1_001_000), null);

  assert.equal(service.verify(issued.ticket, 1_180_000), null);
});

test("ticket rejects malformed capability hashes", () => {
  const service = new TicketService("a".repeat(32), 180);
  assert.throws(() => service.issue("not-a-hash"), /invalid_capability_hash/);
});

test("outstanding tickets are invalid after a server restart", () => {
  const first = new TicketService("a".repeat(32), 180, Buffer.alloc(32, 1));
  const restarted = new TicketService("a".repeat(32), 180, Buffer.alloc(32, 2));
  const issued = first.issue(capabilityHash, 1_000_000);
  assert.equal(restarted.verify(issued.ticket, 1_001_000), null);
});
