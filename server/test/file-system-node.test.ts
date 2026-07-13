import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptUploadFrame,
  acceptDownloadAcknowledgement,
  consumeDownloadAcknowledgementBudget,
  availableDownloadWindowBytes,
  decodeUploadFrame,
  encodeDownloadFrame,
  installFileSystemNodeController,
  nextDownloadPayloadLength,
  performOperation,
  sendResponse,
  type DownloadState,
  type UploadState
} from "../../web/src/file-system-node.js";

async function uploadBytes(
  uploads: Map<string, UploadState>,
  transferID: string,
  payload: Uint8Array
): Promise<number | null> {
  const upload = uploads.get(transferID);
  assert.ok(upload);
  return acceptUploadFrame(uploads, { transferID, offset: upload.receivedSize, payload });
}

function binaryUploadFrame(transferID: string, offset: number, payload: Uint8Array): ArrayBuffer {
  const frame = new ArrayBuffer(32 + payload.byteLength);
  const bytes = new Uint8Array(frame);
  bytes.set([0x57, 0x4d, 0x4c, 0x01]);
  const identifier = transferID.replaceAll("-", "");
  for (let index = 0; index < 16; index += 1) {
    bytes[4 + index] = Number.parseInt(identifier.slice(index * 2, index * 2 + 2), 16);
  }
  const view = new DataView(frame);
  view.setBigUint64(20, BigInt(offset), false);
  view.setUint32(28, payload.byteLength, false);
  bytes.set(payload, 32);
  return frame;
}

class MemoryFile {
  readonly kind = "file";
  data = new Uint8Array();
  writeCount = 0;

  constructor(readonly name: string) {}

  async getFile() {
    const data = this.data.slice();
    return Object.assign(new Blob([data]), {
      name: this.name,
      lastModified: 1_700_000_000_000,
    });
  }

  async createWritable() {
    let staged = new Uint8Array();
    return {
      write: async (chunk: ArrayBuffer | Blob) => {
        this.writeCount += 1;
        const next = chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : new Uint8Array(chunk);
        const merged = new Uint8Array(staged.byteLength + next.byteLength);
        merged.set(staged);
        merged.set(next, staged.byteLength);
        staged = merged;
      },
      close: async () => { this.data = staged; },
      abort: async () => {},
    };
  }
}

class MemoryDirectory {
  readonly kind = "directory";
  readonly children = new Map<string, MemoryFile | MemoryDirectory>();

  constructor(readonly name: string, private readonly fileFactory = (name: string) => new MemoryFile(name)) {}

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.children.get(name);
    if (existing?.kind === "file") return existing;
    if (existing) throw new DOMException("Wrong entry type", "TypeMismatchError");
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const file = this.fileFactory(name);
    this.children.set(name, file);
    return file;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.children.get(name);
    if (existing?.kind === "directory") return existing;
    if (existing) throw new DOMException("Wrong entry type", "TypeMismatchError");
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const directory = new MemoryDirectory(name);
    this.children.set(name, directory);
    return directory;
  }

  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw new DOMException("Not found", "NotFoundError");
  }

  async *entries() {
    yield* this.children.entries();
  }
}

class SlowCloseFile extends MemoryFile {
  abortCount = 0;
  private closeStartedResolve!: () => void;
  private releaseCloseResolve!: () => void;
  readonly closeStarted = new Promise<void>((resolve) => { this.closeStartedResolve = resolve; });
  private readonly closeRelease = new Promise<void>((resolve) => { this.releaseCloseResolve = resolve; });

  releaseClose() { this.releaseCloseResolve(); }

  override async createWritable() {
    let staged = new Uint8Array();
    return {
      write: async (chunk: ArrayBuffer | Blob) => {
        staged = chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : new Uint8Array(chunk);
      },
      close: async () => {
        this.closeStartedResolve();
        await this.closeRelease;
        this.data = staged;
      },
      abort: async () => { this.abortCount += 1; },
    };
  }
}

class SlowAbortFile extends MemoryFile {
  private abortStartedResolve!: () => void;
  private releaseAbortResolve!: () => void;
  readonly abortStarted = new Promise<void>((resolve) => { this.abortStartedResolve = resolve; });
  private readonly abortRelease = new Promise<void>((resolve) => { this.releaseAbortResolve = resolve; });

  releaseAbort() { this.releaseAbortResolve(); }

  override async createWritable() {
    return {
      write: async () => {},
      close: async () => {},
      abort: async () => {
        this.abortStartedResolve();
        await this.abortRelease;
      },
    };
  }
}

class SlowWriteFile extends MemoryFile {
  abortCount = 0;
  private writeStartedResolve!: () => void;
  private releaseWriteResolve!: () => void;
  readonly writeStarted = new Promise<void>((resolve) => { this.writeStartedResolve = resolve; });
  private readonly writeRelease = new Promise<void>((resolve) => { this.releaseWriteResolve = resolve; });

  releaseWrite() { this.releaseWriteResolve(); }

  override async createWritable() {
    let staged = new Uint8Array();
    return {
      write: async (chunk: ArrayBuffer | Blob) => {
        this.writeStartedResolve();
        await this.writeRelease;
        staged = chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : new Uint8Array(chunk);
      },
      close: async () => { this.data = staged; },
      abort: async () => { this.abortCount += 1; },
    };
  }
}

class ReleasableReadFile extends MemoryFile {
  readCount = 0;
  private readonly pendingReads: Array<(value: ArrayBuffer) => void> = [];

  releaseNextRead() {
    this.pendingReads.shift()?.(new ArrayBuffer(128 * 1024));
  }

  override async getFile() {
    return {
      name: this.name,
      size: 128 * 1024,
      lastModified: 0,
      slice: () => ({
        arrayBuffer: () => {
          this.readCount += 1;
          return new Promise<ArrayBuffer>((resolve) => this.pendingReads.push(resolve));
        },
      }),
    } as unknown as File;
  }
}

test("browser node writes, reads, moves, and deletes files inside the selected root", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  const downloads = new Map();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root, uploads, { operation, ...fields }, downloads);

  await request("create_directory", { path: "/Photos" });
  assert.equal((await request("metadata", { path: "/Photos" }) as { isDirectory: boolean }).isDirectory, true);
  await request("upload_begin", { transferID: "one", path: "/Photos/a.bin", mode: "create_if_absent", size: 5 });
  await uploadBytes(uploads, "one", Buffer.from("hello"));
  await request("upload_finish", { transferID: "one" });

  const metadata = await request("metadata", { path: "/Photos/a.bin" }) as { size: number };
  assert.equal(metadata.size, 5);
  const download = await request("download_begin", { path: "/Photos/a.bin" }) as { transferID: string; size: number };
  assert.equal(download.size, 5);
  assert.equal(Buffer.from(await downloads.get(download.transferID)!.file.arrayBuffer()).toString(), "hello");
  await request("download_abort", { transferID: download.transferID });

  await request("copy", { sourcePath: "/Photos/a.bin", destinationPath: "/Photos/b.bin" });
  await request("move", { sourcePath: "/Photos/b.bin", destinationPath: "/moved.bin" });
  assert.equal(await request("metadata", { path: "/Photos/b.bin" }), null);
  assert.equal((await request("metadata", { path: "/moved.bin" }) as { size: number }).size, 5);
  await request("delete", { path: "/moved.bin" });
  assert.equal(await request("metadata", { path: "/moved.bin" }), null);
  assert.equal(await request("metadata", { path: "/missing/parent/file.bin" }), null);
});

test("browser node rejects traversal and create-if-absent collisions", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root, uploads, { operation, ...fields });

  for (const [index, path] of ["/../secret", "/./secret", "/folder\\secret", "/folder/\0secret"].entries()) {
    await assert.rejects(request("list", { path }), /invalid_path/);
    await assert.rejects(request("metadata", { path }), /invalid_path/);
    await assert.rejects(request("create_directory", { path }), /invalid_path/);
    await assert.rejects(request("delete", { path }), /invalid_path/);
    await assert.rejects(request("download_begin", { path }), /invalid_path/);
    await assert.rejects(request("upload_begin", {
      transferID: `invalid-${index}`, path, mode: "replace", size: 0,
    }), /invalid_path/);
    await assert.rejects(request("copy", {
      sourcePath: path, destinationPath: "/copy.bin",
    }), /invalid_path/);
    await assert.rejects(request("copy", {
      sourcePath: "/source.bin", destinationPath: path,
    }), /invalid_path/);
    await assert.rejects(request("move", {
      sourcePath: path, destinationPath: "/move.bin",
    }), /invalid_path/);
    await assert.rejects(request("move", {
      sourcePath: "/source.bin", destinationPath: path,
    }), /invalid_path/);
  }
  await request("upload_begin", { transferID: "one", path: "/a.bin", mode: "create_if_absent", size: 0 });
  await request("upload_finish", { transferID: "one" });
  await assert.rejects(
    request("upload_begin", { transferID: "two", path: "/a.bin", mode: "create_if_absent", size: 0 }),
    /name_collision/
  );
});

test("active upload paths are reserved against competing streams and namespace mutations", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root, uploads, { operation, ...fields });
  await request("upload_begin", {
    transferID: "owner", path: "/Photos/a.bin", mode: "replace", size: 1,
  });
  await assert.rejects(request("upload_begin", {
    transferID: "competitor", path: "/Photos/a.bin", mode: "replace", size: 1,
  }), /upload_conflict/);
  assert.equal(await request("create_directory", { path: "/Photos" }), null);
  await assert.rejects(request("create_directory", { path: "/Photos/a.bin" }), /Wrong entry type/);
  await assert.rejects(request("delete", { path: "/Photos" }), /upload_conflict/);
  await assert.rejects(request("move", {
    sourcePath: "/unrelated.bin", destinationPath: "/Photos/a.bin",
  }), /upload_conflict/);
  await request("upload_abort", { transferID: "owner" });
  await request("upload_begin", {
    transferID: "competitor", path: "/Photos/a.bin", mode: "replace", size: 0,
  });
  await request("upload_finish", { transferID: "competitor" });
});

