const encoder = new TextEncoder();
const decoder = new TextDecoder();

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

export function toBase64URL(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64URL(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function sha256(value: Uint8Array): Promise<string> {
  return toBase64URL(await crypto.subtle.digest("SHA-256", asArrayBuffer(value)));
}

export async function capabilityHash(secret: Uint8Array): Promise<string> {
  const prefix = encoder.encode("watermelon-link-capability-v1:");
  const value = new Uint8Array(prefix.byteLength + secret.byteLength);
  value.set(prefix);
  value.set(secret, prefix.byteLength);
  return sha256(value);
}

export class SignalCipher {
  private constructor(
    private readonly sendKey: CryptoKey,
    private readonly receiveKey: CryptoKey,
    private readonly sendAdditionalData: Uint8Array,
    private readonly receiveAdditionalData: Uint8Array
  ) {}

  static async create(secret: Uint8Array, sessionID: string, role: "browser" | "phone"): Promise<SignalCipher> {
    const material = await crypto.subtle.importKey("raw", asArrayBuffer(secret), "HKDF", false, ["deriveKey"]);
    const derive = (direction: string) => crypto.subtle.deriveKey({
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode(sessionID),
        info: encoder.encode(`watermelon-link-signaling-v1:${direction}`)
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    const sendDirection = role === "browser" ? "browser-to-phone" : "phone-to-browser";
    const receiveDirection = role === "browser" ? "phone-to-browser" : "browser-to-phone";
    return new SignalCipher(
      await derive(sendDirection),
      await derive(receiveDirection),
      encoder.encode(`watermelon-link-v1:${sessionID}:${sendDirection}`),
      encoder.encode(`watermelon-link-v1:${sessionID}:${receiveDirection}`)
    );
  }

  async encrypt(value: unknown, fixedIV?: Uint8Array): Promise<string> {
    const iv = fixedIV ? new Uint8Array(fixedIV) : crypto.getRandomValues(new Uint8Array(12));
    if (iv.byteLength !== 12) throw new Error("Invalid AES-GCM IV");
    const plaintext = encoder.encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asArrayBuffer(iv), additionalData: asArrayBuffer(this.sendAdditionalData) },
      this.sendKey,
      plaintext
    );
    return `${toBase64URL(iv)}.${toBase64URL(ciphertext)}`;
  }

  async decrypt<T>(value: string): Promise<T> {
    const components = value.split(".");
    if (components.length !== 2 || !components[0] || !components[1]) throw new Error("Malformed encrypted signal");
    const [ivValue, ciphertextValue] = components;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asArrayBuffer(fromBase64URL(ivValue)),
        additionalData: asArrayBuffer(this.receiveAdditionalData)
      },
      this.receiveKey,
      asArrayBuffer(fromBase64URL(ciphertextValue))
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  }
}

async function hmac(secret: Uint8Array, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", asArrayBuffer(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = encoder.encode(value);
  return toBase64URL(await crypto.subtle.sign("HMAC", key, asArrayBuffer(data)));
}

export function authenticationMAC(secret: Uint8Array, sessionID: string, nonce: string): Promise<string> {
  return hmac(secret, `watermelon-link-auth-v1:${sessionID}:phone-to-browser:${nonce}`);
}

export function authenticationConfirmationMAC(
  secret: Uint8Array,
  sessionID: string,
  nonce: string,
  folderName: string,
  browserNodeID: string,
  reclaimBrowserNodeIDs: string[],
  uploadChunkBytes: number
): Promise<string> {
  return hmac(secret, `watermelon-link-auth-v1:${sessionID}:browser-to-phone:${nonce}:${folderName}:${browserNodeID}:${reclaimBrowserNodeIDs.join(",")}:${uploadChunkBytes}`);
}

export function timingSafeEqual(left: string, right: string): boolean {
  const a = fromBase64URL(left);
  const b = fromBase64URL(right);
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
