type FileSystemRequest = {
  type?: string;
  id?: string;
  operation?: string;
  path?: string;
  sourcePath?: string;
  destinationPath?: string;
  transferID?: string;
  mode?: string;
  size?: number;
  offset?: number;
  length?: number;
  data?: string;
};

type UploadState = {
  writable: FileSystemWritableFileStream;
  expectedSize: number;
  receivedSize: number;
};

export function installFileSystemNode(channel: RTCDataChannel, root: FileSystemDirectoryHandle): () => void {
  const uploads = new Map<string, UploadState>();
  let queue = Promise.resolve();

  const onMessage = (event: MessageEvent) => {
    queue = queue.then(async () => {
      let request: FileSystemRequest;
      try {
        request = JSON.parse(String(event.data)) as FileSystemRequest;
      } catch {
        return;
      }
      if (request.type !== "fs_request" || !request.id || !request.operation) return;
      try {
        const result = await performOperation(root, uploads, request);
        sendResponse(channel, request.id, true, result);
      } catch (error) {
        sendResponse(channel, request.id, false, undefined, errorCode(error));
      }
    });
  };

  channel.addEventListener("message", onMessage);
  return () => {
    channel.removeEventListener("message", onMessage);
    for (const upload of uploads.values()) void upload.writable.abort().catch(() => {});
    uploads.clear();
  };
}