test("four manifest uploads can reuse their shared existing directory while active", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root, uploads, { operation, ...fields });
  const directory = "/.watermelon/months";
  await request("create_directory", { path: directory });

  for (let index = 0; index < 4; index += 1) {
    assert.equal(await request("create_directory", { path: directory }), null);
    await request("upload_begin", {
      transferID: `manifest-${index}`,
      path: `${directory}/2026-0${index + 1}.sqlite.${index}.tmp`,
      mode: "replace",
      size: 1,
    });
  }
  for (let index = 0; index < 4; index += 1) {
    await uploadBytes(uploads, `manifest-${index}`, Buffer.from([index]));
    await request("upload_finish", { transferID: `manifest-${index}` });
  }
  assert.equal(uploads.size, 0);
});

test("browser admits four backup workers plus one lock refresh upload", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  for (let index = 0; index < 4; index += 1) {
    await performOperation(root, uploads, {
      operation: "upload_begin",
      transferID: `transfer-${index}`,
      path: `/file-${index}.bin`,
      mode: "replace",
      size: 1,
    });
  }
  await assert.rejects(performOperation(root, uploads, {
    operation: "upload_begin",
    transferID: "transfer-4",
    path: "/file-4.bin",
    mode: "replace",
    size: 1,
  }), /too_many_transfers/);
  const lockPath = "/.watermelon/locks/00112233-4455-6677-8899-aabbccddeeff.lock";
  await performOperation(root, uploads, {
    operation: "upload_begin",
    transferID: "lock-transfer",
    path: lockPath,
    mode: "replace",
    size: 1,
  });
  await assert.rejects(performOperation(root, uploads, {
    operation: "upload_begin",
    transferID: "second-lock-transfer",
    path: "/.watermelon/locks/11112233-4455-6677-8899-aabbccddeeff.lock",
    mode: "replace",
    size: 1,
  }), /too_many_transfers/);
  for (let index = 0; index < 4; index += 1) {
    await performOperation(root, uploads, { operation: "upload_abort", transferID: `transfer-${index}` });
  }
  await performOperation(root, uploads, { operation: "upload_abort", transferID: "lock-transfer" });
});

test("concurrent data and lock upload admission cannot exceed the class limits", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  const admission = { dataReservations: 0, controlReservations: 0 };
  const request = (transferID: string, path: string) => performOperation(
    root,
    uploads,
    { operation: "upload_begin", transferID, path, mode: "replace", size: 1 },
    new Map(),
    new Set(),
    { orphanedReads: 0, settlingReads: new Set() },
    admission
  );
  for (let index = 0; index < 4; index += 1) {
    await request(`data-${index}`, `/data-${index}.bin`);
  }

  const [dataResult, lockResult] = await Promise.allSettled([
    request("data-overflow", "/data-overflow.bin"),
    request("lock", "/.watermelon/locks/00112233-4455-6677-8899-aabbccddeeff.lock")
  ]);
  assert.equal(dataResult.status, "rejected");
  assert.equal(lockResult.status, "fulfilled");
  assert.equal([...uploads.values()].filter((upload) => !upload.control).length, 4);
  assert.equal([...uploads.values()].filter((upload) => upload.control).length, 1);

  await Promise.all([...uploads.keys()].map((transferID) => performOperation(
    root, uploads, { operation: "upload_abort", transferID }
  )));
});

test("rejected upload conflicts release admission reservations", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  const admission = { dataReservations: 0, controlReservations: 0 };
  const request = (transferID: string, path: string) => performOperation(
    root,
    uploads,
    { operation: "upload_begin", transferID, path, mode: "replace", size: 1 },
    new Map(),
    new Set(),
    { orphanedReads: 0, settlingReads: new Set() },
    admission
  );
  await request("owner", "/same.bin");
  for (let index = 0; index < 4; index += 1) {
    await assert.rejects(request(`conflict-${index}`, "/same.bin"), /upload_conflict/);
  }
  assert.deepEqual(admission, { dataReservations: 0, controlReservations: 0 });
  await performOperation(root, uploads, { operation: "upload_abort", transferID: "owner" });
  await Promise.all(Array.from({ length: 4 }, (_, index) => request(`data-${index}`, `/data-${index}.bin`)));
  assert.equal([...uploads.values()].filter((upload) => !upload.control).length, 4);
  await Promise.all([...uploads.keys()].map((transferID) => performOperation(
    root, uploads, { operation: "upload_abort", transferID }
  )));
});

test("browser node preserves storage protocol mutation semantics", async () => {
  const rootDirectory = new MemoryDirectory("Backup");
  const root = rootDirectory as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  const downloads = new Map();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root, uploads, { operation, ...fields }, downloads);

  assert.equal(await request("delete", { path: "/missing/parent/file.bin" }), null);

  await request("upload_begin", { transferID: "abort-new", path: "/new.bin", mode: "replace", size: 1 });
  await uploadBytes(uploads, "abort-new", Buffer.from("x"));
  await request("upload_abort", { transferID: "abort-new" });
  assert.equal(await request("metadata", { path: "/new.bin" }), null);

  await request("upload_begin", { transferID: "existing", path: "/existing.bin", mode: "replace", size: 3 });
  await uploadBytes(uploads, "existing", Buffer.from("old"));
  await request("upload_finish", { transferID: "existing" });
  await request("upload_begin", { transferID: "abort-replace", path: "/existing.bin", mode: "replace", size: 3 });
  await uploadBytes(uploads, "abort-replace", Buffer.from("new"));
  await request("upload_abort", { transferID: "abort-replace" });
  assert.equal((await request("metadata", { path: "/existing.bin" }) as { size: number }).size, 3);
  const preserved = await request("download_begin", { path: "/existing.bin" }) as { transferID: string };
  assert.equal(Buffer.from(await downloads.get(preserved.transferID)!.file.arrayBuffer()).toString(), "old");
  await request("download_abort", { transferID: preserved.transferID });

  await request("move", { sourcePath: "/existing.bin", destinationPath: "/existing.bin" });
  assert.equal((await request("metadata", { path: "/existing.bin" }) as { size: number }).size, 3);
  await request("create_directory", { path: "/Photos/Child" });
  await assert.rejects(
    request("move", { sourcePath: "/Photos", destinationPath: "/Photos/Child/Nested" }),
    /invalid_path/
  );

  await request("upload_begin", { transferID: "short", path: "/short.bin", mode: "replace", size: 8_193 });
  await uploadBytes(uploads, "short", Buffer.alloc(8_192));
  await assert.rejects(request("upload_finish", { transferID: "short" }), /invalid_size/);
  assert.equal(await request("metadata", { path: "/short.bin" }), null);

  await request("create_directory", { path: "/Source" });
  await request("upload_begin", { transferID: "source", path: "/Source/new.bin", mode: "replace", size: 1 });
  await uploadBytes(uploads, "source", Buffer.from("n"));
  await request("upload_finish", { transferID: "source" });
  await request("create_directory", { path: "/Destination" });
  await request("upload_begin", { transferID: "destination", path: "/Destination/old.bin", mode: "replace", size: 1 });
  await uploadBytes(uploads, "destination", Buffer.from("o"));
  await request("upload_finish", { transferID: "destination" });
  await assert.rejects(
    request("copy", { sourcePath: "/Source", destinationPath: "/Destination" }),
    /name_collision/
  );
  assert.equal((await request("metadata", { path: "/Destination/old.bin" }) as { size: number }).size, 1);
  assert.equal(await request("metadata", { path: "/Destination/new.bin" }), null);
});

test("download transfer keeps the file snapshot captured at begin", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  const downloads = new Map();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root, uploads, { operation, ...fields }, downloads);

  await request("upload_begin", { transferID: "old", path: "/photo.bin", mode: "replace", size: 3 });
  await uploadBytes(uploads, "old", Buffer.from("old"));
  await request("upload_finish", { transferID: "old" });
  const download = await request("download_begin", { path: "/photo.bin" }) as { transferID: string };
  await request("upload_begin", { transferID: "new", path: "/photo.bin", mode: "replace", size: 3 });
  await uploadBytes(uploads, "new", Buffer.from("new"));
  await request("upload_finish", { transferID: "new" });

  assert.equal(Buffer.from(await downloads.get(download.transferID)!.file.arrayBuffer()).toString(), "old");
  await request("download_abort", { transferID: download.transferID });
});

test("download finish requires a started and fully acknowledged stream", async () => {
  const source = new MemoryFile("source.bin");
  source.data = Buffer.from("data");
  const root = new MemoryDirectory("Backup");
  root.children.set(source.name, source);
  const uploads = new Map();
  const downloads = new Map();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root as unknown as FileSystemDirectoryHandle, uploads, { operation, ...fields }, downloads);
  const info = await request("download_begin", { path: "/source.bin" }) as { transferID: string };

  await assert.rejects(request("download_finish", { transferID: info.transferID }), /invalid_size/);
  await request("download_start", { transferID: info.transferID });
  await assert.rejects(request("download_finish", { transferID: info.transferID }), /invalid_size/);
  await assert.rejects(
    request("download_finish", { transferID: crypto.randomUUID() }),
    /unknown_transfer/
  );
  await request("download_abort", { transferID: info.transferID });
});

