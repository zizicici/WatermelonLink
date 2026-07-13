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
  receivedSize?: number;
};

type ValidFileSystemRequest = FileSystemRequest & { id: string; operation: string };

export type UploadState = {
  writable: FileSystemWritableFileStream;
  path: string;
  control: boolean;
  expectedSize: number;
  receivedSize: number;
  writtenSize: number;
  pendingChunks: Uint8Array[];
  pendingBytes: number;
  queuedFrames: number;
  queuedTerminalControls: number;
  activeOperations: number;
  parent: FileSystemDirectoryHandle;
  name: string;
  removeOnAbort: boolean;
  idleTimer: ReturnType<typeof setTimeout>;
  notifyTimeout?: () => void;
  cleanupPromise?: Promise<void>;
};

export type DownloadState = {
  file: File;
  control: boolean;
  sentSize: number;
  acknowledgedSize: number;
  started: boolean;
  queuedControls: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  notifyTimeout?: () => void;
  cancelled: Promise<void>;
  cancelRead: () => void;
  abandonRead?: () => void;
};

type DownloadSendBudget = {
  reservedBytes: number;
  waiters: Set<() => void>;
};

type DownloadReadBudget = {
  orphanedReads: number;
  settlingReads: Set<Promise<void>>;
};

type UploadAdmissionBudget = {
  dataReservations: number;
  controlReservations: number;
};

export type DownloadAcknowledgementBudget = {
  windowStartedAt: number;
  messages: number;
};

const maximumActiveDataUploads = 4;
const maximumActiveControlUploads = 1;
const maximumActiveDataDownloads = 2;
const maximumActiveControlDownloads = 1;
const maximumTransferBytes = 64 * 1024 * 1024 * 1024;
const maximumListEntries = 100_000;
const maximumListEstimateBytes = 24 * 1024 * 1024;
const listMetadataConcurrency = 32;
const uploadFrameHeaderBytes = 32;
const maximumUploadFramePayloadBytes = 128 * 1024;
const downloadFrameHeaderBytes = 32;
const maximumDownloadFramePayloadBytes = 128 * 1024;
const minimumDownloadFramePayloadBytes = 8 * 1024;
const maximumIncomingMessageBytes = uploadFrameHeaderBytes + maximumUploadFramePayloadBytes;
const uploadWriteBatchBytes = 512 * 1024;
const maximumQueuedRequests = 640;
const maximumQueuedRequestBytes = 8 * 1024 * 1024;
const maximumDownloadAcknowledgementsPerSecond = 4_096;
const uploadIdleTimeoutMilliseconds = 60_000;
const downloadIdleTimeoutMilliseconds = 300_000;
const maximumUnacknowledgedDownloadBytes = 4 * 1024 * 1024;
const maximumDataUnacknowledgedDownloadBytes = 3 * 1024 * 1024 + 512 * 1024;
const maximumControlUnacknowledgedDownloadBytes = 512 * 1024;
const maximumDataBufferedDownloadBytes = downloadFrameHeaderBytes + maximumDownloadFramePayloadBytes;
const maximumBufferedDownloadBytes = 192 * 1024;
const maximumResponseBytes = 32 * 1024 * 1024;
const directResponseBytes = 48 * 1024;
const responsePartBytes = 24 * 1024;
const fileSystemOperations = new Set([
  "list", "metadata", "create_directory", "delete", "copy", "move",
  "upload_begin", "upload_finish", "upload_abort",
  "download_begin", "download_start", "download_finish", "download_abort"
]);
const textEncoder = new TextEncoder();

export type FileSystemNodeController = {
  dispose: () => void;
  waitForQuiescence: () => Promise<void>;
};

export type UploadFrame = {
  transferID: string;
  offset: number;
  payload: Uint8Array;
};

