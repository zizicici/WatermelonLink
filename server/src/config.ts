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
  maxConnectionsPerIP: number;
  maxSignalMessages: number;
  maxSignalBytes: number;
  maxMessageBytes: number;
  ticketRequestsPerMinute: number;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
  turnstileExpectedHostname: string | null;
  staticRoot: string;
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

export function loadConfig(): LinkConfig {
  const production = process.env.NODE_ENV === "production";
  const turnstileBypass = boolean("TURNSTILE_BYPASS", !production);
  const ticketSigningSecret = process.env.TICKET_SIGNING_SECRET ?? (production ? "" : "development-only-signing-secret-change-me");
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? null;
  const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY ?? null;

  if (ticketSigningSecret.length < 32) throw new Error("TICKET_SIGNING_SECRET must contain at least 32 characters");
  if (production && turnstileBypass) throw new Error("TURNSTILE_BYPASS cannot be enabled in production");
  if (!turnstileBypass && (!turnstileSiteKey || !turnstileSecretKey)) {
    throw new Error("Turnstile keys are required when TURNSTILE_BYPASS is false");
  }

  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: integer("PORT", 4173, 1, 65_535),
    publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://localhost:4173",
    production,
    trustProxy: boolean("TRUST_PROXY"),
    ticketSigningSecret,
    ticketTTLSeconds: integer("TICKET_TTL_SECONDS", 180, 30, 600),
    roomTTLSeconds: integer("ROOM_TTL_SECONDS", 240, 30, 900),
    maxRooms: integer("MAX_ROOMS", 2_000, 10, 100_000),
    maxConnectionsPerIP: integer("MAX_CONNECTIONS_PER_IP", 12, 1, 100),
    maxSignalMessages: integer("MAX_SIGNAL_MESSAGES", 128, 8, 1_024),
    maxSignalBytes: integer("MAX_SIGNAL_BYTES", 256 * 1024, 16 * 1024, 4 * 1024 * 1024),
    maxMessageBytes: integer("MAX_MESSAGE_BYTES", 24 * 1024, 1_024, 256 * 1024),
    ticketRequestsPerMinute: integer("TICKET_REQUESTS_PER_MINUTE", 10, 1, 1_000),
    turnstileEnabled: !turnstileBypass,
    turnstileSiteKey,
    turnstileSecretKey,
    turnstileExpectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME ?? (production ? "link.watermelonbackup.com" : null),
    staticRoot: resolve(process.cwd(), process.env.STATIC_ROOT ?? "dist/web")
  };
}