test("download concurrency reserves one write-lock read beyond two data snapshots", async () => {
  const source = new MemoryFile("source.bin");
  source.data = Buffer.from("data");
  const root = new MemoryDirectory("Backup");
  root.children.set(source.name, source);
  const uploads = new Map();
  const downloads = new Map();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root as unknown as FileSystemDirectoryHandle, uploads, { operation, ...fields }, downloads);

  const first = await request("download_begin", { path: "/source.bin" }) as { transferID: string };
  const second = await request("download_begin", { path: "/source.bin" }) as { transferID: string };
  await assert.rejects(request("download_begin", { path: "/source.bin" }), /too_many_transfers/);
  await request("create_directory", { path: "/.watermelon/locks" });
  const lockPath = "/.watermelon/locks/00112233-4455-4677-8899-aabbccddeeff.lock";
  await request("upload_begin", { transferID: "lock", path: lockPath, mode: "replace", size: 0 });
  await request("upload_finish", { transferID: "lock" });
  const control = await request("download_begin", { path: lockPath }) as { transferID: string };
  await assert.rejects(request("download_begin", { path: lockPath }), /too_many_transfers/);
  await request("download_abort", { transferID: first.transferID });
  await request("download_abort", { transferID: second.transferID });
  await request("download_abort", { transferID: control.transferID });
});

test("failed download-begin response rolls back the reserved snapshot slot", async () => {
  const source = new MemoryFile("source.bin");
  source.data = Buffer.from("data");
  const root = new MemoryDirectory("Backup");
  root.children.set(source.name, source);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let throwsRemaining = 2;
  const sent: string[] = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string) => {
      if (throwsRemaining > 0) {
        throwsRemaining -= 1;
        throw new DOMException("send failed", "OperationError");
      }
      sent.push(message);
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(channel, root as unknown as FileSystemDirectoryHandle);
  const begin = (id: string) => messageHandler?.({ data: JSON.stringify({
    type: "fs_request", id, operation: "download_begin", path: "/source.bin",
  }) } as MessageEvent);

  try {
    begin("failed-begin");
    await new Promise((resolve) => setImmediate(resolve));
    begin("next-begin-one");
    begin("next-begin-two");
    for (let attempt = 0; attempt < 100 && sent.length < 2; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const responses = sent.map((value) => JSON.parse(value) as { ok: boolean });
    assert.equal(responses.length, 2);
    assert.ok(responses.every((response) => response.ok));
  } finally {
    controller.dispose();
    await controller.waitForQuiescence();
  }
});

test("failed download-start response releases the transfer slot", async () => {
  const source = new MemoryFile("source.bin");
  source.data = Buffer.from("data");
  const root = new MemoryDirectory("Backup");
  root.children.set(source.name, source);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let failuresRemaining = 0;
  const sent: string[] = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new DOMException("send failed", "OperationError");
      }
      if (typeof message === "string") sent.push(message);
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(channel, root as unknown as FileSystemDirectoryHandle);
  const request = (id: string, operation: string, fields: Record<string, unknown>) => {
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
  };

  try {
    request("begin", "download_begin", { path: "/source.bin" });
    for (let attempt = 0; attempt < 100 && sent.length === 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    const begin = JSON.parse(sent.shift()!) as { result: { transferID: string } };
    failuresRemaining = 2;
    request("start", "download_start", { transferID: begin.result.transferID });
    await new Promise((resolve) => setImmediate(resolve));
    request("next-one", "download_begin", { path: "/source.bin" });
    request("next-two", "download_begin", { path: "/source.bin" });
    for (let attempt = 0; attempt < 100 && sent.length < 2; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 2);
    assert.ok(sent.every((value) => (JSON.parse(value) as { ok: boolean }).ok));
  } finally {
    controller.dispose();
    await controller.waitForQuiescence();
  }
});

test("duplicate download acknowledgements do not extend the idle deadline", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Set<object>();
  let scheduled = 0;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    void callback;
    const token = {};
    timers.add(token);
    scheduled += 1;
    return token;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    timers.delete(timer as unknown as object);
  }) as typeof globalThis.clearTimeout;
  const transferID = "00112233-4455-6677-8899-aabbccddeeff";
  const initialTimer = {};
  timers.add(initialTimer);
  const downloads = new Map<string, DownloadState>([[transferID, {
    file: Object.assign(new Blob(["x"]), { name: "x", lastModified: 0 }) as File,
    control: false,
    sentSize: 1,
    acknowledgedSize: 0,
    started: true,
    queuedControls: 0,
    idleTimer: initialTimer as ReturnType<typeof setTimeout>,
    cancelled: new Promise(() => {}),
    cancelRead: () => {},
  }]]);

  try {
    acceptDownloadAcknowledgement(downloads, new Set(), {
      transferID, receivedSize: 0,
    });
    assert.equal(scheduled, 0);
    assert.equal(downloads.get(transferID)?.idleTimer, initialTimer);

    acceptDownloadAcknowledgement(downloads, new Set(), {
      transferID, receivedSize: 1,
    });
    assert.equal(scheduled, 1);
    const progressTimer = downloads.get(transferID)?.idleTimer;

    acceptDownloadAcknowledgement(downloads, new Set(), {
      transferID, receivedSize: 1,
    });
    assert.equal(scheduled, 1);
    assert.equal(downloads.get(transferID)?.idleTimer, progressTimer);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("late download acknowledgement for an expired transfer is ignored", () => {
  assert.doesNotThrow(() => acceptDownloadAcknowledgement(new Map(), new Set(), {
    transferID: "00112233-4455-4677-8899-aabbccddeeff",
    receivedSize: 1,
  }));
});

test("download acknowledgement processing has a bounded per-second budget", () => {
  const budget = { windowStartedAt: 100, messages: 4_095 };
  assert.equal(consumeDownloadAcknowledgementBudget(budget, 999), true);
  assert.equal(consumeDownloadAcknowledgementBudget(budget, 999), false);
  assert.equal(consumeDownloadAcknowledgementBudget(budget, 1_100), true);
  assert.equal(budget.messages, 1);
});

test("authenticated filesystem node closes on an invalid request identifier", async () => {
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let closed = false;
  const channel = {
    readyState: "open",
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => { closed = true; },
  } as unknown as RTCDataChannel;
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const controller = installFileSystemNodeController(channel, root);
  messageHandler?.({ data: JSON.stringify({ type: "fs_request", id: "x".repeat(65), operation: "list", path: "/" }) } as MessageEvent);
  await Promise.resolve();
  assert.equal(closed, true);
  controller.dispose();
});

test("authenticated filesystem node closes on non-object JSON", () => {
  for (const value of [null, [], 1, "text"]) {
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    let closed = false;
    const channel = {
      readyState: "open",
      addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
        if (type === "message") messageHandler = handler;
      },
      removeEventListener: () => {},
      close: () => { closed = true; },
    } as unknown as RTCDataChannel;
    const controller = installFileSystemNodeController(
      channel,
      new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle
    );

    assert.doesNotThrow(() => messageHandler?.({ data: JSON.stringify(value) } as MessageEvent));
    assert.equal(closed, true);
    controller.dispose();
  }
});

test("authenticated filesystem node closes on a queued-request flood", async () => {
  let releaseList!: () => void;
  const listRelease = new Promise<void>((resolve) => { releaseList = resolve; });
  class BlockingListDirectory extends MemoryDirectory {
    override async *entries() {
      await listRelease;
      yield* super.entries();
    }
  }
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let closed = false;
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: () => {},
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => { closed = true; },
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(
    channel,
    new BlockingListDirectory("Backup") as unknown as FileSystemDirectoryHandle
  );
  const send = (id: string, operation: string) => messageHandler?.({ data: JSON.stringify({
    type: "fs_request", id, operation, path: "/",
  }) } as MessageEvent);

  try {
    send("blocking-list", "list");
    await Promise.resolve();
    for (let index = 0; index < 640; index += 1) send(`queued-${index}`, "metadata");
    assert.equal(closed, true);
  } finally {
    releaseList();
    await controller.waitForQuiescence();
  }
});

test("write-lock controls are not blocked by an ordinary filesystem request", async () => {
  let releaseList!: () => void;
  const listRelease = new Promise<void>((resolve) => { releaseList = resolve; });
  class BlockingListDirectory extends MemoryDirectory {
    override async *entries() {
      await listRelease;
      yield* super.entries();
    }
  }
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let lockResponseResolve!: () => void;
  const lockResponse = new Promise<void>((resolve) => { lockResponseResolve = resolve; });
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      if (typeof message !== "string") return;
      const response = JSON.parse(message) as { type?: string; id?: string; ok?: boolean };
      if (response.type === "fs_response" && response.id === "lock-directory" && response.ok) {
        lockResponseResolve();
      }
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(
    channel,
    new BlockingListDirectory("Backup") as unknown as FileSystemDirectoryHandle
  );

  try {
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "ordinary-list", operation: "list", path: "/",
    }) } as MessageEvent);
    await Promise.resolve();
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "lock-directory", operation: "create_directory", path: "/.watermelon/locks",
    }) } as MessageEvent);
    await Promise.race([
      lockResponse,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("lock request was blocked")), 500))
    ]);
  } finally {
    releaseList();
    await controller.waitForQuiescence();
  }
});

