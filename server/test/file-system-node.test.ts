import assert from "node:assert/strict";
import test from "node:test";
import { performOperation } from "../../web/src/file-system-node.js";

class MemoryFile {
  readonly kind = "file";
  data = new Uint8Array();

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

  constructor(readonly name: string) {}

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.children.get(name);
    if (existing?.kind === "file") return existing;
    if (existing) throw new DOMException("Wrong entry type", "TypeMismatchError");
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const file = new MemoryFile(name);
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

test("browser node writes, reads, moves, and deletes files inside the selected root", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root, uploads, { operation, ...fields });

  await request("create_directory", { path: "/Photos" });
  assert.equal((await request("metadata", { path: "/Photos" }) as { isDirectory: boolean }).isDirectory, true);
  await request("upload_begin", { transferID: "one", path: "/Photos/a.bin", mode: "create_if_absent", size: 5 });
  await request("upload_chunk", { transferID: "one", data: Buffer.from("hello").toString("base64") });
  await request("upload_finish", { transferID: "one" });

  const metadata = await request("metadata", { path: "/Photos/a.bin" }) as { size: number };
  assert.equal(metadata.size, 5);
  const chunk = await request("download_chunk", { path: "/Photos/a.bin", offset: 0, length: 5 }) as { data: string };
  assert.equal(Buffer.from(chunk.data, "base64").toString(), "hello");

  await request("copy", { sourcePath: "/Photos/a.bin", destinationPath: "/Photos/b.bin" });
  await request("move", { sourcePath: "/Photos/b.bin", destinationPath: "/moved.bin" });
  assert.equal(await request("metadata", { path: "/Photos/b.bin" }), null);
  assert.equal((await request("metadata", { path: "/moved.bin" }) as { size: number }).size, 5);
  await request("delete", { path: "/moved.bin" });
  assert.equal(await request("metadata", { path: "/moved.bin" }), null);
});

test("browser node rejects traversal and create-if-absent collisions", async () => {
  const root = new MemoryDirectory("Backup") as unknown as FileSystemDirectoryHandle;
  const uploads = new Map();
  const request = (operation: string, fields: Record<string, unknown> = {}) =>
    performOperation(root, uploads, { operation, ...fields });

  await assert.rejects(request("metadata", { path: "/../secret" }), /invalid_path/);
  await request("upload_begin", { transferID: "one", path: "/a.bin", mode: "create_if_absent", size: 0 });
  await request("upload_finish", { transferID: "one" });
  await assert.rejects(
    request("upload_begin", { transferID: "two", path: "/a.bin", mode: "create_if_absent", size: 0 }),
    /name_collision/
  );
});
