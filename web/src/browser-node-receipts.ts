const maximumReceipts = 16;
const storageKey = "watermelon-link-quiesced-node-scope";

export class BrowserNodeInUseError extends Error {}

export class BrowserNodeLease {
  readonly currentScope: string;
  readonly reclaimScopes: string[];
  private releaseLock: (() => void) | null;
  private readonly storage: Storage;

  private constructor(currentScope: string, reclaimScopes: string[], releaseLock: () => void, storage: Storage) {
    this.currentScope = currentScope;
    this.reclaimScopes = reclaimScopes;
    this.releaseLock = releaseLock;
    this.storage = storage;
  }

  static acquire(signal: AbortSignal, currentScope: string): Promise<BrowserNodeLease> {
    if (!navigator.locks) return Promise.reject(new Error("Browser lock support is unavailable"));
    if (!isBrowserNodeScope(currentScope)) return Promise.reject(new Error("Invalid browser node scope"));
    if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
    let releaseLock!: () => void;
    const released = new Promise<void>((resolve) => { releaseLock = resolve; });
    return new Promise<BrowserNodeLease>((resolve, reject) => {
      void navigator.locks.request(
        "watermelon-link-filesystem-node-v1",
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            reject(new BrowserNodeInUseError("Another tab is already using the browser node"));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("The operation was aborted", "AbortError"));
            return;
          }
          resolve(new BrowserNodeLease(currentScope, loadReceipts(localStorage), releaseLock, localStorage));
          await released;
        }
      ).catch(reject);
    });
  }

  async closeAfter(quiescence?: Promise<void>): Promise<void> {
    const releaseLock = this.releaseLock;
    if (!releaseLock) return;
    this.releaseLock = null;
    try {
      if (quiescence) {
        await quiescence;
        storeReceipt(this.storage, this.currentScope);
      }
    } catch {
    } finally {
      releaseLock();
    }
  }
}

export function parseBrowserNodeReceipts(stored: string | null): string[] {
  if (!stored) return [];
  if (isBrowserNodeScope(stored)) return [stored];
  try {
    const values = JSON.parse(stored);
    if (!Array.isArray(values)) return [];
    return [...new Set(values.filter((value): value is string =>
      typeof value === "string" && isBrowserNodeScope(value)
    ))].slice(-maximumReceipts);
  } catch {
    return [];
  }
}

export function appendingBrowserNodeReceipt(stored: string | null, value: string): string {
  const scopes = parseBrowserNodeReceipts(stored).filter((scope) => scope !== value);
  scopes.push(value);
  return JSON.stringify(scopes.slice(-maximumReceipts));
}

function isBrowserNodeScope(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=";
    const decoded = atob(base64);
    if (decoded.length !== 32) return false;
    return btoa(decoded).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === value;
  } catch {
    return false;
  }
}

function loadReceipts(storage: Storage): string[] {
  try {
    return parseBrowserNodeReceipts(storage.getItem(storageKey));
  } catch {
    return [];
  }
}

function storeReceipt(storage: Storage, value: string): void {
  try {
    storage.setItem(storageKey, appendingBrowserNodeReceipt(storage.getItem(storageKey), value));
  } catch {}
}