test("lock namespace mutations use the lock queue even for ancestors and noncanonical descendants", async () => {
  let releaseList!: () => void;
  const listRelease = new Promise<void>((resolve) => { releaseList = resolve; });
  class BlockingListDirectory extends MemoryDirectory {
    override async *entries() {
      await listRelease;
      yield* super.entries();
    }
  }
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const responses = new Map<string, () => void>();
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      if (typeof message !== "string") return;
      const response = JSON.parse(message) as { type?: string; id?: string };
      if (response.type === "fs_response" && response.id) responses.get(response.id)?.();
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(
    channel,
    new BlockingListDirectory("Backup") as unknown as FileSystemDirectoryHandle
  );
  const request = (id: string, operation: string, fields: Record<string, unknown>) => {
    const response = new Promise<void>((resolve) => responses.set(id, resolve));
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
    return response;
  };

  try {
    void request("ordinary-list", "list", { path: "/" });
    await Promise.resolve();
    await Promise.race([
      request("delete-ancestor", "delete", { path: "/.watermelon" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ancestor mutation was blocked")), 500))
    ]);
    await Promise.race([
      request("noncanonical-begin", "upload_begin", {
        transferID: "noncanonical",
        path: "/.watermelon/locks/manual.lock",
        mode: "replace",
        size: 0
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("descendant mutation was blocked")), 500))
    ]);
    await request("noncanonical-abort", "upload_abort", { transferID: "noncanonical" });
  } finally {
    releaseList();
    await controller.waitForQuiescence();
  }
});

test("directory listing reads file metadata with bounded concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  class DelayedFile extends MemoryFile {
    override async getFile() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await super.getFile();
      } finally {
        active -= 1;
      }
    }
  }
  const root = new MemoryDirectory("Backup", (name) => new DelayedFile(name));
  for (let index = 0; index < 80; index += 1) {
    await root.getFileHandle(`file-${index}`, { create: true });
  }

  const entries = await performOperation(
    root as unknown as FileSystemDirectoryHandle,
    new Map(),
    { operation: "list", path: "/" }
  ) as unknown[];

  assert.equal(entries.length, 80);
  assert.ok(maximumActive > 1);
  assert.ok(maximumActive <= 32);
});

test("browser node chunks large responses below data-channel message limits", async () => {
  const messages: string[] = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string) => messages.push(message),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as RTCDataChannel;

  await sendResponse(channel, "request", true, { value: "x".repeat(100_000) });
  const decoded = messages.map((message) => JSON.parse(message) as { type: string; index: number; total: number });
  assert.ok(decoded.length > 1);
  assert.ok(decoded.every((message) => message.type === "fs_response_part"));
  assert.deepEqual(decoded.map((message) => message.index), decoded.map((_, index) => index));
  assert.ok(decoded.every((message) => message.total === decoded.length));
});

test("large response backpressure rechecks capacity after listeners are installed", async () => {
  const listeners = new Map<string, EventListener>();
  let bufferedAmount = 300 * 1024;
  const channel = {
    readyState: "open",
    get bufferedAmount() { return bufferedAmount; },
    bufferedAmountLowThreshold: 0,
    send: () => {},
    addEventListener: (type: string, listener: EventListener) => {
      listeners.set(type, listener);
      bufferedAmount = 0;
    },
    removeEventListener: (type: string) => { listeners.delete(type); },
  } as unknown as RTCDataChannel;

  await sendResponse(channel, "request", true, { value: "x".repeat(100_000) });
  assert.equal(listeners.size, 0);
});

test("large response backpressure notices a close before listeners are installed", async () => {
  let readyState: RTCDataChannelState = "open";
  const channel = {
    get readyState() { return readyState; },
    bufferedAmount: 300 * 1024,
    bufferedAmountLowThreshold: 0,
    send: () => {},
    addEventListener: () => { readyState = "closed"; },
    removeEventListener: () => {},
  } as unknown as RTCDataChannel;

  await assert.rejects(
    sendResponse(channel, "request", true, { value: "x".repeat(100_000) }),
    /channel_closed/
  );
});

test("browser node accepts the protocol maximum 128 KiB upload chunk", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  const bytes = Buffer.alloc(128 * 1024, 0xa5);
  await performOperation(root, uploads, {
    operation: "upload_begin",
    transferID: "maximum",
    path: "/maximum.bin",
    mode: "replace",
    size: bytes.byteLength,
  });
  await uploadBytes(uploads, "maximum", bytes);
  await performOperation(root, uploads, { operation: "upload_finish", transferID: "maximum" });
  const metadata = await performOperation(root, uploads, { operation: "metadata", path: "/maximum.bin" }) as { size: number };
  assert.equal(metadata.size, bytes.byteLength);
});

test("authenticated node enforces the negotiated upload chunk size", async () => {
  const transferID = "00112233-4455-4677-8899-aabbccddeeff";
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const sent: string[] = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      if (typeof message === "string") sent.push(message);
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(
    channel,
    new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle,
    32 * 1024
  );

  try {
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request",
      id: "begin-negotiated",
      operation: "upload_begin",
      transferID,
      path: "/oversized.bin",
      mode: "replace",
      size: 64 * 1024,
    }) } as MessageEvent);
    for (let attempt = 0; attempt < 100 && sent.length === 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((JSON.parse(sent.shift()!) as { ok: boolean }).ok, true);
    messageHandler?.({ data: binaryUploadFrame(transferID, 0, Buffer.alloc(64 * 1024)) } as MessageEvent);
    for (let attempt = 0; attempt < 100 && sent.length === 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    const error = JSON.parse(sent.shift()!) as { type: string; error: string };
    assert.equal(error.type, "fs_upload_error");
    assert.equal(error.error, "invalid_range");
  } finally {
    controller.dispose();
    await controller.waitForQuiescence();
  }
});

test("binary upload frame has a fixed authenticated-stream header", () => {
  const transferID = "00112233-4455-6677-8899-aabbccddeeff";
  const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
  const encoded = binaryUploadFrame(transferID, 0x0102_0304, payload);
  assert.equal(Buffer.from(encoded).toString("base64"), "V01MAQARIjNEVWZ3iJmqu8zd7v8AAAAAAQIDBAAAAATerb7v");
  const decoded = decodeUploadFrame(encoded);
  assert.equal(decoded.transferID, transferID);
  assert.equal(decoded.offset, 0x0102_0304);
  assert.deepEqual(decoded.payload, payload);
  assert.throws(() => decodeUploadFrame(binaryUploadFrame(transferID, 0, new Uint8Array())), /invalid_request/);
});

test("binary download frame matches the iOS vector", () => {
  const encoded = encodeDownloadFrame(
    "00112233-4455-6677-8899-aabbccddeeff",
    0x0102_0304,
    Uint8Array.from([0xde, 0xad, 0xbe, 0xef])
  );
  assert.equal(Buffer.from(encoded).toString("base64"), "V01MAgARIjNEVWZ3iJmqu8zd7v8AAAAAAQIDBAAAAATerb7v");
});

test("download payload policy waits instead of creating a small nonfinal frame", () => {
  assert.equal(nextDownloadPayloadLength(63 * 1024, 1024, 63 * 1024), null);
  assert.equal(nextDownloadPayloadLength(128 * 1024, 1024, 128 * 1024), null);
  assert.equal(nextDownloadPayloadLength(1024, 1024, 63 * 1024), 1024);
  assert.equal(nextDownloadPayloadLength(64 * 1024, 63 * 1024, 63 * 1024), 63 * 1024);
  assert.equal(nextDownloadPayloadLength(63 * 1024, 63 * 1024, 63 * 1024), 63 * 1024);
});

test("data downloads leave an acknowledgement-window reserve for lock reads", () => {
  const dataLimit = 3 * 1024 * 1024 + 512 * 1024;
  assert.equal(availableDownloadWindowBytes(dataLimit, dataLimit, false), 0);
  assert.equal(availableDownloadWindowBytes(dataLimit, 0, true), 512 * 1024);
  assert.equal(availableDownloadWindowBytes(4 * 1024 * 1024, 0, true), 0);
});

test("authenticated node streams binary downloads with a shared acknowledgement window", async () => {
  const size = 4 * 1024 * 1024 + 17;
  const source = new MemoryFile("source.bin");
  source.data = Buffer.alloc(size, 0x5a);
  const root = new MemoryDirectory("Backup");
  root.children.set(source.name, source);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const sent: Array<string | ArrayBuffer> = [];
  const waiters: Array<(value: string | ArrayBuffer) => void> = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else sent.push(message);
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const nextSent = () => {
    const value = sent.shift();
    if (value !== undefined) return Promise.resolve(value);
    return new Promise<string | ArrayBuffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("download stream timeout")), 1_000);
      waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  };
  const controller = installFileSystemNodeController(
    channel,
    root as unknown as FileSystemDirectoryHandle,
    128 * 1024
  );

  try {
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "download-begin", operation: "download_begin", path: "/source.bin",
    }) } as MessageEvent);
    const beginMessage = await nextSent();
    assert.equal(typeof beginMessage, "string");
    const begin = JSON.parse(beginMessage as string) as {
      ok: boolean; result: { transferID: string; size: number };
    };
    assert.equal(begin.ok, true);
    assert.equal(begin.result.size, size);

    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "download-start", operation: "download_start", transferID: begin.result.transferID,
    }) } as MessageEvent);
    const startMessage = await nextSent();
    assert.equal(typeof startMessage, "string");
    assert.equal((JSON.parse(startMessage as string) as { ok: boolean }).ok, true);

    let received = 0;
    for (let index = 0; index < 28; index += 1) {
      const message = await nextSent();
      assert.ok(message instanceof ArrayBuffer);
      const view = new DataView(message);
      assert.deepEqual([...new Uint8Array(message, 0, 4)], [0x57, 0x4d, 0x4c, 0x02]);
      assert.equal(Number(view.getBigUint64(20, false)), received);
      const length = view.getUint32(28, false);
      assert.equal(length, 128 * 1024);
      assert.equal(message.byteLength, 32 + length);
      received += length;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(sent.length, 0);
    assert.equal(received, 3 * 1024 * 1024 + 512 * 1024);

    messageHandler?.({ data: JSON.stringify({
      type: "fs_download_ack", transferID: begin.result.transferID, receivedSize: received,
    }) } as MessageEvent);
    for (let index = 0; index < 4; index += 1) {
      const message = await nextSent();
      assert.ok(message instanceof ArrayBuffer);
      const view = new DataView(message);
      assert.equal(Number(view.getBigUint64(20, false)), received);
      assert.equal(view.getUint32(28, false), 128 * 1024);
      received += 128 * 1024;
    }
    const finalFrame = await nextSent();
    assert.ok(finalFrame instanceof ArrayBuffer);
    const finalView = new DataView(finalFrame);
    assert.equal(Number(finalView.getBigUint64(20, false)), received);
    assert.equal(finalView.getUint32(28, false), 17);
    received += 17;

    messageHandler?.({ data: JSON.stringify({
      type: "fs_download_ack", transferID: begin.result.transferID, receivedSize: received,
    }) } as MessageEvent);
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "download-finish", operation: "download_finish", transferID: begin.result.transferID,
    }) } as MessageEvent);
    const finishMessage = await nextSent();
    assert.equal(typeof finishMessage, "string");
    assert.equal((JSON.parse(finishMessage as string) as { ok: boolean }).ok, true);
  } finally {
    controller.dispose();
    await controller.waitForQuiescence();
  }
});

