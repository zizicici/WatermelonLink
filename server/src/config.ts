import { resolve } from "node:path";

export type LinkConfig = {
  host: string;
  port: number;
  publicOrigin: string;
  production: boolean;
  trustProxy: boolean;
  ticketSigningSecret: string;
  ticketTTLSeconds: number;
  roomTTLSeconds: number;
  maxRooms: number;
  maxConnectionsPerNetwork: number;
  maxUnpairedRoomsPerNetwork: number;
  reservedRoomsForNewNetworks: number;
  maxServerConnections: number;
  maxSignalMessages: number;
  maxSignalBytes: number;
  maxMessageBytes: number;
  ticketRequestsPerMinute: number;
  rawTicketRequestsPerMinute: number;
  websocketUpgradesPerMinute: number;
  websocketRawUpgradesGlobalPerMinute: number;
  websocketUpgradesGlobalPerMinute: number;
  turnstileRequestsPerMinute: number;
  turnstileMaximumConcurrent: number;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
  turnstileExpectedHostname: string | null;
  staticRoot: string;
  usageMetricsPath: string | null;
  usageMetricsRetentionDays: number;
};

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function boolean(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function normalizePublicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_ORIGIN must be an HTTP(S) origin");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_ORIGIN must be an HTTP(S) origin");
  }
  return url.origin;
}

export function loadConfig(): LinkConfig {
  const production = process.env.NODE_ENV === "production";
  const turnstileBypass = boolean("TURNSTILE_BYPASS", !production);
  const ticketSigningSecret = process.env.TICKET_SIGNING_SECRET ?? (production ? "" : "development-only-signing-secret-change-me");
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? null;
  const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY ?? null;
  const publicOrigin = normalizePublicOrigin(process.env.PUBLIC_ORIGIN ?? "http://localhost:4173");
  const maxRooms = integer("MAX_ROOMS", 2_000, 10, 100_000);
  const maxServerConnections = integer("MAX_SERVER_CONNECTIONS", maxRooms * 2 + 512, 512, 250_000);
  const websocketUpgradesPerMinute = integer("WEBSOCKET_UPGRADES_PER_MINUTE", 60, 4, 10_000);
  const websocketRawUpgradesGlobalPerMinute = integer("WEBSOCKET_RAW_UPGRADES_GLOBAL_PER_MINUTE", 12_000, 100, 1_000_000);

  if (ticketSigningSecret.length < 32) throw new Error("TICKET_SIGNING_SECRET must contain at least 32 characters");
  if (production && turnstileBypass) throw new Error("TURNSTILE_BYPASS cannot be enabled in production");
  if (!turnstileBypass && (!turnstileSiteKey || !turnstileSecretKey)) {
    throw new Error("Turnstile keys are required when TURNSTILE_BYPASS is false");
  }
  if (maxServerConnections < maxRooms * 2 + 128) {
    throw new Error("MAX_SERVER_CONNECTIONS must leave at least 128 connections beyond twice MAX_ROOMS");
  }
  if (websocketRawUpgradesGlobalPerMinute < websocketUpgradesPerMinute * 4 - 1) {
    throw new Error("WEBSOCKET_RAW_UPGRADES_GLOBAL_PER_MINUTE must be at least four times WEBSOCKET_UPGRADES_PER_MINUTE minus one");
  }

  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: integer("PORT", 4173, 1, 65_535),
    publicOrigin,
    production,
    trustProxy: boolean("TRUST_PROXY"),
    ticketSigningSecret,
    ticketTTLSeconds: integer("TICKET_TTL_SECONDS", 90, 90, 90),
    roomTTLSeconds: integer("ROOM_TTL_SECONDS", 240, 30, 900),
    maxRooms,
    maxConnectionsPerNetwork: integer("MAX_CONNECTIONS_PER_NETWORK", 12, 2, 1_000),
    maxUnpairedRoomsPerNetwork: integer("MAX_UNPAIRED_ROOMS_PER_NETWORK", 3, 1, 100),
    reservedRoomsForNewNetworks: integer(
      "RESERVED_ROOMS_FOR_NEW_NETWORKS",
      Math.min(500, Math.max(1, Math.floor(maxRooms / 20))),
      0,
      maxRooms - 1
    ),
    maxServerConnections,
    maxSignalMessages: integer("MAX_SIGNAL_MESSAGES", 128, 8, 1_024),
    maxSignalBytes: integer("MAX_SIGNAL_BYTES", 256 * 1024, 16 * 1024, 4 * 1024 * 1024),
    maxMessageBytes: integer("MAX_MESSAGE_BYTES", 24 * 1024, 1_024, 256 * 1024),
    ticketRequestsPerMinute: integer("TICKET_REQUESTS_PER_MINUTE", 10, 1, 1_000),
    rawTicketRequestsPerMinute: integer("RAW_TICKET_REQUESTS_PER_MINUTE", 60, 10, 10_000),
    websocketUpgradesPerMinute,
    websocketRawUpgradesGlobalPerMinute,
    websocketUpgradesGlobalPerMinute: integer("WEBSOCKET_UPGRADES_GLOBAL_PER_MINUTE", 6_000, 100, 1_000_000),
    turnstileRequestsPerMinute: integer("TURNSTILE_REQUESTS_PER_MINUTE", 600, 10, 100_000),
    turnstileMaximumConcurrent: integer("TURNSTILE_MAX_CONCURRENT", 32, 1, 1_000),
    turnstileEnabled: !turnstileBypass,
    turnstileSiteKey,
    turnstileSecretKey,
    turnstileExpectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME ?? (production ? "link.watermelonbackup.com" : null),
    staticRoot: resolve(process.cwd(), process.env.STATIC_ROOT ?? "dist/web"),
    usageMetricsPath: process.env.USAGE_METRICS_PATH?.trim() || null,
    usageMetricsRetentionDays: integer("USAGE_METRICS_RETENTION_DAYS", 400, 1, 400)
  };
}
