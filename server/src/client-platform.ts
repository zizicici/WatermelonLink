import type { IncomingHttpHeaders } from "node:http";

export type BrowserFamily = "Chrome" | "Chromium" | "Edge" | "Firefox" | "Safari" | "Other";
export type OperatingSystemFamily = "Android" | "ChromeOS" | "iOS" | "Linux" | "macOS" | "Windows" | "Other";
export type ClientPlatform = { browser: BrowserFamily; operatingSystem: OperatingSystemFamily };

export const unknownClientPlatform: ClientPlatform = { browser: "Other", operatingSystem: "Other" };

export function classifyClientPlatform(headers: IncomingHttpHeaders): ClientPlatform {
  const brands = header(headers["sec-ch-ua"]).toLowerCase();
  const userAgent = header(headers["user-agent"]);
  const platformHint = header(headers["sec-ch-ua-platform"]).replace(/^"|"$/g, "").toLowerCase();
  return {
    browser: classifyBrowser(brands, userAgent),
    operatingSystem: classifyOperatingSystem(platformHint, userAgent)
  };
}

function classifyBrowser(brands: string, userAgent: string): BrowserFamily {
  if (brands.includes("microsoft edge") || /\bEdg(?:A|iOS)?\//.test(userAgent)) return "Edge";
  if (brands.includes("google chrome")) return "Chrome";
  if (brands.includes("chromium")) return "Chromium";
  if (/\b(?:OPR|Vivaldi|SamsungBrowser)\//.test(userAgent)) return "Chromium";
  if (/\b(?:Chrome|CriOS)\//.test(userAgent)) return "Chrome";
  if (/\b(?:Firefox|FxiOS)\//.test(userAgent)) return "Firefox";
  if (/\bSafari\//.test(userAgent) && /\bVersion\//.test(userAgent)) return "Safari";
  return "Other";
}

function classifyOperatingSystem(platformHint: string, userAgent: string): OperatingSystemFamily {
  if (platformHint === "windows") return "Windows";
  if (platformHint === "macos") return "macOS";
  if (platformHint === "ios") return "iOS";
  if (platformHint === "android") return "Android";
  if (platformHint === "chrome os") return "ChromeOS";
  if (platformHint === "linux") return "Linux";
  if (/\b(?:iPhone|iPad|iPod)\b/.test(userAgent)) return "iOS";
  if (/\bAndroid\b/.test(userAgent)) return "Android";
  if (/\bCrOS\b/.test(userAgent)) return "ChromeOS";
  if (/\bWindows NT\b/.test(userAgent)) return "Windows";
  if (/\bMacintosh\b|\bMac OS X\b/.test(userAgent)) return "macOS";
  if (/\bLinux\b/.test(userAgent)) return "Linux";
  return "Other";
}

function header(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(",") : value ?? "";
}