test("concurrent delayed reads reserve native send-buffer capacity before reading", async () => {
  const chunkBytes = 128 * 1024;
  const frameBytes = 32 + chunkBytes;
  let activeReads = 0;
  let maximumActiveReads = 0;
  const started: Array<() => void> = [];
  const releases: Array<() => void> = [];
  class DelayedReadFile extends MemoryFile {
    override async getFile() {
      const bytes = Buffer.alloc(chunkBytes, 0x5a);
      return {
        name: this.name,
        size: bytes.byteLength,
        lastModified: 0,
        slice: () => ({
          arrayBuffer: async () => {
            activeReads += 1;
            maximumActiveReads = Math.max(maximumActiveReads, activeReads);
            started.shift()?.();
            await new Promise<void>((resolve) => releases.push(resolve));
            activeReads -= 1;
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          },
        }),
      } as unknown as File;
    }
  }
  const root = new MemoryDirectory("Backup");
  root.children.set("one.bin", new DelayedReadFile("one.bin"));
  root.children.set("two.bin", new DelayedReadFile("two.bin"));
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const sent: Array<string | ArrayBuffer> = [];
  const channelListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let bufferedAmount = 0;
  const channel = {
    readyState: "open",
    get bufferedAmount() { return bufferedAmount; },
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      bufferedAmount += typeof message === "string" ? new TextEncoder().encode(message).byteLength : message.byteLength;
      sent.push(message);
    },
    addEventListener: (type: string, handler: (...args: unknown[]) => void) => {
      if (type === "message") messageHandler = handler as (event: MessageEvent) => void;
      else {
        const listeners = channelListeners.get(type) ?? new Set();
        listeners.add(handler);
        channelListeners.set(type, listeners);
      }
    },
    removeEventListener: (type: string, handler: (...args: unknown[]) => void) => {
      channelListeners.get(type)?.delete(handler);
    },
    close: () => {},
  } as unknown as RTCDataChannel;
  const drainNativeBuffer = () => {
    bufferedAmount = 0;
    for (const listener of [...channelListeners.get("bufferedamountlow") ?? []]) listener();
  };
  const nextJSON = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const index = sent.findIndex((value) => typeof value === "string");
      if (index >= 0) return JSON.parse(sent.splice(index, 1)[0] as string) as Record<string, any>;
      await Promise.resolve();
    }
    throw new Error("response timeout");
  };
  const sendRequest = (id: string, operation: string, fields: Record<string, unknown>) => {
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
  };
  const controller = installFileSystemNodeController(channel, root as unknown as FileSystemDirectoryHandle, chunkBytes);

  try {
    sendRequest("begin-one", "download_begin", { path: "/one.bin" });
    const one = await nextJSON() as { result: { transferID: string } };
    drainNativeBuffer();
    sendRequest("begin-two", "download_begin", { path: "/two.bin" });
    const two = await nextJSON() as { result: { transferID: string } };
    drainNativeBuffer();

    const firstStarted = new Promise<void>((resolve) => started.push(resolve));
    sendRequest("start-one", "download_start", { transferID: one.result.transferID });
    await nextJSON();
    assert.equal(activeReads, 0);
    drainNativeBuffer();
    await firstStarted;
    sendRequest("metadata-while-read", "metadata", { path: "/one.bin" });
    const metadata = await nextJSON();
    assert.equal(metadata.id, "metadata-while-read");
    assert.equal(metadata.ok, true);
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(sent.some((value) => value instanceof ArrayBuffer), false);
    drainNativeBuffer();
    for (let attempt = 0; attempt < 100 && !sent.some((value) => value instanceof ArrayBuffer); attempt += 1) {
      await Promise.resolve();
    }
    const firstFrame = sent.findIndex((value) => value instanceof ArrayBuffer);
    assert.notEqual(firstFrame, -1);
    sent.splice(firstFrame, 1);

    const secondStarted = new Promise<void>((resolve) => started.push(resolve));
    sendRequest("start-two", "download_start", { transferID: two.result.transferID });
    await nextJSON();
    assert.equal(activeReads, 0);
    drainNativeBuffer();
    await secondStarted;
    assert.equal(maximumActiveReads, 1);
    releases.shift()?.();
    await Promise.resolve();
  } finally {
    controller.dispose();
    await controller.waitForQuiescence();
  }
});