export function installFileSystemNodeController(
  channel: RTCDataChannel,
  root: FileSystemDirectoryHandle,
  downloadChunkBytes = maximumDownloadFramePayloadBytes
): FileSystemNodeController {
  if (!Number.isSafeInteger(downloadChunkBytes) || downloadChunkBytes < minimumDownloadFramePayloadBytes ||
      downloadChunkBytes > maximumDownloadFramePayloadBytes) {
    throw new Error("invalid_download_chunk_size");
  }
  const uploads = new Map<string, UploadState>();
  const downloads = new Map<string, DownloadState>();
  const uploadQueues = new Map<string, Promise<void>>();
  const downloadFlowWaiters = new Set<() => void>();
  const downloadTasks = new Set<Promise<void>>();
  const downloadSendBudget: DownloadSendBudget = {
    reservedBytes: 0,
    waiters: downloadFlowWaiters
  };
  const downloadReadBudget: DownloadReadBudget = { orphanedReads: 0, settlingReads: new Set() };
  const uploadAdmissionBudget: UploadAdmissionBudget = { dataReservations: 0, controlReservations: 0 };
  const acknowledgementBudget: DownloadAcknowledgementBudget = { windowStartedAt: performance.now(), messages: 0 };
  let queue = Promise.resolve();
  let lockQueue = Promise.resolve();
  let disposed = false;
  let queuedRequests = 0;
  let queuedRequestBytes = 0;
  let quiescencePromise: Promise<void> | undefined;

  const beginQuiescence = (): Promise<void> => {
    if (quiescencePromise) return quiescencePromise;
    disposed = true;
    channel.removeEventListener("message", onMessage);
    quiescencePromise = (async () => {
      await queue.catch(() => {});
      await lockQueue.catch(() => {});
      await Promise.all([...uploadQueues.values()].map((uploadQueue) => uploadQueue.catch(() => {})));
      await abortAllUploads(uploads);
      abortAllDownloads(downloads, downloadFlowWaiters);
      await Promise.all([...downloadTasks].map((task) => task.catch(() => {})));
      while (downloadReadBudget.settlingReads.size > 0) {
        await Promise.all([...downloadReadBudget.settlingReads]);
      }
    })();
    return quiescencePromise;
  };

  const dispose = () => { void beginQuiescence(); };

  const closeForProtocolViolation = () => {
    dispose();
    channel.close();
  };

  const onMessage = (event: MessageEvent) => {
    if (disposed) return;
    const message = event.data;
    const messageBytes = typeof message === "string"
      ? textEncoder.encode(message).byteLength
      : message instanceof ArrayBuffer ? message.byteLength : maximumIncomingMessageBytes + 1;
    if (messageBytes > maximumIncomingMessageBytes ||
        queuedRequests >= maximumQueuedRequests ||
        queuedRequestBytes + messageBytes > maximumQueuedRequestBytes) {
      closeForProtocolViolation();
      return;
    }
    let uploadFrame: UploadFrame | undefined;
    let request: ValidFileSystemRequest | undefined;
    let terminalTransferID: string | undefined;
    let downloadControlTransferID: string | undefined;
    if (message instanceof ArrayBuffer) {
      try {
        uploadFrame = decodeUploadFrame(message);
      } catch {
        closeForProtocolViolation();
        return;
      }
      noteQueuedUploadFrame(uploads, uploadFrame.transferID);
    } else if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_request");
        request = parsed as ValidFileSystemRequest;
      } catch {
        closeForProtocolViolation();
        return;
      }
      if (request.type === "fs_download_ack") {
        if (!consumeDownloadAcknowledgementBudget(acknowledgementBudget)) {
          closeForProtocolViolation();
          return;
        }
        try {
          acceptDownloadAcknowledgement(downloads, downloadFlowWaiters, request);
        } catch {
          closeForProtocolViolation();
        }
        return;
      }
      if (request.type !== "fs_request" ||
          !isRequestID(request.id) ||
          typeof request.operation !== "string" ||
          !fileSystemOperations.has(request.operation)) {
        closeForProtocolViolation();
        return;
      }
      if ((request.operation === "upload_finish" || request.operation === "upload_abort") &&
          typeof request.transferID === "string") {
        terminalTransferID = request.transferID;
        noteQueuedUploadTerminalControl(uploads, terminalTransferID);
      }
      if ((request.operation === "download_start" || request.operation === "download_finish" ||
          request.operation === "download_abort") && typeof request.transferID === "string") {
        downloadControlTransferID = request.transferID;
        noteQueuedDownloadControl(downloads, downloadControlTransferID);
      }
    } else {
      closeForProtocolViolation();
      return;
    }
    queuedRequests += 1;
    queuedRequestBytes += messageBytes;
    const finishAccounting = () => {
      queuedRequests = Math.max(0, queuedRequests - 1);
      queuedRequestBytes = Math.max(0, queuedRequestBytes - messageBytes);
    };
    if (uploadFrame) {
      const frame = uploadFrame;
      if ((uploads.get(frame.transferID)?.queuedTerminalControls ?? 0) > 0) {
        finishAccounting();
        closeForProtocolViolation();
        return;
      }
      const precedingUpload = uploadQueues.get(frame.transferID)?.catch(() => {}) ?? Promise.resolve();
      const task = precedingUpload.then(async () => {
        if (disposed) return;
        completeQueuedUploadFrame(uploads, frame.transferID);
        try {
          const acknowledgedSize = await acceptUploadFrame(uploads, frame, downloadChunkBytes);
          if (!disposed && acknowledgedSize !== null) {
            sendUploadAcknowledgement(channel, frame.transferID, acknowledgedSize);
          }
        } catch (error) {
          const code = errorCode(error);
          await abortUpload(uploads, frame.transferID);
          if (!disposed) sendUploadError(channel, frame.transferID, code);
        }
      }).catch((error) => {
        console.error("[WatermelonLink] upload queue failure", { error: error instanceof Error ? error.message : String(error) });
      }).finally(finishAccounting);
      uploadQueues.set(frame.transferID, task);
      void task.then(() => {
        if (uploadQueues.get(frame.transferID) === task) uploadQueues.delete(frame.transferID);
      });
      return;
    }
    const controlRequest = request!;
    const uploadBarrier = (controlRequest.operation === "upload_finish" || controlRequest.operation === "upload_abort") &&
      typeof controlRequest.transferID === "string"
      ? uploadQueues.get(controlRequest.transferID)
      : undefined;
    const usesLockQueue = isLockControlRequest(controlRequest, uploads, downloads);
    const precedingControl = usesLockQueue ? lockQueue : queue;
    const controlTask = precedingControl.then(async () => {
      if (disposed) return;
      if (uploadBarrier) await uploadBarrier.catch(() => {});
      const request = controlRequest;
      const diagnosticID = request.id.slice(0, 8);
      let begunDownloadTransferID: string | undefined;
      let startedDownloadTransferID: string | undefined;
      let begunUploadTransferID: string | undefined;
      console.debug("[WatermelonLink] FS request", { id: diagnosticID, operation: request.operation });
      try {
        const result = await performOperation(
          root,
          uploads,
          request,
          downloads,
          downloadFlowWaiters,
          downloadReadBudget,
          uploadAdmissionBudget
        );
        if (request.operation === "download_begin" && isDownloadInfo(result)) {
          begunDownloadTransferID = result.transferID;
          armDownloadIdleTimer(downloads, downloadFlowWaiters, result.transferID);
        }
        if (request.operation === "download_start" && typeof request.transferID === "string") {
          startedDownloadTransferID = request.transferID;
        }
        if (request.operation === "upload_begin" && typeof request.transferID === "string") {
          const upload = uploads.get(request.transferID);
          if (upload) {
            begunUploadTransferID = request.transferID;
            upload.notifyTimeout = () => {
              if (!disposed) sendUploadError(channel, request.transferID!, "transfer_timeout");
            };
          }
        }
        if (disposed) {
          await abortAllUploads(uploads);
          abortAllDownloads(downloads, downloadFlowWaiters);
          return;
        }
        console.debug("[WatermelonLink] FS response", { id: diagnosticID, ok: true });
        await sendResponse(channel, request.id, true, result, undefined, downloadSendBudget);
        if (channel.readyState !== "open") throw new Error("channel_closed");
        if (request.operation === "download_begin" && isDownloadInfo(result)) {
          const download = downloads.get(result.transferID);
          if (download) {
            download.notifyTimeout = () => {
              sendDownloadError(channel, result.transferID, "transfer_timeout");
            };
          }
          armDownloadIdleTimer(downloads, downloadFlowWaiters, result.transferID);
        } else if (request.operation === "download_start" && typeof request.transferID === "string") {
          const task = streamDownload(
            channel,
            downloads,
            downloadFlowWaiters,
            downloadSendBudget,
            downloadReadBudget,
            request.transferID,
            downloadChunkBytes
          );
          downloadTasks.add(task);
          const completed = () => { downloadTasks.delete(task); };
          void task.then(completed, completed);
        }
      } catch (error) {
        if (begunDownloadTransferID) {
          abortDownload(downloads, downloadFlowWaiters, begunDownloadTransferID);
        }
        if (startedDownloadTransferID) {
          abortDownload(downloads, downloadFlowWaiters, startedDownloadTransferID);
        }
        if (begunUploadTransferID) {
          await abortUpload(uploads, begunUploadTransferID);
        }
        const code = errorCode(error);
        console.error("[WatermelonLink] FS response", { id: diagnosticID, ok: false, code });
        if (!disposed) await sendResponse(channel, request.id, false, undefined, code, downloadSendBudget);
      } finally {
        if (terminalTransferID) completeQueuedUploadTerminalControl(uploads, terminalTransferID);
        if (downloadControlTransferID) {
          completeQueuedDownloadControl(downloads, downloadFlowWaiters, downloadControlTransferID);
        }
      }
    }).catch((error) => {
      console.error("[WatermelonLink] FS queue failure", { error: error instanceof Error ? error.message : String(error) });
    }).finally(finishAccounting);
    if (usesLockQueue) lockQueue = controlTask;
    else queue = controlTask;
  };

  channel.addEventListener("message", onMessage);
  return {
    dispose,
    waitForQuiescence: beginQuiescence
  };
}

