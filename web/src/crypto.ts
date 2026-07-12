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

export class SignalCipher {
  private constructor(
    private readonly key: CryptoKey,
    private readonly additionalData: Uint8Array
  ) {}

  static async create(secret: Uint8Array, sessionID: string): Promise<SignalCipher> {
    const material = await crypto.subtle.importKey("raw", asArrayBuffer(secret), "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode(sessionID),
        info: encoder.encode("watermelon-link-signaling-v1")
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    return new SignalCipher(key, encoder.encode(sessionID));
  }

  async encrypt(value: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asArrayBuffer(iv), additionalData: asArrayBuffer(this.additionalData) },
      this.key,
      plaintext
    );
    return `${toBase64URL(iv)}.${toBase64URL(ciphertext)}`;
  }

  async decrypt<T>(value: string): Promise<T> {
    const [ivValue, ciphertextValue] = value.split(".");
    if (!ivValue || !ciphertextValue) throw new Error("Malformed encrypted signal");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asArrayBuffer(fromBase64URL(ivValue)),
        additionalData: asArrayBuffer(this.additionalData)
      },
      this.key,
      asArrayBuffer(fromBase64URL(ciphertextValue))
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  }
}

export async function authenticationMAC(secret: Uint8Array, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", asArrayBuffer(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = encoder.encode(`watermelon-link-data-v1:${nonce}`);
  return toBase64URL(await crypto.subtle.sign("HMAC", key, asArrayBuffer(data)));
}

export function timingSafeEqual(left: string, right: string): boolean {
  const a = fromBase64URL(left);
  const b = fromBase64URL(right);
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