test("download idle expiry cancels native-buffer backpressure and quiesces", async () => {
  const source = new MemoryFile("source.bin");
  source.data = Buffer.from("x");
  const root = new MemoryDirectory("Backup");
  root.children.set(source.name, source);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const sent: Array<string | ArrayBuffer> = [];
  const sentWaiters: Array<(value: string | ArrayBuffer) => void> = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let closeCount = 0;
  let bufferedAmount = 0;
  const channel = {
    readyState: "open",
    get bufferedAmount() { return bufferedAmount; },
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      const waiter = sentWaiters.shift();
      if (waiter) waiter(message);
      else sent.push(message);
    },
    addEventListener: (type: string, handler: (...args: unknown[]) => void) => {
      if (type === "message") messageHandler = handler as (event: MessageEvent) => void;
      else {
        const values = listeners.get(type) ?? new Set();
        values.add(handler);
        listeners.set(type, values);
      }
    },
    removeEventListener: (type: string, handler: (...args: unknown[]) => void) => {
      listeners.get(type)?.delete(handler);
    },
    close: () => { closeCount += 1; },
  } as unknown as RTCDataChannel;
  const nextSent = () => {
    const value = sent.shift();
    return value !== undefined
      ? Promise.resolve(value)
      : new Promise<string | ArrayBuffer>((resolve) => sentWaiters.push(resolve));
  };
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map<object, () => void>();
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    const token = {};
    timers.set(token, () => callback());
    return token;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    timers.delete(timer as unknown as object);
  }) as typeof globalThis.clearTimeout;
  const controller = installFileSystemNodeController(
    channel,
    root as unknown as FileSystemDirectoryHandle,
    128 * 1024
  );

  try {
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "idle-begin", operation: "download_begin", path: "/source.bin",
    }) } as MessageEvent);
    const begin = JSON.parse(await nextSent() as string) as { result: { transferID: string } };
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "idle-start", operation: "download_start", transferID: begin.result.transferID,
    }) } as MessageEvent);
    await nextSent();
    bufferedAmount = 5 * 1024 * 1024;
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(listeners.get("bufferedamountlow")?.size, 1);
    assert.equal(listeners.get("close")?.size, 1);
    assert.equal(timers.size, 2);

    [...timers.values()].forEach((fire) => fire());
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(sent.some((value) => typeof value === "string" &&
      (JSON.parse(value) as { type?: string; error?: string }).type === "fs_download_error" &&
      (JSON.parse(value) as { error?: string }).error === "transfer_timeout"));
    assert.equal(closeCount, 0);
    assert.equal(listeners.get("bufferedamountlow")?.size ?? 0, 0);
    assert.equal(listeners.get("close")?.size ?? 0, 0);
    await controller.waitForQuiescence();
  } finally {
    controller.dispose();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("download timeout holds quiescence until the underlying file read settles", async () => {
  const stalled = new ReleasableReadFile("stalled.bin");
  const root = new MemoryDirectory("Backup");
  root.children.set(stalled.name, stalled);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let closed = false;
  const sent: string[] = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      if (typeof message === "string") sent.push(message);
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => { closed = true; },
  } as unknown as RTCDataChannel;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map<object, () => void>();
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    const token = {};
    timers.set(token, () => callback());
    return token;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    timers.delete(timer as unknown as object);
  }) as typeof globalThis.clearTimeout;
  const controller = installFileSystemNodeController(channel, root as unknown as FileSystemDirectoryHandle);
  const sendRequest = (id: string, operation: string, fields: Record<string, unknown>) => {
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
  };

  try {
    sendRequest("stalled-begin", "download_begin", { path: "/stalled.bin" });
    for (let attempt = 0; attempt < 100 && sent.length === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const begin = JSON.parse(sent.shift()!) as { result: { transferID: string } };
    sendRequest("stalled-start", "download_start", { transferID: begin.result.transferID });
    for (let attempt = 0; attempt < 100 && sent.length === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal((JSON.parse(sent.shift()!) as { ok: boolean }).ok, true);
    await Promise.resolve();

    [...timers.values()].forEach((fire) => fire());
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(closed, false);
    assert.ok(sent.some((value) =>
      (JSON.parse(value) as { type?: string; error?: string }).type === "fs_download_error" &&
      (JSON.parse(value) as { error?: string }).error === "transfer_timeout"
    ));
    let quiesced = false;
    const waiting = controller.waitForQuiescence().then(() => { quiesced = true; });
    await Promise.resolve();
    assert.equal(quiesced, false);
    stalled.releaseNextRead();
    await waiting;
    assert.equal(quiesced, true);
  } finally {
    controller.dispose();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("filesystem-node disposal retains quiescence until the native read settles", async () => {
  const stalled = new ReleasableReadFile("stalled.bin");
  const root = new MemoryDirectory("Backup");
  root.children.set(stalled.name, stalled);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const sent: string[] = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      if (typeof message === "string") sent.push(message);
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(channel, root as unknown as FileSystemDirectoryHandle);
  const sendRequest = (id: string, operation: string, fields: Record<string, unknown>) => {
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
  };

  sendRequest("dispose-begin", "download_begin", { path: "/stalled.bin" });
  for (let attempt = 0; attempt < 100 && sent.length === 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  const begin = JSON.parse(sent.shift()!) as { result: { transferID: string } };
  sendRequest("dispose-start", "download_start", { transferID: begin.result.transferID });
  for (let attempt = 0; attempt < 100 && sent.length === 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  controller.dispose();
  let quiesced = false;
  const waiting = controller.waitForQuiescence().then(() => { quiesced = true; });
  await Promise.resolve();
  assert.equal(quiesced, false);
  stalled.releaseNextRead();
  await waiting;
  assert.equal(quiesced, true);
});

test("an explicitly aborted stalled read blocks native reads until the underlying read settles", async () => {
  const stalled = new ReleasableReadFile("stalled.bin");
  const root = new MemoryDirectory("Backup");
  root.children.set(stalled.name, stalled);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const sent: string[] = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      if (typeof message === "string") sent.push(message);
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(channel, root as unknown as FileSystemDirectoryHandle);
  const sendRequest = (id: string, operation: string, fields: Record<string, unknown>) => {
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
  };
  const nextResponse = async () => {
    for (let attempt = 0; attempt < 100 && sent.length === 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    return JSON.parse(sent.shift()!) as { ok: boolean; error?: string; result?: { transferID: string } };
  };

  try {
    sendRequest("orphan-begin", "download_begin", { path: "/stalled.bin" });
    const begin = await nextResponse();
    sendRequest("orphan-start", "download_start", { transferID: begin.result!.transferID });
    assert.equal((await nextResponse()).ok, true);
    for (let attempt = 0; attempt < 100 && stalled.readCount === 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stalled.readCount, 1);

    sendRequest("orphan-abort", "download_abort", { transferID: begin.result!.transferID });
    assert.equal((await nextResponse()).ok, true);
    sendRequest("orphan-retry", "download_begin", { path: "/stalled.bin" });
    const retry = await nextResponse();
    assert.equal(retry.ok, false);
    assert.equal(retry.error, "too_many_transfers");
    assert.equal(stalled.readCount, 1);

    stalled.releaseNextRead();
    await new Promise((resolve) => setImmediate(resolve));
    sendRequest("orphan-recovered", "download_begin", { path: "/stalled.bin" });
    const recovered = await nextResponse();
    assert.equal(recovered.ok, true);
  } finally {
    controller.dispose();
    await controller.waitForQuiescence();
  }
});

test("queued download start and finish suspend the idle deadline", async () => {
  const blockedStart = new SlowCloseFile("blocked-start.bin");
  const blockedFinish = new SlowCloseFile("blocked-finish.bin");
  const root = new MemoryDirectory("Backup", (name) => {
    if (name === blockedStart.name) return blockedStart;
    if (name === blockedFinish.name) return blockedFinish;
    return new MemoryFile(name);
  });
  const source = new MemoryFile("source.bin");
  source.data = Buffer.from("x");
  root.children.set(source.name, source);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const sent: Array<string | ArrayBuffer> = [];
  const sentWaiters: Array<(value: string | ArrayBuffer) => void> = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      const waiter = sentWaiters.shift();
      if (waiter) waiter(message);
      else sent.push(message);
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const nextSent = () => {
    const value = sent.shift();
    return value !== undefined
      ? Promise.resolve(value)
      : new Promise<string | ArrayBuffer>((resolve) => sentWaiters.push(resolve));
  };
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Set<object>();
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    void callback;
    const token = {};
    timers.add(token);
    return token;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    timers.delete(timer as unknown as object);
  }) as typeof globalThis.clearTimeout;
  const controller = installFileSystemNodeController(channel, root as unknown as FileSystemDirectoryHandle, 128 * 1024);

  try {
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "queued-begin", operation: "download_begin", path: "/source.bin",
    }) } as MessageEvent);
    const begin = JSON.parse(await nextSent() as string) as { result: { transferID: string } };
    await Promise.resolve();
    assert.equal(timers.size, 1);

    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "copy-start", operation: "copy",
      sourcePath: "/source.bin", destinationPath: `/${blockedStart.name}`,
    }) } as MessageEvent);
    await blockedStart.closeStarted;
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "queued-start", operation: "download_start", transferID: begin.result.transferID,
    }) } as MessageEvent);
    assert.equal(timers.size, 0);
    blockedStart.releaseClose();
    await nextSent();
    await nextSent();
    const frame = await nextSent();
    assert.ok(frame instanceof ArrayBuffer);

    messageHandler?.({ data: JSON.stringify({
      type: "fs_download_ack", transferID: begin.result.transferID, receivedSize: 1,
    }) } as MessageEvent);
    assert.equal(timers.size, 1);
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "copy-finish", operation: "copy",
      sourcePath: "/source.bin", destinationPath: `/${blockedFinish.name}`,
    }) } as MessageEvent);
    await blockedFinish.closeStarted;
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request", id: "queued-finish", operation: "download_finish", transferID: begin.result.transferID,
    }) } as MessageEvent);
    assert.equal(timers.size, 0);
    blockedFinish.releaseClose();
    await nextSent();
    const finish = JSON.parse(await nextSent() as string) as { ok: boolean };
    assert.equal(finish.ok, true);
  } finally {
    blockedStart.releaseClose();
    blockedFinish.releaseClose();
    controller.dispose();
    await controller.waitForQuiescence();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("browser batches four 128 KiB frames into one writable write and cumulative acknowledgement", async () => {
  let file: MemoryFile | undefined;
  const root = new MemoryDirectory("Backup", (name) => {
    file = new MemoryFile(name);
    return file;
  }) as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  const transferID = "00112233-4455-6677-8899-aabbccddeeff";
  await performOperation(root, uploads, {
    operation: "upload_begin", transferID, path: "/batch.bin", mode: "replace", size: 2 * 1024 * 1024,
  });
  let acknowledgement: number | null = null;
  for (let index = 0; index < 4; index += 1) {
    acknowledgement = await uploadBytes(uploads, transferID, Buffer.alloc(128 * 1024, index));
    if (index < 3) assert.equal(acknowledgement, null);
  }
  assert.equal(acknowledgement, 512 * 1024);
  assert.equal(file!.writeCount, 1);
  await performOperation(root, uploads, { operation: "upload_abort", transferID });
});

test("four interleaved data uploads each acknowledge within the shared phone window", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  const transferIDs = [
    "00112233-4455-6677-8899-aabbccddeeff",
    "10213243-5465-7687-98a9-bacbdcedfe0f",
    "20314253-6475-8697-a8b9-cadbecfd0e1f",
    "30415263-7485-96a7-b8c9-daebfc0d1e2f",
  ];
  for (const [index, transferID] of transferIDs.entries()) {
    await performOperation(root, uploads, {
      operation: "upload_begin",
      transferID,
      path: `/interleaved-${index}.bin`,
      mode: "replace",
      size: 2 * 1024 * 1024,
    });
  }
  const acknowledgements = new Map<string, number>();
  for (let frame = 0; frame < 4; frame += 1) {
    for (const transferID of transferIDs) {
      const acknowledgement = await uploadBytes(
        uploads,
        transferID,
        Buffer.alloc(128 * 1024, frame)
      );
      if (acknowledgement !== null) acknowledgements.set(transferID, acknowledgement);
    }
  }
  assert.deepEqual([...acknowledgements.values()], transferIDs.map(() => 512 * 1024));
  await Promise.all(transferIDs.map((transferID) =>
    performOperation(root, uploads, { operation: "upload_abort", transferID })
  ));
});

test("authenticated node accepts binary frames and emits a cumulative upload acknowledgement", async () => {
  let file: MemoryFile | undefined;
  const root = new MemoryDirectory("Backup", (name) => {
    file = new MemoryFile(name);
    return file;
  }) as unknown as FileSystemDirectoryHandle;
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let beginResponseResolve!: () => void;
  let acknowledgementResolve!: (value: number) => void;
  const beginResponse = new Promise<void>((resolve) => { beginResponseResolve = resolve; });
  const acknowledgement = new Promise<number>((resolve) => { acknowledgementResolve = resolve; });
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string) => {
      const value = JSON.parse(message) as { type: string; operation?: string; receivedSize?: number };
      if (value.type === "fs_response") beginResponseResolve();
      if (value.type === "fs_upload_ack") acknowledgementResolve(value.receivedSize!);
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(channel, root);
  const transferID = "00112233-4455-6677-8899-aabbccddeeff";
  messageHandler?.({ data: JSON.stringify({
    type: "fs_request",
    id: "begin-request",
    operation: "upload_begin",
    transferID,
    path: "/binary.bin",
    mode: "replace",
    size: 512 * 1024
  }) } as MessageEvent);
  await beginResponse;
  for (let index = 0; index < 4; index += 1) {
    messageHandler?.({ data: binaryUploadFrame(
      transferID,
      index * 128 * 1024,
      Buffer.alloc(128 * 1024, index)
    ) } as MessageEvent);
  }
  assert.equal(await acknowledgement, 512 * 1024);
  assert.equal(file!.writeCount, 1);
  controller.dispose();
});

