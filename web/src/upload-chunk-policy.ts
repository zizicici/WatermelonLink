export const minimumUploadChunkBytes = 8 * 1024;
export const defaultUploadChunkBytes = 32 * 1024;
export const maximumUploadChunkBytes = 128 * 1024;

export function uploadChunkBytesForMaxMessage(maxMessageSize: number | undefined): number {
  if (maxMessageSize === 0) return maximumUploadChunkBytes;
  if (!Number.isFinite(maxMessageSize) || !maxMessageSize || maxMessageSize <= 0) {
    return defaultUploadChunkBytes;
  }
  const rawCapacity = Math.floor((maxMessageSize - 32) / 1024) * 1024;
  if (rawCapacity < minimumUploadChunkBytes) throw new Error("SCTP message size is too small");
  return Math.min(maximumUploadChunkBytes, rawCapacity);
}
