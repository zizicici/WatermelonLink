import { isIP } from "node:net";

export function normalizeClientAddress(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (isIP(value) === 4) return canonicalIPv4(value);
  if (isIP(value) !== 6) return null;
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    const normalized = hostname.slice(1, -1).toLowerCase();
    const fields = expandIPv6(normalized);
    if (fields && fields.slice(0, 5).every((field) => field === 0) && fields[5] === 0xffff) {
      return [fields[6]! >> 8, fields[6]! & 0xff, fields[7]! >> 8, fields[7]! & 0xff].join(".");
    }
    return normalized;
  } catch {
    return null;
  }
}

export function clientNetworkPrefix(address: string): string {
  const normalized = normalizeClientAddress(address);
  if (!normalized) return "invalid";
  if (isIP(normalized) === 4) return `v4:${normalized}`;
  const fields = expandIPv6(normalized);
  if (!fields) return "invalid";
  return `v6:${fields.slice(0, 4).map((field) => field.toString(16).padStart(4, "0")).join(":")}`;
}

export function resolveClientAddress(
  remoteAddress: string | undefined,
  forwardedAddress: string | string[] | undefined,
  trustProxy: boolean
): string {
  const remote = normalizeClientAddress(remoteAddress) ?? "unknown";
  if (!trustProxy || !isLoopback(remote) || typeof forwardedAddress !== "string") return remote;
  return normalizeClientAddress(forwardedAddress) ?? remote;
}

export function isPlausibleTurnstileToken(token: string): boolean {
  const bytes = Buffer.byteLength(token, "utf8");
  return bytes >= 20 && bytes <= 2_048 && !/[\s\0-\x1f\x7f]/u.test(token);
}

function canonicalIPv4(address: string): string {
  return address.split(".").map((field) => String(Number(field))).join(".");
}

function isLoopback(address: string): boolean {
  return address === "::1" || address.startsWith("127.");
}

function expandIPv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const rawFields = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  const fields = rawFields.map((field) => Number.parseInt(field, 16));
  return fields.length === 8 && fields.every((field) => Number.isInteger(field) && field >= 0 && field <= 0xffff)
    ? fields
    : null;
}