export function consumeDownloadAcknowledgementBudget(
  budget: DownloadAcknowledgementBudget,
  now = performance.now()
): boolean {
  if (now - budget.windowStartedAt >= 1_000 || now < budget.windowStartedAt) {
    budget.windowStartedAt = now;
    budget.messages = 0;
  }
  budget.messages += 1;
  return budget.messages <= maximumDownloadAcknowledgementsPerSecond;
}

export function decodeUploadFrame(buffer: ArrayBuffer): UploadFrame {
  if (buffer.byteLength < uploadFrameHeaderBytes + 1 ||
      buffer.byteLength > uploadFrameHeaderBytes + maximumUploadFramePayloadBytes) {
    throw new Error("invalid_request");
  }
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x57 || bytes[1] !== 0x4d || bytes[2] !== 0x4c || bytes[3] !== 0x01) {
    throw new Error("invalid_request");
  }
  const view = new DataView(buffer);
  const offsetValue = view.getBigUint64(20, false);
  if (offsetValue > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("invalid_request");
  const payloadLength = view.getUint32(28, false);
  if (payloadLength === 0 ||
      payloadLength > maximumUploadFramePayloadBytes ||
      buffer.byteLength !== uploadFrameHeaderBytes + payloadLength) {
    throw new Error("invalid_request");
  }
  return {
    transferID: uuidString(bytes.subarray(4, 20)),
    offset: Number(offsetValue),
    payload: bytes.subarray(uploadFrameHeaderBytes)
  };
}

export function encodeDownloadFrame(transferID: string, offset: number, payload: Uint8Array): ArrayBuffer {
  if (!Number.isSafeInteger(offset) || offset < 0 || payload.byteLength === 0 ||
      payload.byteLength > maximumDownloadFramePayloadBytes) {
    throw new Error("invalid_request");
  }
  const identifier = transferID.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(identifier)) throw new Error("invalid_request");
  const frame = new ArrayBuffer(downloadFrameHeaderBytes + payload.byteLength);
  const bytes = new Uint8Array(frame);
  bytes.set([0x57, 0x4d, 0x4c, 0x02]);
  for (let index = 0; index < 16; index += 1) {
    bytes[4 + index] = Number.parseInt(identifier.slice(index * 2, index * 2 + 2), 16);
  }
  const view = new DataView(frame);
  view.setBigUint64(20, BigInt(offset), false);
  view.setUint32(28, payload.byteLength, false);
  bytes.set(payload, downloadFrameHeaderBytes);
  return frame;
}

export async function acceptUploadFrame(
  uploads: Map<string, UploadState>,
  frame: UploadFrame,
  negotiatedMaximumPayloadBytes = maximumUploadFramePayloadBytes
): Promise<number | null> {
  const upload = uploads.get(frame.transferID);
  if (!upload || upload.cleanupPromise) throw new Error("unknown_transfer");
  beginUploadOperation(upload);
  try {
    if (frame.payload.byteLength === 0 ||
        frame.payload.byteLength > negotiatedMaximumPayloadBytes ||
        frame.offset !== upload.receivedSize ||
        frame.payload.byteLength > upload.expectedSize - upload.receivedSize ||
        (frame.payload.byteLength < minimumDownloadFramePayloadBytes &&
          frame.payload.byteLength < upload.expectedSize - upload.receivedSize)) {
      throw new Error("invalid_range");
    }
    let flushed = false;
    if (upload.pendingBytes > 0 && upload.pendingBytes + frame.payload.byteLength > uploadWriteBatchBytes) {
      await flushUploadBuffer(upload);
      flushed = true;
    }
    upload.pendingChunks.push(frame.payload);
    upload.pendingBytes += frame.payload.byteLength;
    upload.receivedSize += frame.payload.byteLength;
    if (upload.pendingBytes < uploadWriteBatchBytes && upload.receivedSize !== upload.expectedSize) {
      return flushed ? upload.writtenSize : null;
    }
    await flushUploadBuffer(upload);
    return upload.writtenSize;
  } finally {
    endUploadOperation(uploads, frame.transferID, upload);
  }
}

function noteQueuedUploadFrame(uploads: Map<string, UploadState>, transferID: string): void {
  const upload = uploads.get(transferID);
  if (!upload || upload.cleanupPromise) return;
  clearTimeout(upload.idleTimer);
  upload.queuedFrames += 1;
}

