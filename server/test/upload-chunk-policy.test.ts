import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultUploadChunkBytes,
  maximumUploadChunkBytes,
  uploadChunkBytesForMaxMessage,
} from "../../web/src/upload-chunk-policy";

test("upload chunks adapt to the negotiated SCTP message size", () => {
  assert.equal(uploadChunkBytesForMaxMessage(undefined), defaultUploadChunkBytes);
  assert.equal(uploadChunkBytesForMaxMessage(0), maximumUploadChunkBytes);
  assert.equal(uploadChunkBytesForMaxMessage(64 * 1024), 63 * 1024);
  assert.equal(uploadChunkBytesForMaxMessage(256 * 1024), maximumUploadChunkBytes);
  assert.throws(() => uploadChunkBytesForMaxMessage(8 * 1024), /too small/);
  assert.throws(() => uploadChunkBytesForMaxMessage(8 * 1024 + 31), /too small/);
  assert.equal(uploadChunkBytesForMaxMessage(8 * 1024 + 32), 8 * 1024);
});
