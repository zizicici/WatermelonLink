import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TicketClaims = {
  v: 1;
  sessionID: string;
  capabilityHash: string;
  issuedAt: number;
  expiresAt: number;
  maxPeers: 2;
};

const version = 1;
const payloadBytes = 57;
const signatureBytes = 16;
const ticketBytes = payloadBytes + signatureBytes;
const hashPattern = /^[A-Za-z0-9_-]{43}$/;

export class TicketService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number
  ) {}

  issue(capabilityHash: string, now = Date.now()): { ticket: string; claims: TicketClaims } {
    if (!hashPattern.test(capabilityHash)) throw new Error("invalid_capability_hash");
    const capability = Buffer.from(capabilityHash, "base64url");
    if (capability.byteLength !== 32 || capability.toString("base64url") !== capabilityHash) throw new Error("invalid_capability_hash");

    const session = randomBytes(16);
    const issuedAt = Math.floor(now / 1_000);
    const expiresAt = issuedAt + this.ttlSeconds;
    const payload = Buffer.allocUnsafe(payloadBytes);
    payload.writeUInt8(version, 0);
    session.copy(payload, 1);
    capability.copy(payload, 17);
    payload.writeUInt32BE(issuedAt, 49);
    payload.writeUInt32BE(expiresAt, 53);
    const signature = this.sign(payload);
    const claims = this.claims(session, capability, issuedAt, expiresAt);
    return { ticket: Buffer.concat([payload, signature]).toString("base64url"), claims };
  }

  verify(ticket: string, now = Date.now()): TicketClaims | null {
    let raw: Buffer;
    try { raw = Buffer.from(ticket, "base64url"); } catch { return null; }
    if (raw.byteLength !== ticketBytes || raw.toString("base64url") !== ticket) return null;
    const payload = raw.subarray(0, payloadBytes);
    const signature = raw.subarray(payloadBytes);
    const expected = this.sign(payload);
    if (!timingSafeEqual(expected, signature) || payload.readUInt8(0) !== version) return null;

    const session = payload.subarray(1, 17);
    const capability = payload.subarray(17, 49);
    const issuedAt = payload.readUInt32BE(49);
    const expiresAt = payload.readUInt32BE(53);
    const current = Math.floor(now / 1_000);
    if (expiresAt <= current || issuedAt > current + 30 || expiresAt - issuedAt !== this.ttlSeconds) return null;
    return this.claims(session, capability, issuedAt, expiresAt);
  }

  private claims(session: Buffer, capability: Buffer, issuedAt: number, expiresAt: number): TicketClaims {
    return {
      v: 1,
      sessionID: session.toString("base64url"),
      capabilityHash: capability.toString("base64url"),
      issuedAt,
      expiresAt,
      maxPeers: 2
    };
  }

  private sign(payload: Buffer): Buffer {
    return createHmac("sha256", this.secret).update(payload).digest().subarray(0, signatureBytes);
  }
}