function noteQueuedUploadTerminalControl(uploads: Map<string, UploadState>, transferID: string): void {
  const upload = uploads.get(transferID);
  if (!upload || upload.cleanupPromise) return;
  clearTimeout(upload.idleTimer);
  upload.queuedTerminalControls += 1;
}

function completeQueuedUploadTerminalControl(uploads: Map<string, UploadState>, transferID: string): void {
  const upload = uploads.get(transferID);
  if (!upload || upload.cleanupPromise) return;
  upload.queuedTerminalControls = Math.max(0, upload.queuedTerminalControls - 1);
  if (upload.queuedFrames === 0 && upload.queuedTerminalControls === 0 && upload.activeOperations === 0) {
    refreshUploadIdleTimer(uploads, transferID, upload);
  }
}

function completeQueuedUploadFrame(uploads: Map<string, UploadState>, transferID: string): void {
  const upload = uploads.get(transferID);
  if (!upload || upload.cleanupPromise) return;
  upload.queuedFrames = Math.max(0, upload.queuedFrames - 1);
}

function beginUploadOperation(upload: UploadState): void {
  clearTimeout(upload.idleTimer);
  upload.activeOperations += 1;
}

function endUploadOperation(
  uploads: Map<string, UploadState>,
  transferID: string,
  upload: UploadState
): void {
  upload.activeOperations = Math.max(0, upload.activeOperations - 1);
  if (uploads.get(transferID) === upload &&
      upload.queuedFrames === 0 &&
      upload.queuedTerminalControls === 0 &&
      upload.activeOperations === 0) {
    refreshUploadIdleTimer(uploads, transferID, upload);
  }
}

