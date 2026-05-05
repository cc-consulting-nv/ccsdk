import test from "node:test";
import assert from "node:assert/strict";
import { MultipartUpload, PresignedUrlExpiredError } from "../dist/multipartUpload.js";
import { MemoryBlobStore } from "../dist/blobStore.js";

/**
 * Minimal HttpClient stub. Records calls and returns scripted responses.
 */
function makeStubClient(responses = {}) {
  const calls = [];
  return {
    calls,
    async post(path, opts) {
      calls.push({ method: "POST", path, body: opts?.body });
      const handler = responses[`POST ${path}`];
      if (typeof handler === "function") return handler(opts);
      return handler;
    },
    async get(path) {
      calls.push({ method: "GET", path });
      const handler = responses[`GET ${path}`];
      if (typeof handler === "function") return handler();
      return handler;
    },
  };
}

function makeFile(size = 1024 * 1024) {
  return new File([new Uint8Array(size)], "test.mp4", { type: "video/mp4" });
}

test("MultipartUpload generates a stable jobId", () => {
  const file = makeFile(1024);
  const u1 = new MultipartUpload(makeStubClient(), { file, jobId: "fixed-id" });
  assert.equal(u1.getJobId(), "fixed-id");

  const u2 = new MultipartUpload(makeStubClient(), { file });
  assert.match(u2.getJobId(), /^up_\d+_[a-z0-9]+$/);
});

test("MultipartUpload accepts blobStore option without crashing", async () => {
  const file = makeFile(1024);
  const store = new MemoryBlobStore();
  const upload = new MultipartUpload(makeStubClient(), {
    file,
    jobId: "j1",
    blobStore: store,
  });
  assert.equal(upload.getJobId(), "j1");
  // Blob shouldn't be persisted until start() is called.
  assert.equal(await store.get("j1"), null);
});

test("PresignedUrlExpiredError carries status + name", () => {
  const err = new PresignedUrlExpiredError(403, "expired");
  assert.equal(err.status, 403);
  assert.equal(err.name, "PresignedUrlExpiredError");
  assert.equal(err.message, "expired");
});

test("MultipartUpload exposes byte-level progress via getProgress on construction", () => {
  const file = makeFile(20 * 1024 * 1024); // 20MB → 2 parts at 10MB
  const upload = new MultipartUpload(makeStubClient(), { file });
  const progress = upload.getProgress();
  assert.equal(progress.uploadedParts, 0);
  assert.equal(progress.totalParts, 2);
  assert.equal(progress.totalBytes, 20 * 1024 * 1024);
  assert.equal(progress.uploadedBytes, 0);
  assert.equal(progress.percentage, 0);
});

test("MultipartUpload restores completedParts on construction (resume seed)", () => {
  const file = makeFile(30 * 1024 * 1024); // 3 parts
  const upload = new MultipartUpload(makeStubClient(), {
    file,
    completedParts: [1, 2],
  });
  assert.deepEqual(upload.getUploadedParts().sort(), [1, 2]);
  const progress = upload.getProgress();
  assert.equal(progress.uploadedParts, 2);
});
