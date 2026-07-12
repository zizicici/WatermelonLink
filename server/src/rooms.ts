import type { WebSocket } from "ws";
import type { TicketClaims } from "./tickets.js";

export type PeerRole = "browser" | "phone";

type Peer = { socket: WebSocket; role: PeerRole; ip: string };
type Room = {
  claims: TicketClaims;
  peers: Map<PeerRole, Peer>;
  paired: boolean;
  expiresAt: number;
  signalMessages: number;
  signalBytes: number;
};

type RoomLimits = {
  maxRooms: number;
  maxConnectionsPerIP: number;
  maxSignalMessages: number;
  maxSignalBytes: number;
  roomTTLSeconds: number;
};

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly consumedSessions = new Map<string, number>();
  private readonly connectionsByIP = new Map<string, number>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly limits: RoomLimits) {
    this.sweeper = setInterval(() => this.sweep(), 15_000);
    this.sweeper.unref();
  }

  attach(socket: WebSocket, claims: TicketClaims, role: PeerRole, ip: string): boolean {
    const consumedUntil = this.consumedSessions.get(claims.sessionID);
    if (consumedUntil && consumedUntil > Date.now()) {
      socket.close(4409, "ticket_already_used");
      return false;
    }
    if ((this.connectionsByIP.get(ip) ?? 0) >= this.limits.maxConnectionsPerIP) {
      socket.close(4429, "too_many_connections");
      return false;
    }

    let room = this.rooms.get(claims.sessionID);
    if (!room) {
      if (this.rooms.size >= this.limits.maxRooms) {
        socket.close(4503, "capacity_reached");
        return false;
      }
      room = {
        claims,
        peers: new Map(),
        paired: false,
        expiresAt: Math.min(claims.expiresAt * 1_000, Date.now() + this.limits.roomTTLSeconds * 1_000),
        signalMessages: 0,
        signalBytes: 0
      };
      this.rooms.set(claims.sessionID, room);
    }

    if (room.expiresAt <= Date.now()) {
      this.closeRoom(room, 4408, "room_expired", true);
      socket.close(4409, "room_unavailable");
      return false;
    }
    if (room.paired || room.claims.capabilityHash !== claims.capabilityHash || room.peers.has(role)) {
      socket.close(4409, "room_unavailable");
      return false;
    }

    const peer: Peer = { socket, role, ip };
    room.peers.set(role, peer);
    this.connectionsByIP.set(ip, (this.connectionsByIP.get(ip) ?? 0) + 1);
    if (room.peers.size === 2) {
      room.paired = true;
      this.consume(room.claims.sessionID, room.claims.expiresAt * 1_000);
    }
    this.send(socket, { kind: "control", event: room.peers.size === 2 ? "peer_joined" : "waiting" });
    if (room.peers.size === 2) this.broadcast(room, { kind: "control", event: "peer_joined" }, role);

    socket.on("message", (data, isBinary) => this.handleMessage(room!, peer, data, isBinary));
    socket.on("close", () => this.detach(room!, peer));
    socket.on("error", () => socket.close());
    return true;
  }

  close(): void {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) this.closeRoom(room, 1001, "server_shutdown", false);
  }

  stats(): { rooms: number; connections: number } {
    let connections = 0;
    for (const room of this.rooms.values()) connections += room.peers.size;
    return { rooms: this.rooms.size, connections };
  }

  private handleMessage(room: Room, peer: Peer, data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): void {
    if (isBinary || !room.peers.has(peer.role)) return this.closeRoom(room, 4400, "invalid_message", true);
    const raw = Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.from(data as ArrayBuffer).toString("utf8");
    room.signalMessages += 1;
    room.signalBytes += Buffer.byteLength(raw);
    if (room.signalMessages > this.limits.maxSignalMessages || room.signalBytes > this.limits.maxSignalBytes) {
      return this.closeRoom(room, 4408, "signal_limit_reached", true);
    }

    let message: { kind?: string; payload?: unknown };
    try { message = JSON.parse(raw) as typeof message; } catch { return this.closeRoom(room, 4400, "invalid_json", true); }
    if (message.kind === "relay" && typeof message.payload === "string") {
      if (message.payload.length > 20_000) return this.closeRoom(room, 4400, "payload_too_large", true);
      const otherRole = peer.role === "browser" ? "phone" : "browser";
      const other = room.peers.get(otherRole);
      if (other) this.send(other.socket, { kind: "relay", payload: message.payload });
      return;
    }
    if (message.kind === "complete") {
      if (peer.role !== "browser" || room.peers.size !== 2) {
        return this.closeRoom(room, 4400, "invalid_complete", true);
      }
      this.broadcast(room, { kind: "control", event: "signaling_complete" });
      return this.closeRoom(room, 1000, "signaling_complete", true);
    }
    if (message.kind === "cancel") return this.closeRoom(room, 1000, "cancelled", true);
    this.closeRoom(room, 4400, "unsupported_message", true);
  }

  private detach(room: Room, peer: Peer): void {
    if (room.peers.get(peer.role)?.socket !== peer.socket) return;
    room.peers.delete(peer.role);
    const next = (this.connectionsByIP.get(peer.ip) ?? 1) - 1;
    if (next <= 0) this.connectionsByIP.delete(peer.ip);
    else this.connectionsByIP.set(peer.ip, next);
    if (this.rooms.get(room.claims.sessionID) !== room) return;
    if (room.paired) return this.closeRoom(room, 1000, "peer_left", true);
    if (room.peers.size === 0) this.rooms.delete(room.claims.sessionID);
    else this.broadcast(room, { kind: "control", event: "peer_left" });
  }

  private closeRoom(room: Room, code: number, reason: string, consume: boolean): void {
    this.rooms.delete(room.claims.sessionID);
    if (consume) this.consume(room.claims.sessionID, room.claims.expiresAt * 1_000);
    for (const peer of room.peers.values()) peer.socket.close(code, reason);
  }

  private sweep(now = Date.now()): void {
    for (const room of this.rooms.values()) {
      if (room.expiresAt <= now) this.closeRoom(room, 4408, "room_expired", true);
      else for (const peer of room.peers.values()) if (peer.socket.readyState === peer.socket.OPEN) peer.socket.ping();
    }
    for (const [sessionID, expiresAt] of this.consumedSessions) if (expiresAt <= now) this.consumedSessions.delete(sessionID);
  }

  private consume(sessionID: string, expiresAt: number): void {
    const maximum = this.limits.maxRooms * 4;
    if (this.consumedSessions.size >= maximum) {
      const oldest = this.consumedSessions.keys().next().value as string | undefined;
      if (oldest) this.consumedSessions.delete(oldest);
    }
    this.consumedSessions.set(sessionID, expiresAt);
  }

  private broadcast(room: Room, message: unknown, except?: PeerRole): void {
    for (const peer of room.peers.values()) if (peer.role !== except) this.send(peer.socket, message);
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