async function flushUploadBuffer(upload: UploadState): Promise<void> {
  if (upload.pendingBytes === 0) return;
  let bytes: Uint8Array;
  if (upload.pendingChunks.length === 1) {
    bytes = upload.pendingChunks[0]!;
  } else {
    bytes = new Uint8Array(upload.pendingBytes);
    let offset = 0;
    for (const chunk of upload.pendingChunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  upload.pendingChunks = [];
  upload.pendingBytes = 0;
  if (!(bytes.buffer instanceof ArrayBuffer)) throw new Error("invalid_request");
  await upload.writable.write(bytes as Uint8Array<ArrayBuffer>);
  upload.writtenSize += bytes.byteLength;
}

function uuidString(bytes: Uint8Array): string {
  if (bytes.byteLength !== 16) throw new Error("invalid_request");
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sendUploadAcknowledgement(channel: RTCDataChannel, transferID: string, receivedSize: number): void {
  if (channel.readyState !== "open") return;
  channel.send(JSON.stringify({ type: "fs_upload_ack", transferID, receivedSize }));
}

function sendUploadError(channel: RTCDataChannel, transferID: string, error: string): void {
  if (channel.readyState !== "open") return;
  try {
    channel.send(JSON.stringify({ type: "fs_upload_error", transferID, error }));
  } catch {}
}

export async function performOperation(
  root: FileSystemDirectoryHandle,
  uploads: Map<string, UploadState>,
  request: FileSystemRequest,
  downloads: Map<string, DownloadState> = new Map(),
  downloadFlowWaiters: Set<() => void> = new Set(),
  downloadReadBudget: DownloadReadBudget = { orphanedReads: 0, settlingReads: new Set() },
  uploadAdmissionBudget: UploadAdmissionBudget = { dataReservations: 0, controlReservations: 0 }
): Promise<unknown> {
  switch (request.operation) {
    case "list": {
      const path = requiredString(request.path);
      const directory = await directoryAt(root, path, false);
      const entries: unknown[] = [];
      let estimatedBytes = 2;
      let batch: Array<[string, FileSystemHandle]> = [];
      for await (const [name, handle] of directory.entries()) {
        batch.push([name, handle]);
        if (batch.length === listMetadataConcurrency) {
          estimatedBytes = await appendListEntries(path, batch, entries, estimatedBytes);
          batch = [];
        }
      }
      if (batch.length > 0) await appendListEntries(path, batch, entries, estimatedBytes);
      return entries;
    }
    case "metadata": {
      const resolved = await entryAt(root, requiredString(request.path), true);
      return resolved ? entryDescription(resolved.path, resolved.handle) : null;
    }
    case "create_directory": {
      const path = normalizePath(requiredString(request.path));
      assertNoActiveUploadOverlap(uploads, path);
      await directoryAt(root, path, true);
      return null;
    }
    case "delete": {
      const path = normalizePath(requiredString(request.path));
      if (path === "/") throw new Error("invalid_path");
      assertNoActiveUploadOverlap(uploads, path);
      const existing = await entryAt(root, path, true);
      if (!existing) return null;
      const { parent, name } = await parentAndName(root, path, false);
      await parent.removeEntry(name, { recursive: true });
      return null;
    }
    case "copy": {
      const source = normalizePath(requiredString(request.sourcePath));
      const destination = normalizePath(requiredString(request.destinationPath));
      assertNoActiveUploadOverlap(uploads, source, destination);
      await copyOrMoveEntry(root, source, destination, false);
      return null;
    }
    case "move": {
      const source = normalizePath(requiredString(request.sourcePath));
      const destination = normalizePath(requiredString(request.destinationPath));
      assertNoActiveUploadOverlap(uploads, source, destination);
      await copyOrMoveEntry(root, source, destination, true);
      return null;
    }
    case "upload_begin": {
      const transferID = requiredString(request.transferID);
      const path = normalizePath(requiredString(request.path));
      const expectedSize = requiredNonnegativeInteger(request.size);
      if (expectedSize > maximumTransferBytes) throw new Error("invalid_size");
      if (request.mode !== "replace" && request.mode !== "create_if_absent") throw new Error("invalid_request");
      if (uploads.has(transferID)) throw new Error("duplicate_transfer");
      const control = isWriteLockPath(path);
      const activeForClass = [...uploads.values()].filter((upload) => upload.control === control).length;
      const reservedForClass = control
        ? uploadAdmissionBudget.controlReservations
        : uploadAdmissionBudget.dataReservations;
      const classLimit = control ? maximumActiveControlUploads : maximumActiveDataUploads;
      if (activeForClass + reservedForClass >= classLimit) throw new Error("too_many_transfers");
      if (control) uploadAdmissionBudget.controlReservations += 1;
      else uploadAdmissionBudget.dataReservations += 1;
      try {
        assertNoActiveUploadOverlap(uploads, path);
        const existing = await entryAt(root, path, true);
        if (request.mode === "create_if_absent" && existing) throw new Error("name_collision");
        const { parent, name } = await parentAndName(root, path, true);
        const handle = await parent.getFileHandle(name, { create: true });
        const removeOnAbort = existing === null;
        try {
          const writable = await handle.createWritable({ keepExistingData: false });
          const upload: UploadState = {
            writable,
            path,
            control,
            expectedSize,
            receivedSize: 0,
            writtenSize: 0,
            pendingChunks: [],
            pendingBytes: 0,
            queuedFrames: 0,
            queuedTerminalControls: 0,
            activeOperations: 0,
            parent,
            name,
            removeOnAbort,
            idleTimer: setTimeout(() => void expireUpload(uploads, transferID), uploadIdleTimeoutMilliseconds)
          };
          uploads.set(transferID, upload);
        } catch (error) {
          if (removeOnAbort) await parent.removeEntry(name).catch(() => {});
          throw error;
        }
      } finally {
        if (control) uploadAdmissionBudget.controlReservations -= 1;
        else uploadAdmissionBudget.dataReservations -= 1;
      }
      return null;
    }
    case "upload_finish": {
      const transferID = requiredString(request.transferID);
      const upload = uploads.get(transferID);
      if (!upload || upload.cleanupPromise) throw new Error("unknown_transfer");
      if (upload.receivedSize !== upload.expectedSize) {
        await abortUpload(uploads, transferID);
        throw new Error("invalid_size");
      }
      clearTimeout(upload.idleTimer);
      try {
        await flushUploadBuffer(upload);
        await upload.writable.close();
        uploads.delete(transferID);
      } catch (error) {
        await abortUpload(uploads, transferID);
        throw error;
      }
      return null;
    }
    case "upload_abort": {
      const transferID = requiredString(request.transferID);
      await abortUpload(uploads, transferID);
      return null;
    }
    case "download_begin": {
      if (downloadReadBudget.orphanedReads > 0) throw new Error("too_many_transfers");
      const path = normalizePath(requiredString(request.path));
      const file = await fileAt(root, path);
      if (file.size > maximumTransferBytes) throw new Error("invalid_size");
      const control = isWriteLockPath(path);
      const activeForClass = [...downloads.values()].filter((download) => download.control === control).length;
      const classLimit = control ? maximumActiveControlDownloads : maximumActiveDataDownloads;
      if (activeForClass >= classLimit) throw new Error("too_many_transfers");
      const transferID = crypto.randomUUID();
      let cancelRead!: () => void;
      const cancelled = new Promise<void>((resolve) => { cancelRead = resolve; });
      downloads.set(transferID, {
        file,
        control,
        sentSize: 0,
        acknowledgedSize: 0,
        started: false,
        queuedControls: 0,
        cancelled,
        cancelRead,
      });
      return { transferID, size: file.size };
    }
    case "download_start": {
      if (downloadReadBudget.orphanedReads > 0) throw new Error("too_many_transfers");
      const transferID = requiredString(request.transferID);
      const download = downloads.get(transferID);
      if (!download) throw new Error("unknown_transfer");
      if (download.started) throw new Error("duplicate_transfer");
      download.started = true;
      return null;
    }
    case "download_finish":
    case "download_abort": {
      const transferID = requiredString(request.transferID);
      const download = downloads.get(transferID);
      if (request.operation === "download_finish") {
        if (!download) throw new Error("unknown_transfer");
        if (!download.started || download.acknowledgedSize !== download.file.size) {
          throw new Error("invalid_size");
        }
      }
      abortDownload(downloads, downloadFlowWaiters, transferID);
      return null;
    }
    default:
      throw new Error("unsupported_operation");
  }
}

async function appendListEntries(
  path: string,
  batch: Array<[string, FileSystemHandle]>,
  entries: unknown[],
  estimatedBytes: number
): Promise<number> {
  if (entries.length + batch.length > maximumListEntries) throw new Error("response_too_large");
  const descriptions = await Promise.all(batch.map(([name, handle]) => entryDescription(joinPath(path, name), handle)));
  for (const entry of descriptions) {
    estimatedBytes += textEncoder.encode(JSON.stringify(entry)).byteLength + 1;
    if (estimatedBytes > maximumListEstimateBytes) throw new Error("response_too_large");
    entries.push(entry);
  }
  return estimatedBytes;
}

async function abortAllUploads(uploads: Map<string, UploadState>): Promise<void> {
  await Promise.all([...uploads.keys()].map((transferID) => abortUpload(uploads, transferID)));
}

function isDownloadInfo(value: unknown): value is { transferID: string; size: number } {
  if (!value || typeof value !== "object") return false;
  const info = value as { transferID?: unknown; size?: unknown };
  return typeof info.transferID === "string" && typeof info.size === "number";
}

function wakeDownloadFlowWaiters(waiters: Set<() => void>): void {
  const current = [...waiters];
  waiters.clear();
  current.forEach((resolve) => resolve());
}

function abortDownload(
  downloads: Map<string, DownloadState>,
  waiters: Set<() => void>,
  transferID: string
): void {
  const download = downloads.get(transferID);
  if (!download) return;
  if (download.idleTimer) clearTimeout(download.idleTimer);
  download.abandonRead?.();
  download.cancelRead();
  downloads.delete(transferID);
  wakeDownloadFlowWaiters(waiters);
}

function abortAllDownloads(downloads: Map<string, DownloadState>, waiters: Set<() => void>): void {
  for (const download of downloads.values()) {
    if (download.idleTimer) clearTimeout(download.idleTimer);
    download.abandonRead?.();
    download.cancelRead();
  }
  downloads.clear();
  wakeDownloadFlowWaiters(waiters);
}

function armDownloadIdleTimer(
  downloads: Map<string, DownloadState>,
  waiters: Set<() => void>,
  transferID: string
): void {
  const download = downloads.get(transferID);
  if (!download || download.queuedControls > 0) return;
  if (download.idleTimer) clearTimeout(download.idleTimer);
  download.idleTimer = setTimeout(
    () => {
      download.notifyTimeout?.();
      abortDownload(downloads, waiters, transferID);
    },
    downloadIdleTimeoutMilliseconds
  );
}

export function acceptDownloadAcknowledgement(
  downloads: Map<string, DownloadState>,
  waiters: Set<() => void>,
  message: FileSystemRequest
): void {
  const transferID = requiredString(message.transferID);
  if (!isCanonicalTransferID(transferID)) throw new Error("invalid_request");
  const receivedSize = requiredNonnegativeInteger(message.receivedSize);
  const download = downloads.get(transferID);
  if (!download) return;
  if (!download.started) throw new Error("unknown_transfer");
  if (receivedSize < download.acknowledgedSize || receivedSize > download.sentSize) {
    throw new Error("invalid_range");
  }
  if (receivedSize === download.acknowledgedSize) return;
  download.acknowledgedSize = receivedSize;
  armDownloadIdleTimer(downloads, waiters, transferID);
  wakeDownloadFlowWaiters(waiters);
}

function noteQueuedDownloadControl(downloads: Map<string, DownloadState>, transferID: string): void {
  const download = downloads.get(transferID);
  if (!download) return;
  if (download.idleTimer) clearTimeout(download.idleTimer);
  download.idleTimer = undefined;
  download.queuedControls += 1;
}

function completeQueuedDownloadControl(
  downloads: Map<string, DownloadState>,
  waiters: Set<() => void>,
  transferID: string
): void {
  const download = downloads.get(transferID);
  if (!download) return;
  download.queuedControls = Math.max(0, download.queuedControls - 1);
  if (download.queuedControls === 0) armDownloadIdleTimer(downloads, waiters, transferID);
}

async function streamDownload(
  channel: RTCDataChannel,
  downloads: Map<string, DownloadState>,
  waiters: Set<() => void>,
  sendBudget: DownloadSendBudget,
  readBudget: DownloadReadBudget,
  transferID: string,
  chunkBytes: number
): Promise<void> {
  const original = downloads.get(transferID);
  if (!original?.started) return;
  try {
    while (original.sentSize < original.file.size) {
      if (downloads.get(transferID) !== original) return;
      const nativeBufferedLimit = original.control
        ? maximumBufferedDownloadBytes
        : maximumDataBufferedDownloadBytes;
      await waitForDownloadSendCapacity(
        channel,
        downloads,
        transferID,
        original,
        waiters,
        nativeBufferedLimit - chunkBytes - downloadFrameHeaderBytes
      );
      if (downloads.get(transferID) !== original) return;
      const outstandingBytes = [...downloads.values()].reduce(
        (total, download) => total + Math.max(0, download.sentSize - download.acknowledgedSize),
        0
      );
      const classOutstandingBytes = [...downloads.values()].reduce(
        (total, download) => total + (download.control === original.control
          ? Math.max(0, download.sentSize - download.acknowledgedSize)
          : 0),
        0
      );
      const availableWindow = availableDownloadWindowBytes(
        outstandingBytes,
        classOutstandingBytes,
        original.control
      );
      if (availableWindow <= 0) {
        await new Promise<void>((resolve) => waiters.add(resolve));
        continue;
      }
      const remainingBytes = original.file.size - original.sentSize;
      const length = nextDownloadPayloadLength(remainingBytes, availableWindow, chunkBytes);
      if (length === null) {
        await new Promise<void>((resolve) => waiters.add(resolve));
        continue;
      }
      const frameBytes = downloadFrameHeaderBytes + length;
      if (channel.bufferedAmount + frameBytes > nativeBufferedLimit) {
        continue;
      }
      if (channel.bufferedAmount + sendBudget.reservedBytes + frameBytes > nativeBufferedLimit) {
        await new Promise<void>((resolve) => waiters.add(resolve));
        continue;
      }
      const offset = original.sentSize;
      sendBudget.reservedBytes += frameBytes;
      original.sentSize += length;
      try {
        let readSettled = false;
        let readAbandoned = false;
        const rawRead = original.file.slice(offset, offset + length).arrayBuffer();
        const read = rawRead.then(
          (buffer) => {
            readSettled = true;
            return { buffer };
          },
          (error) => {
            readSettled = true;
            throw error;
          }
        );
        original.abandonRead = () => {
          if (readSettled || readAbandoned) return;
          readAbandoned = true;
          readBudget.orphanedReads += 1;
          let settlingRead!: Promise<void>;
          const release = () => {
            readBudget.orphanedReads = Math.max(0, readBudget.orphanedReads - 1);
            readBudget.settlingReads.delete(settlingRead);
            wakeDownloadFlowWaiters(waiters);
          };
          settlingRead = rawRead.then(release, release);
          readBudget.settlingReads.add(settlingRead);
        };
        const outcome = await Promise.race([
          read,
          original.cancelled.then(() => null),
        ]);
        original.abandonRead = undefined;
        if (!outcome) return;
        const payload = new Uint8Array(outcome.buffer);
        if (downloads.get(transferID) !== original) return;
        if (payload.byteLength !== length) throw new Error("invalid_size");
        if (channel.readyState !== "open") throw new Error("channel_closed");
        await waitForReservedDownloadSendCapacity(
          channel,
          downloads,
          transferID,
          original,
          waiters,
          sendBudget,
          nativeBufferedLimit
        );
        if (downloads.get(transferID) !== original) return;
        channel.send(encodeDownloadFrame(transferID, offset, payload));
        armDownloadIdleTimer(downloads, waiters, transferID);
      } finally {
        sendBudget.reservedBytes = Math.max(0, sendBudget.reservedBytes - frameBytes);
        wakeDownloadFlowWaiters(waiters);
      }
    }
  } catch (error) {
    if (downloads.get(transferID) !== original) return;
    try {
      sendDownloadError(channel, transferID, errorCode(error));
    } finally {
      abortDownload(downloads, waiters, transferID);
    }
  }
}

async function waitForReservedDownloadSendCapacity(
  channel: RTCDataChannel,
  downloads: Map<string, DownloadState>,
  transferID: string,
  download: DownloadState,
  waiters: Set<() => void>,
  sendBudget: DownloadSendBudget,
  maximumBufferedBytes: number
): Promise<void> {
  while (channel.bufferedAmount + sendBudget.reservedBytes > maximumBufferedBytes) {
    channel.bufferedAmountLowThreshold = 0;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let poll: ReturnType<typeof setTimeout> | undefined;
      const onLow = () => finish();
      const onFlowChange = () => finish();
      const onClose = () => finish(new Error("channel_closed"));
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        waiters.delete(onFlowChange);
        if (poll) clearTimeout(poll);
        channel.removeEventListener("bufferedamountlow", onLow);
        channel.removeEventListener("close", onClose);
        if (error) reject(error);
        else resolve();
      };
      waiters.add(onFlowChange);
      channel.addEventListener("bufferedamountlow", onLow, { once: true });
      channel.addEventListener("close", onClose, { once: true });
      poll = setTimeout(onLow, 50);
      if (downloads.get(transferID) !== download) finish();
      else if (channel.readyState !== "open") finish(new Error("channel_closed"));
      else if (channel.bufferedAmount + sendBudget.reservedBytes <= maximumBufferedBytes) finish();
    });
    if (downloads.get(transferID) !== download) return;
  }
}