test("authenticated node writes two upload streams concurrently", async () => {
  const files: SlowWriteFile[] = [];
  const root = new MemoryDirectory("Backup", (name) => {
    const file = new SlowWriteFile(name);
    files.push(file);
    return file;
  }) as unknown as FileSystemDirectoryHandle;
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let beginResponses = 0;
  let beginResolve!: () => void;
  let acknowledgements = 0;
  let acknowledgementsResolve!: () => void;
  const bothBegun = new Promise<void>((resolve) => { beginResolve = resolve; });
  const bothAcknowledged = new Promise<void>((resolve) => { acknowledgementsResolve = resolve; });
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string) => {
      const value = JSON.parse(message) as { type: string };
      if (value.type === "fs_response" && ++beginResponses === 2) beginResolve();
      if (value.type === "fs_upload_ack" && ++acknowledgements === 2) acknowledgementsResolve();
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(channel, root);
  const firstID = "00112233-4455-6677-8899-aabbccddeeff";
  const secondID = "10213243-5465-7687-98a9-bacbdcedfe0f";
  for (const [index, transferID] of [firstID, secondID].entries()) {
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request",
      id: `begin-${index}`,
      operation: "upload_begin",
      transferID,
      path: `/parallel-${index}.bin`,
      mode: "replace",
      size: 1
    }) } as MessageEvent);
  }
  await bothBegun;
  messageHandler?.({ data: binaryUploadFrame(firstID, 0, Buffer.from("a")) } as MessageEvent);
  messageHandler?.({ data: binaryUploadFrame(secondID, 0, Buffer.from("b")) } as MessageEvent);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("upload writes stayed serialized")), 250);
  });
  try {
    await Promise.race([Promise.all(files.map((file) => file.writeStarted)), timeout]);
    files.forEach((file) => file.releaseWrite());
    await bothAcknowledged;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    files.forEach((file) => file.releaseWrite());
    controller.dispose();
  }
});

test("unrelated slow control operations do not block an active upload stream", async () => {
  const slowDestination = new SlowCloseFile("blocked.bin");
  const rootDirectory = new MemoryDirectory("Backup", (name) =>
    name === "blocked.bin" ? slowDestination : new MemoryFile(name));
  const source = new MemoryFile("source.bin");
  source.data = Buffer.from("source");
  rootDirectory.children.set(source.name, source);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const responseResolvers = new Map<string, () => void>();
  let acknowledgementResolve!: () => void;
  const acknowledgement = new Promise<void>((resolve) => { acknowledgementResolve = resolve; });
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string) => {
      const value = JSON.parse(message) as { type: string; id?: string };
      if (value.type === "fs_response" && value.id) responseResolvers.get(value.id)?.();
      if (value.type === "fs_upload_ack") acknowledgementResolve();
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(
    channel,
    rootDirectory as unknown as FileSystemDirectoryHandle
  );
  const transferID = "00112233-4455-6677-8899-aabbccddeeff";
  const request = async (id: string, operation: string, fields: Record<string, unknown>) => {
    const response = new Promise<void>((resolve) => { responseResolvers.set(id, resolve); });
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
    await response;
  };

  try {
    await request("begin", "upload_begin", {
      transferID, path: "/upload.bin", mode: "replace", size: 1,
    });
    const copying = request("copy", "copy", {
      sourcePath: "/source.bin", destinationPath: "/blocked.bin",
    });
    await slowDestination.closeStarted;
    messageHandler?.({ data: binaryUploadFrame(transferID, 0, Buffer.from("x")) } as MessageEvent);
    await acknowledgement;
    slowDestination.releaseClose();
    await copying;
  } finally {
    slowDestination.releaseClose();
    controller.dispose();
  }
});

test("browser node rejects oversized chunks and unknown upload modes", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  await assert.rejects(performOperation(root, uploads, {
    operation: "upload_begin", transferID: "bad-mode", path: "/bad.bin", mode: "unknown", size: 1,
  }), /invalid_request/);
  await performOperation(root, uploads, {
    operation: "upload_begin", transferID: "oversized", path: "/oversized.bin", mode: "replace", size: 128 * 1024 + 1,
  });
  await assert.rejects(
    uploadBytes(uploads, "oversized", Buffer.alloc(128 * 1024 + 1)),
    /invalid_range/
  );
  await performOperation(root, uploads, { operation: "upload_abort", transferID: "oversized" });
});

test("browser node rejects transfers above the phone download boundary", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  await assert.rejects(performOperation(root, uploads, {
    operation: "upload_begin",
    transferID: "too-large",
    path: "/too-large.bin",
    mode: "replace",
    size: 64 * 1024 * 1024 * 1024 + 1,
  }), /invalid_size/);
});

test("browser node rejects out-of-order, repeated, and overflowing upload frames", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  await performOperation(root, uploads, {
    operation: "upload_begin", transferID: "ordered", path: "/ordered.bin", mode: "replace", size: 8_194,
  });

  await assert.rejects(
    acceptUploadFrame(uploads, { transferID: "ordered", offset: 1, payload: Buffer.alloc(8_192) }),
    /invalid_range/
  );
  await acceptUploadFrame(uploads, { transferID: "ordered", offset: 0, payload: Buffer.alloc(8_192) });
  await assert.rejects(
    acceptUploadFrame(uploads, { transferID: "ordered", offset: 0, payload: Buffer.from("a") }),
    /invalid_range/
  );
  await assert.rejects(
    acceptUploadFrame(uploads, { transferID: "ordered", offset: 8_193, payload: Buffer.from("c") }),
    /invalid_range/
  );
  await assert.rejects(
    acceptUploadFrame(uploads, { transferID: "ordered", offset: 8_192, payload: Buffer.from("cde") }),
    /invalid_range/
  );

  await performOperation(root, uploads, { operation: "upload_abort", transferID: "ordered" });
});

test("browser node rejects tiny non-final upload frames but accepts a tiny final frame", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  await performOperation(root, uploads, {
    operation: "upload_begin", transferID: "tiny", path: "/tiny.bin", mode: "replace", size: 8_193,
  });

  await assert.rejects(
    acceptUploadFrame(uploads, { transferID: "tiny", offset: 0, payload: Buffer.from("a") }),
    /invalid_range/
  );
  await acceptUploadFrame(uploads, { transferID: "tiny", offset: 0, payload: Buffer.alloc(8_192) });
  await acceptUploadFrame(uploads, { transferID: "tiny", offset: 8_192, payload: Buffer.from("a") });
  await performOperation(root, uploads, { operation: "upload_finish", transferID: "tiny" });
});

test("upload finish disarms the idle timeout before awaiting a slow close", async () => {
  let slowFile: SlowCloseFile | undefined;
  const rootDirectory = new MemoryDirectory("Backup", (name) => {
    slowFile = new SlowCloseFile(name);
    return slowFile;
  });
  const root = rootDirectory as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const activeTimers = new Set<object>();
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    void callback;
    const token = {};
    activeTimers.add(token);
    return token;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    activeTimers.delete(timer as unknown as object);
  }) as typeof globalThis.clearTimeout;

  try {
    await performOperation(root, uploads, {
      operation: "upload_begin", transferID: "slow", path: "/slow.bin", mode: "replace", size: 1,
    });
    assert.equal(activeTimers.size, 1);
    await uploadBytes(uploads, "slow", Buffer.from("x"));
    assert.equal(activeTimers.size, 1);
    const finishing = performOperation(root, uploads, { operation: "upload_finish", transferID: "slow" });
    await slowFile!.closeStarted;
    assert.equal(activeTimers.size, 0);
    assert.equal(slowFile!.abortCount, 0);
    slowFile!.releaseClose();
    await finishing;
    assert.equal((await slowFile!.getFile()).size, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    slowFile?.releaseClose();
  }
});

