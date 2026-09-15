import test from "node:test";
import assert from "node:assert/strict";
import { MultipartUpload, UploadStalledError } from "../dist/multipartUpload.js";

/**
 * Fake XHR whose behaviour is scripted per instance by a queue of modes:
 *   "stall"   - send() then silence. No load/error/abort event, ever. This is
 *               the mobile-radio-handoff case the watchdog exists for.
 *   "ok"      - completes with a 200 and an ETag.
 * Records every instance so a test can assert how many attempts were made.
 */
function installFakeXHR(modes) {
  const instances = [];
  const queue = [...modes];

  class FakeXHR {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = "";
      this.aborted = false;
      this.mode = queue.shift() ?? "ok";
      instances.push(this);
    }
    open() {}
    setRequestHeader() {}
    getResponseHeader(name) {
      return name === "ETag" ? '"etag-fake"' : null;
    }
    send() {
      if (this.mode === "stall") return; // deliberate silence
      setTimeout(() => {
        this.status = 200;
        this.onload?.();
      }, 1);
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
  }

  const prev = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXHR;
  return {
    instances,
    restore() {
      globalThis.XMLHttpRequest = prev;
    },
  };
}

function makeUpload(overrides = {}) {
  return new MultipartUpload({}, {
    file: new File([new Uint8Array(1024)], "test.mp4", { type: "video/mp4" }),
    partStallTimeoutMs: 20,
    ...overrides,
  });
}

test("a stalled part rejects with UploadStalledError instead of hanging forever", async () => {
  const xhr = installFakeXHR(["stall"]);
  try {
    const upload = makeUpload();
    const err = await upload.uploadWithXHR("https://r2.example/part", new Blob([]), 1)
      .then(() => null, (e) => e);

    assert.ok(err instanceof UploadStalledError, `expected UploadStalledError, got ${err}`);
    assert.equal(err.partNumber, 1);
    assert.equal(xhr.instances[0].aborted, true, "watchdog should abort the dead socket");
  } finally {
    xhr.restore();
  }
});

test("a watchdog abort is distinguishable from a caller abort", async () => {
  // No stall: abort() called by the caller must still say "Upload aborted",
  // otherwise cancel() would look like a transient failure and get retried.
  const xhr = installFakeXHR(["stall"]);
  try {
    const upload = makeUpload({ partStallTimeoutMs: 10_000 });
    const pending = upload.uploadWithXHR("https://r2.example/part", new Blob([]), 1)
      .then(() => null, (e) => e);

    await new Promise((r) => setTimeout(r, 5));
    xhr.instances[0].abort();

    const err = await pending;
    assert.ok(!(err instanceof UploadStalledError), "caller abort must not be a stall");
    assert.equal(err.message, "Upload aborted");
  } finally {
    xhr.restore();
  }
});

test("progress re-arms the watchdog so a slow upload is not killed", async () => {
  const xhr = installFakeXHR(["stall"]);
  try {
    const upload = makeUpload({ partStallTimeoutMs: 30 });
    const pending = upload.uploadWithXHR("https://r2.example/part", new Blob([]), 1)
      .then(() => null, (e) => e);

    // Drip progress for longer than the timeout; each tick must reset it.
    const inst = xhr.instances[0];
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 20));
      inst.upload.onprogress?.({ lengthComputable: true, loaded: (i + 1) * 100 });
    }
    // Total elapsed (~100ms) far exceeds the 30ms timeout, but no gap did.
    assert.equal(inst.aborted, false, "slow-but-alive upload must not be aborted");

    // Now go quiet: the watchdog should fire.
    const err = await pending;
    assert.ok(err instanceof UploadStalledError, `expected stall after silence, got ${err}`);
  } finally {
    xhr.restore();
  }
});

test("partStallTimeoutMs: 0 disables the watchdog", async () => {
  const xhr = installFakeXHR(["stall"]);
  try {
    const upload = makeUpload({ partStallTimeoutMs: 0 });
    const settled = await Promise.race([
      upload.uploadWithXHR("https://r2.example/part", new Blob([]), 1).then(() => "settled", () => "settled"),
      new Promise((r) => setTimeout(() => r("still-pending"), 60)),
    ]);
    assert.equal(settled, "still-pending", "disabled watchdog should leave it hanging");
    assert.equal(xhr.instances[0].aborted, false);
  } finally {
    xhr.restore();
  }
});