export function availableDownloadWindowBytes(
  totalOutstandingBytes: number,
  classOutstandingBytes: number,
  control: boolean
): number {
  const classLimit = control
    ? maximumControlUnacknowledgedDownloadBytes
    : maximumDataUnacknowledgedDownloadBytes;
  return Math.min(
    maximumUnacknowledgedDownloadBytes - totalOutstandingBytes,
    classLimit - classOutstandingBytes
  );
}

export function nextDownloadPayloadLength(
  remainingBytes: number,
  availableWindowBytes: number,
  chunkBytes: number
): number | null {
  if (!Number.isSafeInteger(remainingBytes) || remainingBytes <= 0 ||
      !Number.isSafeInteger(availableWindowBytes) || availableWindowBytes <= 0 ||
      !Number.isSafeInteger(chunkBytes) || chunkBytes < minimumDownloadFramePayloadBytes) {
    throw new Error("invalid_request");
  }
  const length = Math.min(remainingBytes, availableWindowBytes, chunkBytes);
  return length < minimumDownloadFramePayloadBytes && length < remainingBytes ? null : length;
}

async function waitForDownloadSendCapacity(
  channel: RTCDataChannel,
  downloads: Map<string, DownloadState>,
  transferID: string,
  download: DownloadState,
  waiters: Set<() => void>,
  maximumBufferedBytes: number
): Promise<void> {
  while (channel.bufferedAmount > maximumBufferedBytes) {
    channel.bufferedAmountLowThreshold = 0;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let poll: ReturnType<typeof setTimeout> | undefined;
      const onLow = () => finish();
      const onClose = () => finish(new Error("channel_closed"));
      const onFlowChange = () => finish();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        waiters.delete(onFlowChange);
        if (poll) clearTimeout(poll);
        channel.removeEventListener("bufferedamountlow", onLow);
        channel.removeEventListener("close", onClose);
        if (error) reject(error);
        else resolve();
      };
      waiters.add(onFlowChange);
      channel.addEventListener("bufferedamountlow", onLow, { once: true });
      channel.addEventListener("close", onClose, { once: true });
      poll = setTimeout(onLow, 50);
      if (downloads.get(transferID) !== download) finish();
      else if (channel.readyState !== "open") finish(new Error("channel_closed"));
      else if (channel.bufferedAmount <= maximumBufferedBytes) finish();
    });
    if (downloads.get(transferID) !== download) return;
  }
}