export async function performOperation(
  root: FileSystemDirectoryHandle,
  uploads: Map<string, UploadState>,
  request: FileSystemRequest
): Promise<unknown> {
  switch (request.operation) {
    case "list": {
      const path = requiredString(request.path);
      const directory = await directoryAt(root, path, false);
      const entries: unknown[] = [];
      for await (const [name, handle] of directory.entries()) {
        entries.push(await entryDescription(joinPath(path, name), handle));
      }
      return entries;
    }
    case "metadata": {
      const resolved = await entryAt(root, requiredString(request.path), true);
      return resolved ? entryDescription(resolved.path, resolved.handle) : null;
    }
    case "create_directory":
      await directoryAt(root, requiredString(request.path), true);
      return null;
    case "delete": {
      const { parent, name } = await parentAndName(root, requiredString(request.path), false);
      await parent.removeEntry(name, { recursive: true });
      return null;
    }
    case "copy":
      await copyEntry(root, requiredString(request.sourcePath), requiredString(request.destinationPath));
      return null;
    case "move": {
      const source = requiredString(request.sourcePath);
      await copyEntry(root, source, requiredString(request.destinationPath));
      const { parent, name } = await parentAndName(root, source, false);
      await parent.removeEntry(name, { recursive: true });
      return null;
    }
    case "upload_begin": {
      const transferID = requiredString(request.transferID);
      const path = requiredString(request.path);
      const expectedSize = requiredNonnegativeInteger(request.size);
      if (uploads.has(transferID)) throw new Error("duplicate_transfer");
      if (request.mode === "create_if_absent" && await entryAt(root, path, true)) throw new Error("name_collision");
      const { parent, name } = await parentAndName(root, path, true);
      const handle = await parent.getFileHandle(name, { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      uploads.set(transferID, { writable, expectedSize, receivedSize: 0 });
      return null;
    }
    case "upload_chunk": {
      const transferID = requiredString(request.transferID);
      const upload = uploads.get(transferID);
      if (!upload) throw new Error("unknown_transfer");
      const bytes = decodeBase64(requiredString(request.data));
      if (upload.receivedSize + bytes.byteLength > upload.expectedSize) throw new Error("invalid_size");
      await upload.writable.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      upload.receivedSize += bytes.byteLength;
      return null;
    }
    case "upload_finish": {
      const transferID = requiredString(request.transferID);
      const upload = uploads.get(transferID);
      if (!upload) throw new Error("unknown_transfer");
      uploads.delete(transferID);
      if (upload.receivedSize !== upload.expectedSize) {
        await upload.writable.abort();
        throw new Error("invalid_size");
      }
      await upload.writable.close();
      return null;
    }
    case "upload_abort": {
      const transferID = requiredString(request.transferID);
      const upload = uploads.get(transferID);
      uploads.delete(transferID);
      if (upload) await upload.writable.abort();
      return null;
    }
    case "download_begin": {
      const file = await fileAt(root, requiredString(request.path));
      return { size: file.size };
    }
    case "download_chunk": {
      const file = await fileAt(root, requiredString(request.path));
      const offset = requiredNonnegativeInteger(request.offset);
      const length = requiredNonnegativeInteger(request.length);
      if (length > 32 * 1024 || offset + length > file.size) throw new Error("invalid_range");
      return { data: encodeBase64(new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())) };
    }
    default:
      throw new Error("unsupported_operation");
  }
}

async function copyEntry(root: FileSystemDirectoryHandle, sourcePath: string, destinationPath: string): Promise<void> {
  const source = await entryAt(root, sourcePath, false);
  if (!source) throw new DOMException("Not found", "NotFoundError");
  if (source.handle.kind === "file") {
    const { parent, name } = await parentAndName(root, destinationPath, true);
    const destination = await parent.getFileHandle(name, { create: true });
    const writable = await destination.createWritable({ keepExistingData: false });
    try {
      await writable.write(await (source.handle as FileSystemFileHandle).getFile());
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    return;
  }

  const destination = await directoryAt(root, destinationPath, true);
  for await (const [name] of (source.handle as FileSystemDirectoryHandle).entries()) {
    await copyEntry(root, joinPath(sourcePath, name), joinPath(destinationPath, name));
  }
  void destination;
}

async function entryDescription(path: string, handle: FileSystemHandle): Promise<unknown> {
  if (handle.kind === "directory") {
    return { path: normalizePath(path), name: handle.name, isDirectory: true, size: 0, creationDateMs: null, modificationDateMs: null };
  }
  const file = await (handle as FileSystemFileHandle).getFile();
  return {
    path: normalizePath(path),
    name: handle.name,
    isDirectory: false,
    size: file.size,
    creationDateMs: null,
    modificationDateMs: file.lastModified > 0 ? file.lastModified : null
  };
}

async function fileAt(root: FileSystemDirectoryHandle, path: string): Promise<File> {
  const resolved = await entryAt(root, path, false);
  if (!resolved || resolved.handle.kind !== "file") throw new DOMException("Not found", "NotFoundError");
  return (resolved.handle as FileSystemFileHandle).getFile();
}

async function entryAt(
  root: FileSystemDirectoryHandle,
  path: string,
  allowMissing: boolean
): Promise<{ path: string; handle: FileSystemHandle } | null> {
  const normalized = normalizePath(path);
  if (normalized === "/") return { path: normalized, handle: root };
  const { parent, name } = await parentAndName(root, normalized, false);
  try {
    return { path: normalized, handle: await parent.getFileHandle(name) };
  } catch (error) {
    if (!isLookupMiss(error)) throw error;
  }
  try {
    return { path: normalized, handle: await parent.getDirectoryHandle(name) };
  } catch (error) {
    if (allowMissing && isNotFound(error)) return null;
    throw error;
  }
}

async function parentAndName(
  root: FileSystemDirectoryHandle,
  path: string,
  createParents: boolean
): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
  const components = pathComponents(path);
  const name = components.pop();
  if (!name) throw new Error("invalid_path");
  const parent = await directoryAt(root, `/${components.join("/")}`, createParents);
  return { parent, name };
}

async function directoryAt(root: FileSystemDirectoryHandle, path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  let directory = root;
  for (const component of pathComponents(path)) {
    directory = await directory.getDirectoryHandle(component, { create });
  }
  return directory;
}

function pathComponents(path: string): string[] {
  const normalized = normalizePath(path);
  if (normalized === "/") return [];
  return normalized.slice(1).split("/");
}

function normalizePath(path: string): string {
  if (typeof path !== "string" || path.includes("\0")) throw new Error("invalid_path");
  const components = path.split("/").filter(Boolean);
  if (components.some((component) => component === "." || component === ".." || component.includes("\\"))) {
    throw new Error("invalid_path");
  }
  return components.length === 0 ? "/" : `/${components.join("/")}`;
}

function joinPath(parent: string, name: string): string {
  return normalizePath(`${normalizePath(parent)}/${name}`);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) throw new Error("invalid_request");
  return value;
}

function requiredNonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid_request");
  return value;
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function isLookupMiss(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotFoundError" || error.name === "TypeMismatchError");
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z_]+$/.test(error.message)) return error.message;
  if (error instanceof DOMException) return error.name === "NotFoundError" ? "not_found" : "file_system_error";
  return "file_system_error";
}

function sendResponse(channel: RTCDataChannel, id: string, ok: boolean, result?: unknown, error?: string): void {
  if (channel.readyState !== "open") return;
  channel.send(JSON.stringify(ok
    ? { type: "fs_response", id, ok: true, result: result ?? null }
    : { type: "fs_response", id, ok: false, error: error ?? "file_system_error" }));
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
}
