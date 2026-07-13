import type { WebSocket } from "ws";
import type { TicketClaims } from "./tickets.js";

export type PeerRole = "browser" | "phone";

type Peer = { socket: WebSocket; role: PeerRole; network: string; controlFrames: number };
type Room = {
  claims: TicketClaims;
  peers: Map<PeerRole, Peer>;
  paired: boolean;
  expiresAt: number;
  signalMessages: number;
  signalBytes: number;
  creationNetwork: string | null;
  unpairedReservationNetwork: string | null;
};

type RoomLimits = {
  maxRooms: number;
  maxConnectionsPerNetwork: number;
  maxUnpairedRoomsPerNetwork: number;
  reservedRoomsForNewNetworks: number;
  maxSignalMessages: number;
  maxSignalBytes: number;
  roomTTLSeconds: number;
};

const maximumControlFramesPerPeer = 16;

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly consumedSessions = new Map<string, number>();
  private readonly connectionsByNetwork = new Map<string, number>();
  private readonly unpairedRoomsByNetwork = new Map<string, number>();
  private readonly roomsByCreationNetwork = new Map<string, number>();
  private activeConnections = 0;
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly limits: RoomLimits) {
    this.sweeper = setInterval(() => this.sweep(), 15_000);
    this.sweeper.unref();
  }

  attach(socket: WebSocket, claims: TicketClaims, role: PeerRole, network: string): boolean {
    const now = Date.now();
    let consumedUntil = this.consumedSessions.get(claims.sessionID);
    if (consumedUntil && consumedUntil <= now) {
      this.consumedSessions.delete(claims.sessionID);
      consumedUntil = undefined;
    }
    if (consumedUntil && consumedUntil > now) {
      this.reject(socket, 4409, "ticket_consumed");
      return false;
    }
    if (this.activeConnections >= this.limits.maxRooms * 2) {
      this.reject(socket, 4503, "capacity_reached");
      return false;
    }
    if ((this.connectionsByNetwork.get(network) ?? 0) >= this.limits.maxConnectionsPerNetwork) {
      this.reject(socket, 4429, "network_limit_reached");
      return false;
    }

    let room = this.rooms.get(claims.sessionID);
    if (!room) {
      const maximumConsumedSessions = this.limits.maxRooms * 4;
      if (this.rooms.size >= this.limits.maxRooms || this.consumedSessions.size >= maximumConsumedSessions) {
        this.reject(socket, 4503, "capacity_reached");
        return false;
      }
      const unpairedNetworkRooms = this.unpairedRoomsByNetwork.get(network) ?? 0;
      const activeNetworkRooms = this.roomsByCreationNetwork.get(network) ?? 0;
      const reservedBoundary = this.limits.maxRooms - this.limits.reservedRoomsForNewNetworks;
      if (unpairedNetworkRooms >= this.limits.maxUnpairedRoomsPerNetwork ||
          (this.rooms.size >= reservedBoundary && activeNetworkRooms > 0)) {
        this.reject(socket, 4429, "network_room_limit_reached");
        return false;
      }
      room = {
        claims,
        peers: new Map(),
        paired: false,
        expiresAt: Math.min(claims.expiresAt * 1_000, Date.now() + this.limits.roomTTLSeconds * 1_000),
        signalMessages: 0,
        signalBytes: 0,
        creationNetwork: network,
        unpairedReservationNetwork: network
      };
      this.rooms.set(claims.sessionID, room);
      this.unpairedRoomsByNetwork.set(network, unpairedNetworkRooms + 1);
      this.roomsByCreationNetwork.set(network, activeNetworkRooms + 1);
    }

    if (room.expiresAt <= Date.now()) {
      this.closeRoom(room, 4408, "room_expired", true);
      this.reject(socket, 4408, "room_expired");
      return false;
    }
    if (room.paired || room.claims.capabilityHash !== claims.capabilityHash || room.peers.has(role)) {
      this.reject(socket, 4409, "ticket_consumed");
      return false;
    }

    const peer: Peer = { socket, role, network, controlFrames: 0 };
    room.peers.set(role, peer);
    this.connectionsByNetwork.set(network, (this.connectionsByNetwork.get(network) ?? 0) + 1);
    this.activeConnections += 1;
    socket.on("message", (data, isBinary) => this.handleMessage(room!, peer, data, isBinary));
    socket.on("ping", (data) => this.handleControlFrame(room!, peer, "ping", data));
    socket.on("pong", (data) => this.handleControlFrame(room!, peer, "pong", data));
    socket.on("close", () => this.detach(room!, peer));
    socket.on("error", () => {
      this.detach(room!, peer);
      this.safeTerminate(socket);
    });
    if (room.peers.size === 2) {
      room.paired = true;
      this.releaseUnpairedReservation(room);
      this.consume(room.claims.sessionID, room.claims.expiresAt * 1_000);
    }
    if (!this.send(room, socket, { kind: "control", event: room.peers.size === 2 ? "peer_joined" : "waiting" })) {
      this.closeRoom(room, 1000, "send_failed", true, true);
      return false;
    }
    if (room.peers.size === 2) this.broadcast(room, { kind: "control", event: "peer_joined" }, role);
    return true;
  }

  close(): void {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) this.closeRoom(room, 1001, "server_shutdown", false);
  }

  stats(): { rooms: number; connections: number } {
    return { rooms: this.rooms.size, connections: this.activeConnections };
  }

  private handleMessage(room: Room, peer: Peer, data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): void {
    if (isBinary || !room.peers.has(peer.role)) return this.closeRoom(room, 4400, "invalid_message", true);
    const raw = Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.from(data as ArrayBuffer).toString("utf8");
    room.signalMessages += 1;
    room.signalBytes += Buffer.byteLength(raw);
    if (room.signalMessages > this.limits.maxSignalMessages || room.signalBytes > this.limits.maxSignalBytes) {
      return this.closeRoom(room, 4408, "signal_limit_reached", true, true);
    }

    let parsed: unknown;
    try { parsed = JSON.parse(raw) as unknown; } catch { return this.closeRoom(room, 4400, "invalid_json", true); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return this.closeRoom(room, 4400, "invalid_message", true);
    }
    const message = parsed as { kind?: string; payload?: unknown };
    if (message.kind === "relay" && typeof message.payload === "string") {
      if (message.payload.length > 20_000) return this.closeRoom(room, 4400, "payload_too_large", true);
      const otherRole = peer.role === "browser" ? "phone" : "browser";
      const other = room.peers.get(otherRole);
      if (other) {
        const outbound = JSON.stringify({ kind: "relay", payload: message.payload });
        const maximumOutboundBufferedBytes = Math.min(this.limits.maxSignalBytes, 64 * 1024);
        if (other.socket.bufferedAmount + Buffer.byteLength(outbound) > maximumOutboundBufferedBytes) {
          return this.closeRoom(room, 4408, "outbound_backpressure", true, true);
        }
        if (!this.sendRaw(room, other.socket, outbound)) {
          return this.closeRoom(room, 1000, "send_failed", true, true);
        }
      }
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

  private handleControlFrame(room: Room, peer: Peer, kind: "ping" | "pong", data: Buffer): void {
    if (room.peers.get(peer.role)?.socket !== peer.socket) return;
    peer.controlFrames += 1;
    if (peer.controlFrames > maximumControlFramesPerPeer) {
      this.closeRoom(room, 4408, "control_frame_limit_reached", true, true);
      return;
    }
    if (kind === "ping") this.safePong(room, peer.socket, data);
  }

  private detach(room: Room, peer: Peer): void {
    if (!this.releasePeer(room, peer)) return;
    if (this.rooms.get(room.claims.sessionID) !== room) return;
    if (room.paired) return this.closeRoom(room, 1000, "peer_left", true);
    if (room.peers.size === 0) {
      this.rooms.delete(room.claims.sessionID);
      this.releaseUnpairedReservation(room);
      this.releaseCreationReservation(room);
    }
    else this.broadcast(room, { kind: "control", event: "peer_left" });
  }

  private closeRoom(room: Room, code: number, reason: string, consume: boolean, terminate = false): void {
    const current = this.rooms.get(room.claims.sessionID) === room;
    if (!current && room.peers.size === 0) return;
    if (current) this.rooms.delete(room.claims.sessionID);
    this.releaseUnpairedReservation(room);
    this.releaseCreationReservation(room);
    if (consume) this.consume(room.claims.sessionID, room.claims.expiresAt * 1_000);
    for (const peer of [...room.peers.values()]) {
      this.releasePeer(room, peer);
      if (terminate) this.safeTerminate(peer.socket);
      else this.safeClose(peer.socket, code, reason);
    }
  }

  private sweep(now = Date.now()): void {
    for (const room of this.rooms.values()) {
      if (room.expiresAt <= now) this.closeRoom(room, 4408, "room_expired", true);
      else for (const peer of room.peers.values()) this.safePing(room, peer.socket);
    }
    for (const [sessionID, expiresAt] of this.consumedSessions) if (expiresAt <= now) this.consumedSessions.delete(sessionID);
  }

  private consume(sessionID: string, expiresAt: number): void {
    this.consumedSessions.set(sessionID, expiresAt);
  }

  private broadcast(room: Room, message: unknown, except?: PeerRole): void {
    for (const peer of [...room.peers.values()]) {
      if (peer.role !== except && !this.send(room, peer.socket, message)) {
        this.closeRoom(room, 1000, "send_failed", true, true);
        return;
      }
    }
  }

  private send(room: Room, socket: WebSocket, message: unknown): boolean {
    return this.sendRaw(room, socket, JSON.stringify(message));
  }

  private sendRaw(room: Room, socket: WebSocket, message: string): boolean {
    if (socket.readyState !== socket.OPEN) return false;
    try {
      socket.send(message, (error) => {
        if (error) this.closeRoom(room, 1000, "send_failed", true, true);
      });
      return true;
    } catch {
      return false;
    }
  }

  private safePing(room: Room, socket: WebSocket): void {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount >= this.maximumOutboundBufferedBytes()) {
      this.closeRoom(room, 4408, "outbound_backpressure", true, true);
      return;
    }
    try { socket.ping(); } catch { this.closeRoom(room, 1000, "ping_failed", true, true); }
  }

  private safePong(room: Room, socket: WebSocket, data: Buffer): void {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount + data.byteLength + 2 > this.maximumOutboundBufferedBytes()) {
      this.closeRoom(room, 4408, "outbound_backpressure", true, true);
      return;
    }
    try {
      socket.pong(data, false, (error) => {
        if (error) this.closeRoom(room, 1000, "pong_failed", true, true);
      });
    } catch {
      this.closeRoom(room, 1000, "pong_failed", true, true);
    }
  }

  private maximumOutboundBufferedBytes(): number {
    return Math.min(this.limits.maxSignalBytes, 64 * 1024);
  }

  private safeClose(socket: WebSocket, code: number, reason: string): void {
    try { socket.close(code, reason); } catch { this.safeTerminate(socket); }
  }

  private safeTerminate(socket: WebSocket): void {
    try { socket.terminate(); } catch { /* Resource accounting is already released. */ }
  }

  private reject(socket: WebSocket, code: number, reason: string): void {
    this.safeClose(socket, code, reason);
    const timer = setTimeout(() => {
      if (socket.readyState !== socket.CLOSED) this.safeTerminate(socket);
    }, 250);
    timer.unref();
  }

  private releasePeer(room: Room, peer: Peer): boolean {
    if (room.peers.get(peer.role)?.socket !== peer.socket) return false;
    room.peers.delete(peer.role);
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    const next = (this.connectionsByNetwork.get(peer.network) ?? 1) - 1;
    if (next <= 0) this.connectionsByNetwork.delete(peer.network);
    else this.connectionsByNetwork.set(peer.network, next);
    return true;
  }

  private releaseUnpairedReservation(room: Room): void {
    const network = room.unpairedReservationNetwork;
    if (!network) return;
    room.unpairedReservationNetwork = null;
    const next = (this.unpairedRoomsByNetwork.get(network) ?? 1) - 1;
    if (next <= 0) this.unpairedRoomsByNetwork.delete(network);
    else this.unpairedRoomsByNetwork.set(network, next);
  }

  private releaseCreationReservation(room: Room): void {
    const network = room.creationNetwork;
    if (!network) return;
    room.creationNetwork = null;
    const next = (this.roomsByCreationNetwork.get(network) ?? 1) - 1;
    if (next <= 0) this.roomsByCreationNetwork.delete(network);
    else this.roomsByCreationNetwork.set(network, next);
  }

}