function sendDownloadError(channel: RTCDataChannel, transferID: string, error: string): void {
  if (channel.readyState !== "open") return;
  try {
    channel.send(JSON.stringify({ type: "fs_download_error", transferID, error }));
  } catch {}
}

function isLockControlRequest(
  request: ValidFileSystemRequest,
  uploads: Map<string, UploadState>,
  downloads: Map<string, DownloadState>
): boolean {
  const lockDirectory = "/.watermelon/locks";
  const normalizedPath = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    try {
      return normalizePath(value);
    } catch {
      return undefined;
    }
  };
  const isLockRead = (value: unknown): boolean => {
    const path = normalizedPath(value);
    return path === lockDirectory || (path !== undefined && isWriteLockPath(path));
  };
  const mutatesLockNamespace = (value: unknown): boolean => {
    const path = normalizedPath(value);
    return path === "/" || path === "/.watermelon" || path === lockDirectory ||
      path?.startsWith(`${lockDirectory}/`) === true;
  };
  switch (request.operation) {
    case "list":
    case "metadata":
    case "download_begin":
      return isLockRead(request.path);
    case "create_directory":
    case "delete":
    case "upload_begin":
      return mutatesLockNamespace(request.path);
    case "copy":
    case "move":
      return mutatesLockNamespace(request.sourcePath) || mutatesLockNamespace(request.destinationPath);
    case "upload_finish":
    case "upload_abort":
      return typeof request.transferID === "string" &&
        mutatesLockNamespace(uploads.get(request.transferID)?.path);
    case "download_start":
    case "download_finish":
    case "download_abort":
      return typeof request.transferID === "string" &&
        downloads.get(request.transferID)?.control === true;
    default:
      return false;
  }
}

function isWriteLockPath(path: string): boolean {
  return /^\/\.watermelon\/locks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.lock$/.test(path);
}

async function abortUpload(uploads: Map<string, UploadState>, transferID: string): Promise<void> {
  const upload = uploads.get(transferID);
  if (!upload) return;
  if (upload.cleanupPromise) return upload.cleanupPromise;
  clearTimeout(upload.idleTimer);
  upload.cleanupPromise = (async () => {
    await upload.writable.abort().catch(() => {});
    if (upload.removeOnAbort) await upload.parent.removeEntry(upload.name).catch(() => {});
    if (uploads.get(transferID) === upload) uploads.delete(transferID);
  })();
  await upload.cleanupPromise;
}