test("upload idle timeout stays disarmed while a writable write is in flight", async () => {
  let slowFile: SlowWriteFile | undefined;
  const root = new MemoryDirectory("Backup", (name) => {
    slowFile = new SlowWriteFile(name);
    return slowFile;
  }) as unknown as FileSystemDirectoryHandle;
  const uploads = new Map<string, UploadState>();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const activeTimers = new Set<object>();
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    void callback;
    const token = {};
    activeTimers.add(token);
    return token;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    activeTimers.delete(timer as unknown as object);
  }) as typeof globalThis.clearTimeout;

  try {
    await performOperation(root, uploads, {
      operation: "upload_begin", transferID: "slow-write", path: "/slow-write.bin", mode: "replace", size: 1,
    });
    assert.equal(activeTimers.size, 1);
    const writing = uploadBytes(uploads, "slow-write", Buffer.from("x"));
    await slowFile!.writeStarted;
    assert.equal(activeTimers.size, 0);
    assert.equal(slowFile!.abortCount, 0);
    slowFile!.releaseWrite();
    await writing;
    assert.equal(activeTimers.size, 1);
    await performOperation(root, uploads, { operation: "upload_finish", transferID: "slow-write" });
  } finally {
    slowFile?.releaseWrite();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("upload finish waits for a received frame that is still being written", async () => {
  const slowFile = new SlowWriteFile("barrier.bin");
  const root = new MemoryDirectory("Backup", () => slowFile);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const responses = new Map<string, () => void>();
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string) => {
      const value = JSON.parse(message) as { type: string; id?: string };
      if (value.type === "fs_response" && value.id) responses.get(value.id)?.();
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(channel, root as unknown as FileSystemDirectoryHandle);
  const transferID = "00112233-4455-6677-8899-aabbccddeeff";
  const request = (id: string, operation: string, fields: Record<string, unknown>) => {
    const response = new Promise<void>((resolve) => responses.set(id, resolve));
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
    return response;
  };

  try {
    await request("begin", "upload_begin", {
      transferID, path: "/barrier.bin", mode: "replace", size: 1,
    });
    messageHandler?.({ data: binaryUploadFrame(transferID, 0, Buffer.from("x")) } as MessageEvent);
    await slowFile.writeStarted;
    let finished = false;
    const finish = request("finish", "upload_finish", { transferID }).then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    slowFile.releaseWrite();
    await finish;
    assert.equal((await slowFile.getFile()).size, 1);
  } finally {
    slowFile.releaseWrite();
    controller.dispose();
    await controller.waitForQuiescence();
  }
});

test("upload finish rejects frames received after the terminal barrier", async () => {
  const slowDestination = new SlowCloseFile("blocked.bin");
  const root = new MemoryDirectory("Backup", (name) =>
    name === slowDestination.name ? slowDestination : new MemoryFile(name));
  const source = new MemoryFile("source.bin");
  source.data = Buffer.from("source");
  root.children.set(source.name, source);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const responses = new Map<string, () => void>();
  let closed = false;
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string) => {
      const value = JSON.parse(message) as { type: string; id?: string };
      if (value.type === "fs_response" && value.id) responses.get(value.id)?.();
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => { closed = true; },
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(channel, root as unknown as FileSystemDirectoryHandle);
  const transferID = "00112233-4455-6677-8899-aabbccddeeff";
  const sendRequest = (id: string, operation: string, fields: Record<string, unknown>) => {
    const response = new Promise<void>((resolve) => responses.set(id, resolve));
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
    return response;
  };

  try {
    await sendRequest("begin", "upload_begin", {
      transferID, path: "/upload.bin", mode: "replace", size: 1,
    });
    void sendRequest("copy", "copy", {
      sourcePath: "/source.bin", destinationPath: "/blocked.bin",
    });
    await slowDestination.closeStarted;
    void sendRequest("finish", "upload_finish", { transferID });
    messageHandler?.({ data: binaryUploadFrame(transferID, 0, Buffer.from("x")) } as MessageEvent);
    assert.equal(closed, true);
  } finally {
    slowDestination.releaseClose();
    controller.dispose();
    await controller.waitForQuiescence();
  }
});

test("queued upload finish keeps idle timeout disarmed behind a slow control operation", async () => {
  const slowDestination = new SlowCloseFile("blocked.bin");
  const rootDirectory = new MemoryDirectory("Backup", (name) =>
    name === "blocked.bin" ? slowDestination : new MemoryFile(name));
  const source = new MemoryFile("source.bin");
  source.data = Buffer.from("source");
  rootDirectory.children.set(source.name, source);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const responseResolvers = new Map<string, () => void>();
  let acknowledgementResolve!: () => void;
  const acknowledgement = new Promise<void>((resolve) => { acknowledgementResolve = resolve; });
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string) => {
      const value = JSON.parse(message) as { type: string; id?: string };
      if (value.type === "fs_response" && value.id) responseResolvers.get(value.id)?.();
      if (value.type === "fs_upload_ack") acknowledgementResolve();
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
    close: () => {},
  } as unknown as RTCDataChannel;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const activeTimers = new Set<object>();
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    void callback;
    const token = {};
    activeTimers.add(token);
    return token;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    activeTimers.delete(timer as unknown as object);
  }) as typeof globalThis.clearTimeout;
  const controller = installFileSystemNodeController(
    channel,
    rootDirectory as unknown as FileSystemDirectoryHandle
  );
  const transferID = "00112233-4455-6677-8899-aabbccddeeff";
  const request = async (id: string, operation: string, fields: Record<string, unknown>) => {
    const response = new Promise<void>((resolve) => { responseResolvers.set(id, resolve); });
    messageHandler?.({ data: JSON.stringify({ type: "fs_request", id, operation, ...fields }) } as MessageEvent);
    await response;
  };

  try {
    await request("begin", "upload_begin", {
      transferID, path: "/upload.bin", mode: "replace", size: 1,
    });
    messageHandler?.({ data: binaryUploadFrame(transferID, 0, Buffer.from("x")) } as MessageEvent);
    await acknowledgement;
    assert.equal(activeTimers.size, 1);
    const copying = request("copy", "copy", {
      sourcePath: "/source.bin", destinationPath: "/blocked.bin",
    });
    await slowDestination.closeStarted;
    const finishing = request("finish", "upload_finish", { transferID });
    assert.equal(activeTimers.size, 0);
    slowDestination.releaseClose();
    await copying;
    await finishing;
  } finally {
    slowDestination.releaseClose();
    controller.dispose();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("filesystem node quiescence waits for an in-flight copy commit", async () => {
  const slowDestination = new SlowCloseFile("destination.bin");
  const rootDirectory = new MemoryDirectory("Backup", () => slowDestination);
  const source = new MemoryFile("source.bin");
  source.data = new TextEncoder().encode("source");
  rootDirectory.children.set(source.name, source);
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const channel = {
    readyState: "open",
    send: () => {},
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(
    channel,
    rootDirectory as unknown as FileSystemDirectoryHandle
  );

  messageHandler?.({
    data: JSON.stringify({
      type: "fs_request",
      id: "copy-request",
      operation: "copy",
      sourcePath: "/source.bin",
      destinationPath: "/destination.bin"
    })
  } as MessageEvent);
  await slowDestination.closeStarted;
  let quiesced = false;
  const waiting = controller.waitForQuiescence().then(() => { quiesced = true; });
  await Promise.resolve();
  assert.equal(quiesced, false);
  slowDestination.releaseClose();
  await waiting;
  assert.equal(quiesced, true);
  assert.equal(new TextDecoder().decode(slowDestination.data), "source");
});

test("filesystem node quiescence waits for upload cleanup already started by the idle timer", async () => {
  let slowFile: SlowAbortFile | undefined;
  const rootDirectory = new MemoryDirectory("Backup", (name) => {
    slowFile = new SlowAbortFile(name);
    return slowFile;
  });
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let responseSentResolve!: () => void;
  const responseSent = new Promise<void>((resolve) => { responseSentResolve = resolve; });
  const sent: string[] = [];
  let rejectTimeoutNotification = false;
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (message: string | ArrayBuffer) => {
      if (typeof message === "string") sent.push(message);
      responseSentResolve();
      if (rejectTimeoutNotification && typeof message === "string" &&
          (JSON.parse(message) as { type?: string }).type === "fs_upload_error") {
        throw new Error("send failed");
      }
    },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
  } as unknown as RTCDataChannel;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const fakeTimer = {} as ReturnType<typeof setTimeout>;
  let idleCallback: (() => void) | undefined;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    idleCallback = () => callback();
    return fakeTimer;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout;
  const controller = installFileSystemNodeController(
    channel,
    rootDirectory as unknown as FileSystemDirectoryHandle
  );

  try {
    messageHandler?.({
      data: JSON.stringify({
        type: "fs_request",
        id: "idle-abort",
        operation: "upload_begin",
        transferID: "pending",
        path: "/pending.bin",
        mode: "replace",
        size: 1
      })
    } as MessageEvent);
    await responseSent;
    rejectTimeoutNotification = true;
    idleCallback?.();
    await slowFile!.abortStarted;
    assert.ok(sent.some((message) => {
      const parsed = JSON.parse(message) as { type?: string; error?: string };
      return parsed.type === "fs_upload_error" && parsed.error === "transfer_timeout";
    }));
    let quiesced = false;
    const waiting = controller.waitForQuiescence().then(() => { quiesced = true; });
    await Promise.resolve();
    assert.equal(quiesced, false);
    slowFile!.releaseAbort();
    await waiting;
    assert.equal(quiesced, true);
    assert.equal(rootDirectory.children.has("pending.bin"), false);
  } finally {
    slowFile?.releaseAbort();
    controller.dispose();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("a failed upload-begin response rolls back the staged file immediately", async () => {
  let slowFile: SlowAbortFile | undefined;
  let fileCreatedResolve!: () => void;
  const fileCreated = new Promise<void>((resolve) => { fileCreatedResolve = resolve; });
  const rootDirectory = new MemoryDirectory("Backup", (name) => {
    slowFile = new SlowAbortFile(name);
    fileCreatedResolve();
    return slowFile;
  });
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: () => { throw new Error("send failed"); },
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
  } as unknown as RTCDataChannel;
  const controller = installFileSystemNodeController(
    channel,
    rootDirectory as unknown as FileSystemDirectoryHandle
  );

  try {
    messageHandler?.({ data: JSON.stringify({
      type: "fs_request",
      id: "failed-begin",
      operation: "upload_begin",
      transferID: "failed-response",
      path: "/failed.bin",
      mode: "create_if_absent",
      size: 1
    }) } as MessageEvent);
    await fileCreated;
    await slowFile!.abortStarted;
    assert.equal(rootDirectory.children.has("failed.bin"), true);
    slowFile!.releaseAbort();
    await controller.waitForQuiescence();
    assert.equal(rootDirectory.children.has("failed.bin"), false);
  } finally {
    slowFile?.releaseAbort();
    controller.dispose();
  }
});
