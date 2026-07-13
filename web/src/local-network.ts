export function allowsLocalICECandidate(candidate: string): boolean {
  if (!/^[\x20-\x7e]*$/.test(candidate)) return false;
  const fields = candidate.trim().split(/ +/);
  if (fields.length < 8 ||
      !/^candidate:[A-Za-z0-9+/]{1,32}$/i.test(fields[0] ?? "") ||
      (fields[1] !== "1" && fields[1] !== "2") ||
      (fields[2]?.toLowerCase() !== "udp" && fields[2]?.toLowerCase() !== "tcp") ||
      !isUnsigned32(fields[3] ?? "") ||
      !isPort(fields[5] ?? "") ||
      fields[6]?.toLowerCase() !== "typ" || fields[7]?.toLowerCase() !== "host") return false;
  return isLocalAddress(fields[4] ?? "");
}

export function filterLocalICECandidates(sdp: string): string {
  if (!hasValidSDPCharacters(sdp)) return "";
  return logicalLines(sdp)
    .filter((line) => {
      const normalized = line.trim();
      const candidate = candidateLine(normalized);
      return candidate === null || (candidate !== false && allowsLocalICECandidate(candidate));
    })
    .join("\r\n");
}

export function localICECandidateStatistics(sdp: string): { total: number; allowed: number } {
  if (!hasValidSDPCharacters(sdp)) return { total: 0, allowed: 0 };
  const candidates = logicalLines(sdp)
    .map((line) => line.trim())
    .map(candidateLine)
    .filter((candidate) => candidate !== null);
  return {
    total: candidates.length,
    allowed: candidates.filter((candidate) => candidate !== false && allowsLocalICECandidate(candidate)).length
  };
}

export function localICECandidateDiagnosticLabel(candidate: string): string {
  const fields = candidate.trim().split(/\s+/);
  if (fields.length < 8) return "malformed";
  const candidateType = fields[7]?.toLowerCase() ?? "unknown";
  const address = fields[4]?.toLowerCase() ?? "";
  let addressKind = "hostname";
  if (address.endsWith(".local")) addressKind = "mdns";
  else if (isIPv4(address)) addressKind = isLocalAddress(address) ? "private-ipv4" : "public-ipv4";
  else if (address.includes(":")) addressKind = isLocalAddress(address) ? "local-ipv6" : "public-ipv6";
  return `${candidateType}/${addressKind}/${allowsLocalICECandidate(candidate) ? "allowed" : "rejected"}`;
}

function isLocalAddress(rawAddress: string): boolean {
  const address = rawAddress.toLowerCase();
  if (isValidMDNSName(address)) return true;

  const ipv4 = address.split(".").map(Number);
  if (isIPv4(address)) {
    return ipv4[0] === 10 ||
      (ipv4[0] === 172 && ipv4[1]! >= 16 && ipv4[1]! <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168) ||
      (ipv4[0] === 169 && ipv4[1] === 254);
  }

  if (address.includes("%")) return false;
  const ipv6 = address;
  if (!isIPv6(ipv6)) return false;
  const firstHextet = Number.parseInt(ipv6.split(":", 1)[0] ?? "", 16);
  return Number.isInteger(firstHextet) &&
    ((firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80);
}

function isIPv4(address: string): boolean {
  const fields = address.split(".");
  return fields.length === 4 && fields.every((field) => {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(field)) return false;
    const part = Number(field);
    return part >= 0 && part <= 255 && String(part) === field;
  });
}

function logicalLines(sdp: string): string[] {
  return sdp.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function candidateLine(line: string): string | false | null {
  if (/^a=candidate:/i.test(line)) return line.slice(2);
  if (/^a\s*=\s*candidate\s*:/i.test(line)) return false;
  return null;
}

function isUnsigned32(value: string): boolean {
  return /^\d{1,10}$/.test(value) && Number(value) <= 0xffff_ffff;
}

function isPort(value: string): boolean {
  return /^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) <= 65_535;
}

function isValidMDNSName(address: string): boolean {
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.local$/i.exec(address);
  return match !== null;
}

function hasValidSDPCharacters(sdp: string): boolean {
  return /^[\x20-\x7e\r\n]*$/.test(sdp);
}

function isIPv6(address: string): boolean {
  if (!address.includes(":")) return false;
  try {
    return new URL(`http://[${address}]/`).hostname.startsWith("[");
  } catch {
    return false;
  }
}