async function expireUpload(uploads: Map<string, UploadState>, transferID: string): Promise<void> {
  const upload = uploads.get(transferID);
  if (!upload || upload.cleanupPromise) return;
  upload.notifyTimeout?.();
  await abortUpload(uploads, transferID);
}

function refreshUploadIdleTimer(
  uploads: Map<string, UploadState>,
  transferID: string,
  upload: UploadState
): void {
  clearTimeout(upload.idleTimer);
  upload.idleTimer = setTimeout(() => void expireUpload(uploads, transferID), uploadIdleTimeoutMilliseconds);
}

async function copyOrMoveEntry(
  root: FileSystemDirectoryHandle,
  sourcePath: string,
  destinationPath: string,
  removeSource: boolean
): Promise<void> {
  if (sourcePath === "/" || destinationPath === "/") throw new Error("invalid_path");
  if (sourcePath === destinationPath) {
    if (!await entryAt(root, sourcePath, true)) throw new DOMException("Not found", "NotFoundError");
    return;
  }
  const source = await entryAt(root, sourcePath, false);
  if (!source) throw new DOMException("Not found", "NotFoundError");
  if (source.handle.kind === "directory" && pathsOverlap(sourcePath, destinationPath)) {
    throw new Error("invalid_path");
  }
  const destination = await entryAt(root, destinationPath, true);
  if (source.handle.kind === "directory" && destination) throw new Error("name_collision");
  if (source.handle.kind === "file" && destination?.handle.kind === "directory") throw new Error("type_mismatch");
  try {
    await copyEntry(root, sourcePath, destinationPath);
  } catch (error) {
    if (!destination) {
      const target = await entryAt(root, destinationPath, true).catch(() => null);
      if (target) {
        const { parent, name } = await parentAndName(root, destinationPath, false);
        await parent.removeEntry(name, { recursive: true }).catch(() => {});
      }
    }
    throw error;
  }
  if (removeSource) {
    const { parent, name } = await parentAndName(root, sourcePath, false);
    await parent.removeEntry(name, { recursive: true });
  }
}

function pathsOverlap(lhs: string, rhs: string): boolean {
  return lhs.startsWith(`${rhs}/`) || rhs.startsWith(`${lhs}/`);
}

function assertNoActiveUploadOverlap(uploads: Map<string, UploadState>, ...paths: string[]): void {
  for (const upload of uploads.values()) {
    if (paths.some((path) => path === upload.path || pathsOverlap(path, upload.path))) {
      throw new Error("upload_conflict");
    }
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
  let parent: FileSystemDirectoryHandle;
  let name: string;
  try {
    ({ parent, name } = await parentAndName(root, normalized, false));
  } catch (error) {
    if (allowMissing && isNotFound(error)) return null;
    throw error;
  }
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

function isRequestID(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function isCanonicalTransferID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
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
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotFoundError": return "not_found";
      case "NotAllowedError":
      case "SecurityError": return "permission_denied";
      case "QuotaExceededError": return "quota_exceeded";
      case "TypeMismatchError": return "type_mismatch";
      case "InvalidModificationError": return "name_collision";
      case "NoModificationAllowedError": return "permission_denied";
      case "NotReadableError": return "not_readable";
      default: return "file_system_error";
    }
  }
  return "file_system_error";
}

export async function sendResponse(
  channel: RTCDataChannel,
  id: string,
  ok: boolean,
  result?: unknown,
  error?: string,
  sendBudget: DownloadSendBudget = { reservedBytes: 0, waiters: new Set() }
): Promise<void> {
  if (channel.readyState !== "open") return;
  if (!ok) {
    await sendJSONResponse(
      channel,
      { type: "fs_response", id, ok: false, error: error ?? "file_system_error" },
      sendBudget
    );
    return;
  }
  const resultBytes = new TextEncoder().encode(JSON.stringify(result ?? null));
  if (resultBytes.byteLength > maximumResponseBytes) {
    await sendJSONResponse(channel, { type: "fs_response", id, ok: false, error: "response_too_large" }, sendBudget);
    return;
  }
  if (resultBytes.byteLength <= directResponseBytes) {
    await sendJSONResponse(channel, { type: "fs_response", id, ok: true, result: result ?? null }, sendBudget);
    return;
  }
  const total = Math.ceil(resultBytes.byteLength / responsePartBytes);
  for (let index = 0; index < total; index += 1) {
    const start = index * responsePartBytes;
    await sendJSONResponse(channel, {
      type: "fs_response_part",
      id,
      index,
      total,
      data: encodeBase64(resultBytes.slice(start, start + responsePartBytes))
    }, sendBudget);
  }
}

async function sendJSONResponse(
  channel: RTCDataChannel,
  value: unknown,
  sendBudget: DownloadSendBudget
): Promise<void> {
  const payload = JSON.stringify(value);
  await waitForSendCapacity(channel, sendBudget, textEncoder.encode(payload).byteLength);
  if (channel.readyState !== "open") throw new Error("channel_closed");
  channel.send(payload);
}

async function waitForSendCapacity(
  channel: RTCDataChannel,
  sendBudget: DownloadSendBudget,
  nextMessageBytes: number,
  maximumBufferedBytes = maximumBufferedDownloadBytes
): Promise<void> {
  while (channel.bufferedAmount + sendBudget.reservedBytes + nextMessageBytes > maximumBufferedBytes) {
    channel.bufferedAmountLowThreshold = 0;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let poll: ReturnType<typeof setTimeout> | undefined;
      const onLow = () => finish();
      const onBudget = () => finish();
      const onClose = () => finish(new Error("channel_closed"));
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        sendBudget.waiters.delete(onBudget);
        if (poll) clearTimeout(poll);
        channel.removeEventListener("bufferedamountlow", onLow);
        channel.removeEventListener("close", onClose);
        if (error) reject(error);
        else resolve();
      };
      sendBudget.waiters.add(onBudget);
      channel.addEventListener("bufferedamountlow", onLow, { once: true });
      channel.addEventListener("close", onClose, { once: true });
      poll = setTimeout(onLow, 50);
      if (channel.readyState !== "open") finish(new Error("channel_closed"));
      else if (channel.bufferedAmount + sendBudget.reservedBytes + nextMessageBytes <= maximumBufferedBytes) finish();
    });
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
}
