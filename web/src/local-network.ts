export function allowsLocalICECandidate(candidate: string): boolean {
  const fields = candidate.trim().split(/\s+/);
  if (fields.length < 8 || fields[6]?.toLowerCase() !== "typ" || fields[7]?.toLowerCase() !== "host") return false;
  return isLocalAddress(fields[4] ?? "");
}

export function filterLocalICECandidates(sdp: string): string {
  return sdp
    .split("\n")
    .filter((line) => {
      const normalized = line.trim();
      return !normalized.startsWith("a=candidate:") || allowsLocalICECandidate(normalized.slice(2));
    })
    .join("\n");
}

function isLocalAddress(rawAddress: string): boolean {
  const address = rawAddress.toLowerCase();
  if (address.endsWith(".local")) return true;

  const ipv4 = address.split(".").map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return ipv4[0] === 10 ||
      (ipv4[0] === 172 && ipv4[1]! >= 16 && ipv4[1]! <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168) ||
      (ipv4[0] === 169 && ipv4[1] === 254);
  }

  const firstHextet = Number.parseInt(address.split("%", 1)[0]?.split(":", 1)[0] ?? "", 16);
  return Number.isInteger(firstHextet) &&
    ((firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80);
}
